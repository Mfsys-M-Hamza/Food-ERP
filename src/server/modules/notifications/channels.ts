import "server-only";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { sendEmail } from "@/server/core/mailer";

/**
 * Outgoing message adapters. Every message is logged in outbound_messages.
 * Providers are configured with environment variables; without them the
 * message is recorded as SKIPPED (and logged in development), so nothing
 * breaks before the business signs up for a provider.
 *
 * - E-mail:   RESEND_API_KEY, EMAIL_FROM
 * - SMS:      SMS_API_URL, SMS_API_KEY, SMS_SENDER (generic HTTP gateway: POST JSON { to, from, message })
 * - WhatsApp: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (Meta WhatsApp Cloud API, text messages)
 */
export type Channel = "EMAIL" | "SMS" | "WHATSAPP";

export function channelConfigured(channel: Channel): boolean {
  if (channel === "EMAIL") return !!process.env.RESEND_API_KEY;
  if (channel === "SMS") return !!(process.env.SMS_API_URL && process.env.SMS_API_KEY);
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendMessage(m: { channel: Channel; to: string; subject?: string; body: string; relatedType?: string; relatedId?: string }) {
  const row = await db.outboundMessage.create({
    data: { channel: m.channel, recipient: m.to, subject: m.subject ?? null, body: m.body, relatedType: m.relatedType ?? null, relatedId: m.relatedId ?? null },
  });
  if (!channelConfigured(m.channel)) {
    if (process.env.NODE_ENV !== "production") logger.info({ channel: m.channel, to: m.to, body: m.body }, "Message not sent: provider not configured");
    await db.outboundMessage.update({ where: { id: row.id }, data: { status: "SKIPPED", error: "Provider not configured" } });
    return { id: row.id, status: "SKIPPED" as const };
  }
  try {
    let provider = "";
    if (m.channel === "EMAIL") {
      provider = "resend";
      await sendEmail({ to: m.to, subject: m.subject ?? "Notification", text: m.body, html: `<p>${escapeHtml(m.body).replace(/\n/g, "<br>")}</p>` });
    } else if (m.channel === "SMS") {
      provider = "sms-gateway";
      const res = await fetch(process.env.SMS_API_URL!, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SMS_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: m.to, from: process.env.SMS_SENDER ?? "", message: m.body }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
    } else {
      provider = "whatsapp-cloud";
      const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: m.to.replace(/^\+/, ""), type: "text", text: { body: m.body } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`WhatsApp answered ${res.status}`);
    }
    await db.outboundMessage.update({ where: { id: row.id }, data: { status: "SENT", provider, sentAt: new Date(), attempts: 1 } });
    return { id: row.id, status: "SENT" as const };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error({ channel: m.channel, err: error }, "Message send failed");
    await db.outboundMessage.update({ where: { id: row.id }, data: { status: "FAILED", error: error.slice(0, 300), attempts: 1 } });
    return { id: row.id, status: "FAILED" as const };
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
