"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveExpenseCategoryAction } from "@/server/modules/expenses/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type Cat = { id: string; name: string; isActive: boolean; system: boolean; expenseCount: number };

export function CategoryManager({ categories }: { categories: Cat[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const save = (id: string | null, data: { name: string; isActive: boolean }, after?: () => void) =>
    start(async () => {
      const r = await saveExpenseCategoryAction(id, data);
      if (r.ok) {
        toast.success(r.message);
        after?.();
        router.refresh();
      } else toast.error(r.fieldErrors?.name?.[0] ?? r.error);
    });

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(null, { name, isActive: true }, () => setName(""));
        }}
      >
        <Input aria-label="New category" placeholder="New category, e.g. Generator fuel" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
        <Button type="submit" disabled={pending || name.trim().length < 2}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add
        </Button>
      </form>
      <ul className="divide-y rounded-xl border">
        {categories.map((c) => (
          <CategoryRow key={c.id} c={c} onSave={(d) => save(c.id, d)} pending={pending} />
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({ c, onSave, pending }: { c: Cat; onSave: (d: { name: string; isActive: boolean }) => void; pending: boolean }) {
  const [name, setName] = useState(c.name);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2">
      <Input aria-label={`Name of ${c.name}`} value={name} onChange={(e) => setName(e.target.value)} className="h-9 max-w-xs" />
      {name !== c.name && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => onSave({ name, isActive: c.isActive })}>
          Save
        </Button>
      )}
      <span className="text-xs text-muted-foreground">{c.expenseCount} expenses</span>
      {c.system && <Badge variant="secondary">Used by payroll</Badge>}
      <label className="ml-auto flex items-center gap-2 text-sm">
        <Switch checked={c.isActive} disabled={c.system || pending} onCheckedChange={(v) => onSave({ name: c.name, isActive: v })} aria-label={`${c.name} active`} />
        {c.isActive ? "Active" : "Archived"}
      </label>
    </li>
  );
}
