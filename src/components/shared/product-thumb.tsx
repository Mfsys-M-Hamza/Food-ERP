import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Product image, or a coloured monogram tile when there is no image. */
export function ProductThumb({ name, imageUrl, className }: { name: string; imageUrl?: string | null; className?: string }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- images come from storage or user-provided URLs
      <img src={imageUrl} alt="" loading="lazy" className={cn("size-10 shrink-0 rounded-lg object-cover", className)} />
    );
  }
  const letters = name
    .split(/\s+/)
    // Skip "&", "-" and other words that do not start with a letter or digit ("Fries & Fried" → "FF").
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-lg text-sm font-semibold",
        PALETTE[hash(name) % PALETTE.length],
        className,
      )}
    >
      {letters}
    </span>
  );
}
