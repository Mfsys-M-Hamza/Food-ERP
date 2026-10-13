"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { startStockCountAction, saveStockCountAction, postStockCountAction } from "@/server/modules/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatQty, type BaseUnit } from "@/lib/units";
import { formatMoney, money } from "@/lib/money";
import { cn } from "@/lib/utils";

export function StartCountButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await startStockCountAction();
          if (r.ok) router.push(`/admin/inventory/counts/${r.data.id}`);
          else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <ClipboardList />} Start a count
    </Button>
  );
}

type Item = { ingredientId: string; name: string; category: string | null; baseUnit: BaseUnit; expectedQty: string; countedQty: string; varianceQty: string | null; unitCost: string };

export function CountSheet({ id, posted, items }: { id: string; posted: boolean; items: Item[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.ingredientId, i.countedQty])));
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
  const varianceValue = useMemo(
    () =>
      items.reduce((s, i) => {
        const v = values[i.ingredientId];
        if (!v || !/^\d+(\.\d+)?$/.test(v)) return s;
        return s.plus(money(v).minus(i.expectedQty).times(i.unitCost));
      }, money(0)),
    [items, values],
  );
  const lines = () => items.map((i) => ({ ingredientId: i.ingredientId, countedQty: values[i.ingredientId] ?? "" }));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Find ingredient" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!posted && (
          <>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveStockCountAction(id, lines());
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                })
              }
            >
              Save progress
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={pending} data-testid="post-count">
                  Post count
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Post this count?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Stock for every counted ingredient is set to the counted amount. Estimated variance: {formatMoney(varianceValue)}. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      start(async () => {
                        const s = await saveStockCountAction(id, lines());
                        if (!s.ok) return void toast.error(s.error);
                        const r = await postStockCountAction(id);
                        if (r.ok) {
                          toast.success(`${r.message} (variance ${formatMoney(r.data.varianceValue)})`);
                          router.refresh();
                        } else toast.error(r.error);
                      })
                    }
                  >
                    Post count
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
      <Card className="gap-0 overflow-x-auto py-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Ingredient</th>
              <th className="px-4 py-2 text-right font-medium">System says</th>
              <th className="px-4 py-2 font-medium">Counted</th>
              <th className="px-4 py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const v = values[i.ingredientId] ?? "";
              const diff = posted ? (i.varianceQty ? money(i.varianceQty) : null) : /^\d+(\.\d+)?$/.test(v) ? money(v).minus(i.expectedQty) : null;
              return (
                <tr key={i.ingredientId} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{i.category}</div>
                  </td>
                  <td className="px-4 py-2 text-right tabular text-muted-foreground">{formatQty(i.expectedQty, i.baseUnit)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Counted ${i.name}`}
                        inputMode="decimal"
                        className="h-9 w-32 tabular"
                        value={v}
                        disabled={posted}
                        onChange={(e) => setValues({ ...values, [i.ingredientId]: e.target.value.replace(/[^\d.]/g, "") })}
                      />
                      <span className="text-xs text-muted-foreground">{i.baseUnit === "piece" ? "pcs" : i.baseUnit}</span>
                    </div>
                  </td>
                  <td className={cn("px-4 py-2 text-right tabular", diff && !diff.isZero() && (diff.isNegative() ? "text-destructive" : "text-success"))}>
                    {diff ? `${diff.isNegative() ? "" : "+"}${formatQty(diff, i.baseUnit)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
