import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";
import { AppError } from "./errors";

/**
 * Field-level encryption for sensitive personal data (national ID, bank
 * account). AES-256-GCM with a key derived from DATA_ENCRYPTION_KEY.
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 *
 * Losing or changing DATA_ENCRYPTION_KEY makes existing values unreadable,
 * so it must be backed up with the database credentials.
 */
function key(): Buffer {
  const raw = env().DATA_ENCRYPTION_KEY;
  if (!raw) throw new AppError("INTERNAL", "DATA_ENCRYPTION_KEY is not configured");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  const [v, iv, tag, ct] = value.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new AppError("INTERNAL", "Unreadable encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/** "35202-1234567-1" → "•••• 5671" style hint for lists. */
export function last4(value: string): string {
  return value.replace(/\D/g, "").slice(-4);
}
