"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { saveAttendanceAction, markManyAction } from "@/server/modules/people/actions";
import type { AttendanceSheetRow } from "@/server/modules/people/attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_LABEL, ATTENDANCE_STATUSES, WORKED_STATUSES, formatMinutes, type AttendanceStatusKey } from "@/lib/attendance";
import { cn } from "@/lib/utils";

export function AttendanceSheet({ date, rows, editable }: { date: string; rows: AttendanceSheetRow[]; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unrecorded = rows.filter((r) => !r.record && !r.expectedOff);
  return (
    <div className="space-y-3">
      {editable && unrecorded.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>{unrecorded.length} without an entry for this day.</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            data-testid="mark-all-present"
            onClick={() =>
              start(async () => {
                const r = await markManyAction({ workDate: date, status: "PRESENT", employeeIds: unrecorded.map((u) => u.employeeId) });
                if (r.ok) {
                  toast.success(`${r.data.marked} marked present`);
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Mark them present
          </Button>
        </div>
      )}
      <div className="divide-y rounded-xl border">
        {rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No employees on this date. Add staff under Employees.</p>}
        {rows.map((r) => (
          <SheetRow key={`${r.employeeId}-${date}-${r.record?.status ?? ""}-${r.record?.checkIn ?? ""}-${r.record?.checkOut ?? ""}`} row={r} date={date} editable={editable} />
        ))}
      </div>
    </div>
  );
}

function SheetRow({ row, date, editable }: { row: AttendanceSheetRow; date: string; editable: boolean }) {
  const router = useRouter();
  const rec = row.record;
  const [status, setStatus] = useState<AttendanceStatusKey | "">(rec?.status ?? "");
  const [checkIn, setCheckIn] = useState(rec?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(rec?.checkOut ?? "");
  const [pending, start] = useTransition();
  const locked = !!rec?.locked;
  const dirty = status !== (rec?.status ?? "") || checkIn !== (rec?.checkIn ?? "") || checkOut !== (rec?.checkOut ?? "");
  const worked = status !== "" && WORKED_STATUSES.includes(status);

  function save() {
    if (!status) return;
    start(async () => {
      const r = await saveAttendanceAction({ employeeId: row.employeeId, workDate: date, status, checkIn: worked ? checkIn : "", checkOut: worked ? checkOut : "" });
      if (r.ok) {
        toast.success(`${row.name}: ${ATTENDANCE_LABEL[r.data.status]}${r.data.lateMinutes ? `, ${r.data.lateMinutes} min late` : ""}`);
        router.refresh();
      } else toast.error(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`attendance-${row.name}`}>
      <div className="min-w-44 flex-1">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted-foreground">
          {row.designation}
          {row.shift && ` · ${row.shift}`}
          {row.expectedOff && " · day off"}
        </div>
      </div>
      {rec && !dirty && (
        <div className="flex flex-wrap gap-1 text-xs">
          {rec.lateMinutes > 0 && <Badge variant="outline">{rec.lateMinutes} min late</Badge>}
          {rec.workedMinutes > 0 && <Badge variant="secondary">{formatMinutes(rec.workedMinutes)}</Badge>}
          {rec.overtimeMinutes > 0 && <Badge>{formatMinutes(rec.overtimeMinutes)} overtime</Badge>}
          {rec.source === "SELF" && <Badge variant="outline">Self check-in</Badge>}
        </div>
      )}
      {locked ? (
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <Lock className="size-3.5" /> {ATTENDANCE_LABEL[rec!.status]} {rec!.checkIn && `${rec!.checkIn}–${rec!.checkOut || "…"}`}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`${row.name} status`}
            disabled={!editable}
            className={cn("h-9 rounded-md border border-input bg-transparent px-2 text-sm", !status && "text-muted-foreground")}
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatusKey)}
          >
            <option value="">Not recorded</option>
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ATTENDANCE_LABEL[s]}
              </option>
            ))}
          </select>
          {worked && (
            <>
              <Input type="time" aria-label={`${row.name} check in`} className="h-9 w-28" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} disabled={!editable} />
              <Input type="time" aria-label={`${row.name} check out`} className="h-9 w-28" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} disabled={!editable} />
            </>
          )}
          {editable && (
            <Button size="sm" disabled={!dirty || !status || pending} onClick={save} aria-label={`Save ${row.name}`}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
