/** Readable text colour (near-black or white) on a hex background, by WCAG relative luminance. */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  // Contrast against white vs against near-black (#141210, L≈0.006).
  return (1.05 / (L + 0.05) >= (L + 0.05) / 0.056) ? "#ffffff" : "#141210";
}
