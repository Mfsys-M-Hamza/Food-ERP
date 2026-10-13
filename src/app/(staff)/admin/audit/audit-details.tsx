"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

function asEntries(v: unknown): [string, unknown][] {
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.entries(v as Record<string, unknown>);
  return v === null || v === undefined ? [] : [["value", v]];
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Expandable before → after comparison for one audit entry. */
export function AuditDetails({
  before,
  after,
  ip,
  userAgent,
}: {
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}) {
  const [open, setOpen] = useState(false);
  const b = Object.fromEntries(asEntries(before));
  const a = Object.fromEntries(asEntries(after));
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (keys.length === 0 && !ip) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        {keys.length ? `${keys.length} field${keys.length === 1 ? "" : "s"}` : "Details"}
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto rounded-lg border bg-muted/30">
          {keys.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Field</th>
                  <th className="px-3 py-1.5 font-medium">Before</th>
                  <th className="px-3 py-1.5 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k} className="border-b last:border-0 align-top">
                    <td className="px-3 py-1.5 font-mono">{k}</td>
                    <td className="max-w-xs break-words px-3 py-1.5 text-destructive/90">{k in b ? show(b[k]) : "—"}</td>
                    <td className="max-w-xs break-words px-3 py-1.5 text-success">{k in a ? show(a[k]) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(ip || userAgent) && (
            <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
              {ip && <>IP {ip} · </>}
              {userAgent}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
