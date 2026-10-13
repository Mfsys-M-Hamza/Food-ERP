"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveSupplierAction, paySupplierAction } from "@/server/modules/purchasing/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type S = {
  name: string;
  contactPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  taxNumber: string;
  paymentTermsDays: number;
  notes: string;
  isActive: boolean;
  ingredientIds: string[];
};

const EMPTY: S = { name: "", contactPerson: "", phone: "", whatsapp: "", email: "", address: "", taxNumber: "", paymentTermsDays: 0, notes: "", isActive: true, ingredientIds: [] };

export function SupplierDialog({ id, initial, ingredients, trigger }: { id?: string; initial?: S; ingredients: { id: string; name: string }[]; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<S>(initial ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const field = (k: keyof S, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`s-${k}`}>{label}</Label>
      <Input id={`s-${k}`} value={String(v[k] ?? "")} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-invalid={!!errors[k]} {...extra} />
      {errors[k] && <p className="text-sm text-destructive">{errors[k]![0]}</p>}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus /> New supplier
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{id ? "Edit supplier" : "New supplier"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("name", "Name")}
          {field("contactPerson", "Contact person")}
          {field("phone", "Phone", { inputMode: "tel" })}
          {field("whatsapp", "WhatsApp", { inputMode: "tel" })}
          {field("email", "E-mail")}
          {field("taxNumber", "Tax number")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="s-address">Address</Label>
            <Textarea id="s-address" rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-terms">Payment terms (days)</Label>
            <Input id="s-terms" inputMode="numeric" value={String(v.paymentTermsDays)} onChange={(e) => setV({ ...v, paymentTermsDays: Number(e.target.value.replace(/\D/g, "") || 0) })} />
          </div>
          <label className="flex items-center justify-between self-end rounded-lg border p-3 text-sm">
            Active
            <Switch checked={v.isActive} onCheckedChange={(c) => setV({ ...v, isActive: c })} />
          </label>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Supplies</Label>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {ingredients.map((i) => {
                const on = v.ingredientIds.includes(i.id);
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setV({ ...v, ingredientIds: on ? v.ingredientIds.filter((x) => x !== i.id) : [...v.ingredientIds, i.id] })}
                    className={cn("rounded-full border-2 px-3 py-1 text-sm", on ? "border-brand bg-brand/10" : "border-border")}
                  >
                    {i.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveSupplierAction(id ?? null, v);
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                  if (!id) router.push(`/admin/suppliers/${r.data.id}`);
                } else setErrors(r.fieldErrors ?? { name: [r.error] });
              })
            }
            data-testid="save-supplier"
          >
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const METHODS: [string, string][] = [
  ["BANK_TRANSFER", "Bank transfer"],
  ["CASH_DRAWER", "Cash from till"],
  ["CASH_OTHER", "Cash (not from till)"],
  ["CHEQUE", "Cheque"],
  ["CARD", "Card"],
];

function readTerminal(): string | null {
  try {
    return JSON.parse(localStorage.getItem("ferp-pos-cart") ?? "{}").state?.terminalId ?? null;
  } catch {
    return null;
  }
}

export function PaySupplierButton({
  supplierId,
  purchaseId,
  due,
  terminals,
  label = "Record payment",
}: {
  supplierId: string;
  purchaseId?: string;
  due: string;
  terminals: { id: string; name: string }[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(due);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setAmount(due);
          setTerminalId(readTerminal() ?? terminals[0]?.id ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="pay-supplier">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay supplier</DialogTitle>
          <DialogDescription>{purchaseId ? `Due on this invoice: ${formatMoney(due)}` : `Outstanding: ${formatMoney(due)}`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="p-amount">Amount</Label>
          <Input id="p-amount" inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
        <div className="flex flex-wrap gap-2">
          {METHODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMethod(k)} className={cn("rounded-full border-2 px-3 py-1.5 text-sm", method === k ? "border-brand bg-brand/10" : "border-border")}>
              {l}
            </button>
          ))}
        </div>
        {method === "CASH_DRAWER" && (
          <div className="space-y-1.5">
            <Label htmlFor="p-till">Till</Label>
            <select id="p-till" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">The cash is taken out of that till’s open shift.</p>
          </div>
        )}
        <Input placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <DialogFooter>
          <Button
            disabled={pending || !amount}
            onClick={() =>
              start(async () => {
                const r = await paySupplierAction({ supplierId, purchaseId: purchaseId ?? null, amount, method, reference, terminalId: method === "CASH_DRAWER" ? terminalId : null });
                if (r.ok) {
                  toast.success(r.message);
                  setOpen(false);
                } else toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0]![0] : r.error);
              })
            }
            data-testid="confirm-supplier-payment"
          >
            {pending && <Loader2 className="animate-spin" />} Pay {amount && formatMoney(amount)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
