"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { expenseFormOptionsAction } from "@/server/modules/expenses/actions";
import { Button } from "@/components/ui/button";
import { ExpenseDialog } from "./expense-dialog";

type Options = { categories: { id: string; name: string }[]; tills: { terminalId: string; label: string }[]; today: string; canManage: boolean };

/** "Record an expense" on the POS shift screen: cash paid from this till. */
export function PosExpenseButton({ terminalId, onSaved }: { terminalId: string; onSaved: () => void }) {
  const [opts, setOpts] = useState<Options | null>(null);
  useEffect(() => {
    let alive = true;
    void expenseFormOptionsAction().then((r) => {
      if (alive && r.ok) setOpts(r.data);
    });
    return () => {
      alive = false;
    };
  }, []);
  const trigger = (
    <Button variant="outline" className="h-12 w-full" disabled={!opts} data-testid="pos-expense">
      <Receipt /> Record an expense (bill paid from this till)
    </Button>
  );
  if (!opts) return trigger;
  // Put this till first so it is preselected.
  const tills = [...opts.tills].sort((a, b) => (a.terminalId === terminalId ? -1 : b.terminalId === terminalId ? 1 : 0));
  return <ExpenseDialog categories={opts.categories} tills={tills} canManage={false} today={opts.today} trigger={trigger} onSaved={onSaved} />;
}
