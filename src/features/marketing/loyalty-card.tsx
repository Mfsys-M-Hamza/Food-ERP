"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adjustPointsAction } from "@/server/modules/marketing/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";

const LABEL: Record<string, string> = { EARN: "Earned", REDEEM: "Used", REVERSE_EARN: "Taken back", REVERSE_REDEEM: "Returned", EXPIRE: "Expired", ADJUST: "Adjusted" };

type Props = {
  customerId: string;
  balance: number;
  value: string;
  canAdjust: boolean;
  history: { id: string; type: string; points: number; note: string | null; createdAt: Date | string }[];
};

export function LoyaltyCard({ customerId, balance, value, canAdjust, history }: Props) {
  const router = useRouter();
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="size-4" /> Loyalty points
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular" data-testid="loyalty-balance">
            {balance}
          </span>
          <span className="text-muted-foreground">worth {formatMoney(value)}</span>
        </div>
        {history.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {formatDate(h.createdAt)} · {LABEL[h.type] ?? h.type}
                  {h.note && ` · ${h.note}`}
                </span>
                <span className={`tabular ${h.points < 0 ? "text-destructive" : "text-success"}`}>
                  {h.points > 0 ? "+" : ""}
                  {h.points}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canAdjust && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Input aria-label="Points to add or remove" placeholder="+50 or -20" className="w-28" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ""))} />
            <Input aria-label="Reason" placeholder="Reason" className="min-w-32 flex-1" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button
              variant="outline"
              disabled={pending || !points || note.trim().length < 3}
              onClick={() =>
                start(async () => {
                  const r = await adjustPointsAction(customerId, { points: Number(points), note });
                  if (r.ok) {
                    toast.success(r.message);
                    setPoints("");
                    setNote("");
                    router.refresh();
                  } else toast.error(r.error);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              Adjust
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
