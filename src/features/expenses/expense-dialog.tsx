"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { createExpenseAction, updateExpenseAction, voidExpenseAction, attachReceiptAction } from "@/server/modules/expenses/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { METHOD_LABEL } from "@/lib/expenses";


export type ExpenseFormValue = {
  categoryId: string;
  amount: string;
  expenseDate: string;
  paymentMethod: string;
  terminalId: string;
  payee: string;
  description: string;
  reference: string;
};

type Props = {
  categories: { id: string; name: string }[];
  tills: { terminalId: string; label: string }[];
  /** Managers may use any method; cashiers record cash from their own till only. */
  canManage: boolean;
  today: string;
  id?: string;
  initial?: ExpenseFormValue;
  trigger: ReactNode;
  onSaved?: () => void;
};

const select = "h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function ExpenseDialog({ categories, tills, canManage, today, id, initial, trigger, onSaved }: Props) {
  const router = useRouter();
  const blank: ExpenseFormValue = {
    categoryId: "",
    amount: "",
    expenseDate: today,
    paymentMethod: canManage ? (tills.length ? "CASH_DRAWER" : "CASH_OTHER") : "CASH_DRAWER",
    terminalId: tills[0]?.terminalId ?? "",
    payee: "",
    description: "",
    reference: "",
  };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ExpenseFormValue>(initial ?? blank);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof ExpenseFormValue, val: string) => setV((s) => ({ ...s, [k]: val }));
  const methods = canManage ? Object.keys(METHOD_LABEL) : ["CASH_DRAWER"];
  const err = (k: string) => errors[k]?.[0] && <p className="text-xs text-destructive">{errors[k]![0]}</p>;
  const noTill = v.paymentMethod === "CASH_DRAWER" && tills.length === 0;

  function submit() {
    start(async () => {
      const data = { ...v, terminalId: v.paymentMethod === "CASH_DRAWER" ? v.terminalId : null };
      let r;
      if (id) r = await updateExpenseAction(id, data);
      else {
        const fd = new FormData();
        fd.set("data", JSON.stringify(data));
        const f = fileRef.current?.files?.[0];
        if (f) fd.set("receipt", f);
        r = await createExpenseAction(fd);
      }
      if (r.ok) {
        toast.success(id ? r.message : `${(r.data as { expenseNumber?: string }).expenseNumber ?? "Expense"} recorded`);
        setOpen(false);
        setErrors({});
        if (!id) setV(blank);
        onSaved?.();
        router.refresh();
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{id ? "Edit expense" : "Record an expense"}</DialogTitle>
          {!canManage && <DialogDescription>Cash paid from your till. It is deducted from the expected cash at closing.</DialogDescription>}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="ex-cat">Category</Label>
            <select id="ex-cat" className={select} value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {err("categoryId")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-amount">Amount (Rs)</Label>
            <Input id="ex-amount" inputMode="decimal" className="tabular" value={v.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} />
            {err("amount")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-date">Date</Label>
            <Input id="ex-date" type="date" max={today} value={v.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} />
            {err("expenseDate")}
          </div>
          {methods.length > 1 && (
            <div className="col-span-2 space-y-1.5">
              <Label>Paid by</Label>
              <div className="flex flex-wrap gap-2">
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set("paymentMethod", m)}
                    className={cn("rounded-full border-2 px-3 py-1.5 text-sm", v.paymentMethod === m ? "border-brand bg-brand/10" : "border-border")}
                  >
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {v.paymentMethod === "CASH_DRAWER" && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ex-till">Till</Label>
              {noTill ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">No till has an open shift. Open a shift on the POS first.</p>
              ) : (
                <select id="ex-till" className={select} value={v.terminalId} onChange={(e) => set("terminalId", e.target.value)}>
                  {tills.map((t) => (
                    <option key={t.terminalId} value={t.terminalId}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
              {err("terminalId")}
            </div>
          )}
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="ex-desc">What was it for?</Label>
            <Textarea id="ex-desc" rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Electricity bill September" />
            {err("description")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-payee">Paid to (optional)</Label>
            <Input id="ex-payee" value={v.payee} onChange={(e) => set("payee", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-ref">Bill / reference no.</Label>
            <Input id="ex-ref" value={v.reference} onChange={(e) => set("reference", e.target.value)} />
          </div>
          {!id && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ex-receipt">Receipt photo or PDF (optional)</Label>
              <Input id="ex-receipt" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" capture="environment" />
              {err("file")}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || noTill} data-testid="save-expense" className="w-full sm:w-auto">
            {pending && <Loader2 className="animate-spin" />}
            {id ? "Save changes" : "Record expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VoidExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          Void
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void this expense?</DialogTitle>
          <DialogDescription>It stays on record marked void. Cash taken from a till that is still open goes back into its expected cash.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              start(async () => {
                const r = await voidExpenseAction(id, reason);
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            Void expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AttachReceiptButton({ id }: { id: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        aria-label="Receipt file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          start(async () => {
            const fd = new FormData();
            fd.set("receipt", f);
            const r = await attachReceiptAction(id, fd);
            if (r.ok) {
              toast.success(r.message);
              router.refresh();
            } else toast.error(r.fieldErrors?.file?.[0] ?? r.error);
            e.target.value = "";
          });
        }}
      />
      <Button variant="outline" onClick={() => ref.current?.click()} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Paperclip />}
        Attach receipt
      </Button>
    </>
  );
}
