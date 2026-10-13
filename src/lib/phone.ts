/**
 * Normalise a phone number to E.164. Defaults to Pakistan (+92) for local formats:
 *   0300-1234567 → +923001234567, 3001234567 → +923001234567, 0092 300… → +92300…
 * Returns null when the input cannot be a valid number.
 */
export function normalizePhone(input: string | null | undefined, countryCode = "92"): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = countryCode + digits.slice(1);
  } else if (!digits.startsWith(countryCode) && digits.length === 10) {
    digits = countryCode + digits;
  }
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Display format for Pakistani mobiles: +92 300 1234567. Other numbers are returned unchanged. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+92(\d{3})(\d{7})$/.exec(e164);
  return m ? `+92 ${m[1]} ${m[2]}` : e164;
}

/** Digits only, for wa.me links. */
export function whatsappDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
