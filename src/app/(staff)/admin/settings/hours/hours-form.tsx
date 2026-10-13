"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Moon } from "lucide-react";
import { saveBusinessHoursAction } from "@/server/modules/settings/actions";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Row = { weekday: number; isClosed: boolean; opensAt: string; closesAt: string };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Show Monday first.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function HoursForm({ initial, canEdit }: { initial: Row[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);

  const update = (weekday: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));

  function copyMondayToAll() {
    const mon = rows.find((r) => r.weekday === 1)!;
    setRows((rs) => rs.map((r) => ({ ...r, isClosed: mon.isClosed, opensAt: mon.opensAt, closesAt: mon.closesAt })));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveBusinessHoursAction(rows);
      if (res.ok) toast.success(res.message ?? "Saved");
      else setError(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Opening hours</CardTitle>
        <CardDescription>
          Shown on the website and used to open and close online ordering. A closing time earlier than the opening
          time means the restaurant closes after midnight.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="divide-y rounded-lg border">
          {ORDER.map((weekday) => {
            const r = rows.find((x) => x.weekday === weekday)!;
            const overnight = !r.isClosed && r.closesAt < r.opensAt;
            return (
              <div key={weekday} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <span className="w-28 font-medium">{DAYS[weekday]}</span>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={!r.isClosed}
                    onCheckedChange={(open) => update(weekday, { isClosed: !open })}
                    disabled={!hydrated || !canEdit || pending}
                    aria-label={`${DAYS[weekday]} open`}
                  />
                  <span className="w-12 text-muted-foreground">{r.isClosed ? "Closed" : "Open"}</span>
                </label>
                {!r.isClosed && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={r.opensAt}
                      onChange={(e) => update(weekday, { opensAt: e.target.value })}
                      disabled={!hydrated || !canEdit || pending}
                      className="w-32 tabular"
                      aria-label={`${DAYS[weekday]} opens at`}
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={r.closesAt}
                      onChange={(e) => update(weekday, { closesAt: e.target.value })}
                      disabled={!hydrated || !canEdit || pending}
                      className="w-32 tabular"
                      aria-label={`${DAYS[weekday]} closes at`}
                    />
                    {overnight && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Moon className="size-3.5" /> next day
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
      {canEdit && (
        <CardFooter className="justify-between gap-2 border-t">
          <Button type="button" variant="ghost" onClick={copyMondayToAll} disabled={pending}>
            <Copy /> Copy Monday to all days
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={!dirty || pending} onClick={() => setRows(initial)}>
              Discard
            </Button>
            <Button type="button" onClick={save} disabled={!dirty || pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save hours
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
