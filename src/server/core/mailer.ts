import "server-only";
import { logger } from "./logger";

/**
 * Outgoing e-mail. Uses Resend when RESEND_API_KEY is set; otherwise the
 * message is written to the server log (development).
 */
export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Restaurant <no-reply@example.com>";
  if (!key) {
    logger.info({ to: msg.to, subject: msg.subject, text: msg.text }, "E-mail (not sent: RESEND_API_KEY not configured)");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) logger.error({ status: res.status, to: msg.to }, "E-mail send failed");
}
