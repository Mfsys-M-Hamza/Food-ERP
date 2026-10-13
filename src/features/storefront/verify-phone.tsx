"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { requestOtpAction, verifyOtpAction } from "@/server/modules/storefront/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Account card: verify the phone number with a one-time code (unlocks full order history and using points). */
export function VerifyPhone({ phone }: { phone: string }) {
  const router = useRouter();
  const [sent, setSent] = useState<{ sentTo: string; devCode?: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning/5 p-4" data-testid="verify-phone">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-5 text-warning" />
        <div>
          <p className="font-medium">Verify your phone number</p>
          <p className="text-sm text-muted-foreground">Confirm {phone} to see all your past orders and to use your points online.</p>
        </div>
      </div>
      {!sent ? (
        <Button
          variant="outline"
          className="rounded-full"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await requestOtpAction();
              if (r.ok) {
                setSent(r.data);
                setError(null);
              } else setError(r.error);
            })
          }
          data-testid="send-code"
        >
          {pending && <Loader2 className="animate-spin" />}
          Send me a code
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">We sent a 6-digit code to {sent.sentTo}.</p>
          {sent.devCode && (
            <p className="text-xs text-muted-foreground" data-testid="dev-code">
              Development mode (no SMS provider): your code is {sent.devCode}
            </p>
          )}
          <div className="flex gap-2">
            <Input aria-label="Verification code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-11 w-36 text-center font-mono text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <Button
              className="h-11 rounded-full"
              disabled={pending || code.length !== 6}
              onClick={() =>
                start(async () => {
                  const r = await verifyOtpAction(code);
                  if (!r.ok) return setError(r.error);
                  if (r.data.verified) {
                    toast.success("Phone number verified");
                    router.refresh();
                  } else setError(`That code is not right. ${r.data.attemptsLeft} tries left.`);
                })
              }
              data-testid="verify-code"
            >
              {pending && <Loader2 className="animate-spin" />}
              Verify
            </Button>
          </div>
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSent(null)}>
            Send a new code
          </button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
