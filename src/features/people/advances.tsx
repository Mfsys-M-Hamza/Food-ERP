"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { issueAdvanceAction, cancelAdvanceAction } from "@/server/modules/people/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { METHOD_LABEL } from "@/lib/expenses";
import { formatMoney, money } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Advance = { id: string; issuedOn: string; amount: string; recovered: string; balance: string; installment: string | null; reason: string | null; status: string };

export function AdvancesPanel({
  employeeId,
  advances,
  tills,
  today,
  canIssue,
}: {
  employeeId: string;
  advances: Advance[];
  tills: { terminalId: string; label: string }[];
  today: string;
  canIssue: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [method, setMethod] = useState(tills.length ? "CASH_DRAWER" : "CASH_OTHER");
  const [terminalId, setTerminalId] = useState(tills[0]?.terminalId ?? "");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function issue() {
    start(async () => {
      const r = await issueAdvanceAction({ employeeId, amount, installment, issuedOn, paymentMethod: method, terminalId: method === "CASH_DRAWER" ? terminalId : null, reason });
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setAmount("");
        setInstallment("");
        setReason("");
        router.refresh();
      } else toast.error(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
    });
  }

  const open_ = advances.filter((a) => a.status === "OPEN");
  const outstanding = open_.reduce((s, a) => s.plus(a.balance), money(0));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Salary advances</div>
          <div className="text-xs text-muted-foreground" data-testid="advance-outstanding">
            Outstanding {formatMoney(outstanding)}
          </div>
        </div>
        {canIssue && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="give-advance">
                <Plus /> Give advance
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Give a salary advance</DialogTitle>
                <DialogDescription>Recorded as an expense now and deducted from the next payroll.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="adv-amount">Amount (Rs)</Label>
                  <Input id="adv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adv-date">Date</Label>
                  <Input id="adv-date" type="date" max={today} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="adv-inst">Recover per payroll (blank = all next payroll)</Label>
                  <Input id="adv-inst" inputMode="decimal" value={installment} onChange={(e) => setInstallment(e.target.value.replace(/[^\d.]/g, ""))} />
                </div>
                <div className="col-span-2 flex flex-wrap gap-2">
                  {["CASH_DRAWER", "CASH_OTHER", "BANK_TRANSFER"].map((m) => (
                    <button key={m} type="button" onClick={() => setMethod(m)} className={cn("rounded-full border-2 px-3 py-1.5 text-sm", method === m ? "border-brand bg-brand/10" : "border-border")}>
                      {METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
                {method === "CASH_DRAWER" && (
                  <select aria-label="Till" className="col-span-2 h-10 rounded-md border border-input bg-transparent px-2 text-sm" value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
                    {tills.length === 0 && <option value="">No till has an open shift</option>}
                    {tills.map((t) => (
                      <option key={t.terminalId} value={t.terminalId}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
                <Input className="col-span-2" aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <DialogFooter>
                <Button onClick={issue} disabled={pending || !amount} data-testid="confirm-advance">
                  {pending && <Loader2 className="animate-spin" />}
                  Pay advance
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {advances.length === 0 ? (
        <p className="text-sm text-muted-foreground">No advances.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {advances.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="tabular">
                  {formatMoney(a.amount)} <span className="text-muted-foreground">· {formatDate(a.issuedOn)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Recovered {formatMoney(a.recovered)}
                  {a.installment && ` · ${formatMoney(a.installment)} per payroll`}
                  {a.reason && ` · ${a.reason}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={a.status === "OPEN" ? "default" : "secondary"}>{a.status === "OPEN" ? `Due ${formatMoney(a.balance)}` : a.status === "RECOVERED" ? "Recovered" : "Cancelled"}</Badge>
                {canIssue && a.status === "OPEN" && money(a.recovered).isZero() && <CancelAdvance id={a.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CancelAdvance({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt("Why cancel this advance?");
        if (!reason) return;
        start(async () => {
          const r = await cancelAdvanceAction(id, reason);
          if (r.ok) {
            toast.success(r.message);
            router.refresh();
          } else toast.error(r.error);
        });
      }}
    >
      Cancel
    </Button>
  );
}
