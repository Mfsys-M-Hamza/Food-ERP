import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withTransaction } from "@/server/core/db";
import { env } from "@/server/core/env";
import { consumeThrottle } from "@/server/core/throttle";
import { invalidState, validationFailed } from "@/server/core/errors";
import { channelConfigured, sendMessage } from "@/server/modules/notifications/channels";
import { getSetting } from "@/server/modules/settings/service";
import type { CustomerSession } from "./account";

/**
 * Phone verification with a 6-digit code (SMS, or WhatsApp if that is the
 * configured channel). Codes are stored as an HMAC, expire after 10 minutes,
 * allow 5 attempts, and requests are throttled per phone and per IP.
 */
const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

function hash(phone: string, code: string) {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`otp:${phone}:${code}`).digest("hex");
}

function channel(): "SMS" | "WHATSAPP" {
  if (channelConfigured("SMS")) return "SMS";
  if (channelConfigured("WHATSAPP")) return "WHATSAPP";
  return "SMS";
}

export async function requestPhoneOtp(s: CustomerSession, ip: string | null) {
  const phone = s.customer.phone;
  if (!phone) throw invalidState("Add your phone number to your profile first.");
  if (s.customer.phoneVerifiedAt) throw invalidState("Your phone number is already verified.");
  await consumeThrottle(`otp:phone:${phone}`, 3, 15 * 60);
  await consumeThrottle(`otp:ip:${ip ?? "unknown"}`, 10, 60 * 60);
  const code = String(randomInt(100000, 1_000_000));
  await withTransaction(async (tx) => {
    // Only the newest code is valid.
    await tx.otpCode.updateMany({ where: { phone, purpose: "PHONE_VERIFY", consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.otpCode.create({ data: { purpose: "PHONE_VERIFY", phone, customerId: s.customer.id, codeHash: hash(phone, code), expiresAt: new Date(Date.now() + TTL_MS), ip } });
  });
  const profile = await getSetting("business.profile");
  const via = channel();
  const sent = await sendMessage({ channel: via, to: phone, body: `${code} is your ${profile.name} verification code. It expires in 10 minutes.`, relatedType: "otp" });
  const masked = `${phone.slice(0, 4)}•••••${phone.slice(-3)}`;
  return {
    sentTo: masked,
    via,
    // Development only, when no SMS provider is connected: show the code on screen.
    devCode: sent.status === "SKIPPED" && env().NODE_ENV !== "production" ? code : undefined,
  };
}

export async function verifyPhoneOtp(s: CustomerSession, input: unknown) {
  const r = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).safeParse(input);
  if (!r.success) throw validationFailed({ code: r.error.issues.map((i) => i.message) });
  const phone = s.customer.phone;
  if (!phone) throw invalidState("Add your phone number first.");
  return withTransaction(async (tx) => {
    const otp = await tx.otpCode.findFirst({ where: { phone, purpose: "PHONE_VERIFY", consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!otp) throw invalidState("The code has expired. Ask for a new one.");
    if (otp.attempts >= MAX_ATTEMPTS) throw invalidState("Too many wrong codes. Ask for a new one.");
    const ok = timingSafeEqual(Buffer.from(otp.codeHash, "hex"), Buffer.from(hash(phone, r.data.code), "hex"));
    if (!ok) {
      await tx.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return { verified: false as const, attemptsLeft: MAX_ATTEMPTS - otp.attempts - 1 };
    }
    await tx.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    await tx.customer.update({ where: { id: s.customer.id }, data: { phoneVerifiedAt: new Date() } });
    return { verified: true as const, attemptsLeft: MAX_ATTEMPTS };
  });
}
