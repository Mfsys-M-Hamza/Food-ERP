"use client";

import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Large touch keypad for PINs and cash amounts. */
export function Keypad({
  value,
  onChange,
  maxLength = 6,
  allowDot = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  allowDot?: boolean;
  className?: string;
}) {
  const press = (k: string) => {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === "." && (!allowDot || value.includes("."))) return;
    if (value.length >= maxLength) return;
    if (allowDot && value.includes(".") && value.split(".")[1]!.length >= 2) return;
    onChange(value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", allowDot ? "." : "", "0", "back"];
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {keys.map((k, i) =>
        k === "" ? (
          <span key={i} />
        ) : (
          <Button
            key={k}
            type="button"
            variant="outline"
            className="h-14 text-xl font-semibold"
            onClick={() => press(k)}
            aria-label={k === "back" ? "Delete" : k}
          >
            {k === "back" ? <Delete /> : k}
          </Button>
        ),
      )}
    </div>
  );
}

export function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="flex justify-center gap-3" aria-label={`${filled} digits entered`}>
      {Array.from({ length }, (_, i) => (
        <span key={i} className={cn("size-3.5 rounded-full border-2", i < filled ? "border-foreground bg-foreground" : "border-muted-foreground/40")} />
      ))}
    </div>
  );
}
