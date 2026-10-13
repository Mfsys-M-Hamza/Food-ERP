"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Keypad, PinDots } from "./pin-pad";

/** Asks a manager to approve an action with their PIN. */
export function ManagerPinDialog({
  open,
  reason,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  reason: string;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPin("");
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand" /> Manager approval
          </DialogTitle>
          <DialogDescription>{reason}</DialogDescription>
        </DialogHeader>
        <PinDots length={Math.max(4, pin.length)} filled={pin.length} />
        {error && <p className="text-center text-sm text-destructive" role="alert">{error}</p>}
        <Keypad value={pin} onChange={setPin} />
        <Button
          className="h-12"
          disabled={pin.length < 4}
          onClick={() => {
            onSubmit(pin);
            setPin("");
          }}
          data-testid="approve-pin"
        >
          Approve
        </Button>
      </DialogContent>
    </Dialog>
  );
}
