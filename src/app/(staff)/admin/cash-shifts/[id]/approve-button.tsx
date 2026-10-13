"use client";

import { useTransition } from "react";
import { CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { approveShiftAction } from "@/server/modules/shifts/actions";
import { Button } from "@/components/ui/button";

export function ApproveShiftButton({ shiftId }: { shiftId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await approveShiftAction(shiftId);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
      data-testid="approve-shift"
    >
      {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />}
      Approve shift
    </Button>
  );
}
