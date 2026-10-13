"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UploadAction = (
  fd: FormData,
) => Promise<
  { ok: true; data: { url: string } } | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
>;

/** Image URL input with upload button and preview. The upload action is passed in by the page. */
export function ImageField({
  id,
  value,
  onChange,
  upload,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (url: string) => void;
  upload: UploadAction;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await upload(fd);
    setBusy(false);
    if (res.ok) onChange(res.data.url);
    else toast.error(res.fieldErrors?.file?.[0] ?? res.error);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted">
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary storage URL */}
            <img src={value} alt="Preview" className="size-full object-cover" />
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-background/90 shadow"
                aria-label="Remove image"
              >
                <X className="size-3" />
              </button>
            )}
          </>
        ) : (
          <ImageUp className="size-6 text-muted-foreground" />
        )}
      </div>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://… or upload"
        disabled={disabled}
      />
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
      <Button type="button" variant="outline" onClick={() => ref.current?.click()} disabled={busy || disabled}>
        {busy ? <Loader2 className="animate-spin" /> : <ImageUp />}
        Upload
      </Button>
    </div>
  );
}
