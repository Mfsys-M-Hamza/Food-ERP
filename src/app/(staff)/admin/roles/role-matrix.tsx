"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Lock } from "lucide-react";
import type { RoleRow } from "@/server/modules/rbac/service";
import { saveRolePermissionsAction, deleteRoleAction } from "@/server/modules/rbac/actions";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

type Group = { module: string; permissions: { key: string; description: string }[] };

function toState(roles: RoleRow[]) {
  return Object.fromEntries(roles.map((r) => [r.id, new Set<string>(r.permissions)]));
}

export function RoleMatrix({ roles, groups }: { roles: RoleRow[]; groups: Group[] }) {
  const [state, setState] = useState<Record<string, Set<string>>>(() => toState(roles));
  const [pending, start] = useTransition();
  const original = useMemo(() => toState(roles), [roles]);

  const changedRoleIds = roles
    .filter((r) => {
      const a = original[r.id]!;
      const b = state[r.id]!;
      return a.size !== b.size || [...a].some((k) => !b.has(k));
    })
    .map((r) => r.id);

  function toggle(roleId: string, key: string, on: boolean) {
    setState((s) => {
      const next = new Set(s[roleId]);
      if (on) next.add(key);
      else next.delete(key);
      return { ...s, [roleId]: next };
    });
  }

  function toggleModule(roleId: string, keys: string[], on: boolean) {
    setState((s) => {
      const next = new Set(s[roleId]);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return { ...s, [roleId]: next };
    });
  }

  function save() {
    start(async () => {
      const res = await saveRolePermissionsAction(
        changedRoleIds.map((id) => ({ roleId: id, permissions: [...state[id]!] })),
      );
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  function remove(roleId: string) {
    start(async () => {
      const res = await deleteRoleAction(roleId);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 z-[1] bg-card">
              <tr className="border-b">
                <th className="w-[40%] px-4 py-3 text-left font-medium text-muted-foreground">Permission</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-2 py-3 text-center align-bottom font-medium">
                    <div className="flex flex-col items-center gap-1">
                      <span className="flex items-center gap-1">
                        {r.name}
                        {r.key === "owner" && <Lock className="size-3 text-muted-foreground" aria-label="Locked" />}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {r.userCount} user{r.userCount === 1 ? "" : "s"}
                      </span>
                      {!r.isSystem && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-6" aria-label={`Delete ${r.name}`} disabled={pending}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete the {r.name} role?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This cannot be undone. Roles that are still assigned to users cannot be deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(r.id)}>Delete role</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const keys = g.permissions.map((p) => p.key);
                return (
                  <ModuleRows
                    key={g.module}
                    group={g}
                    roles={roles}
                    state={state}
                    pending={pending}
                    onToggle={toggle}
                    onToggleModule={(roleId, on) => toggleModule(roleId, keys, on)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div
        className={`sticky bottom-4 mt-4 flex items-center justify-between gap-4 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur transition ${changedRoleIds.length ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
      >
        <span className="text-sm text-muted-foreground">
          Unsaved changes in {changedRoleIds.length} role{changedRoleIds.length === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setState(toState(roles))} disabled={pending}>
            Discard
          </Button>
          <Button onClick={save} disabled={pending} data-testid="save-permissions">
            {pending && <Loader2 className="animate-spin" />}
            Save permissions
          </Button>
        </div>
      </div>
    </>
  );
}

function ModuleRows({
  group,
  roles,
  state,
  pending,
  onToggle,
  onToggleModule,
}: {
  group: Group;
  roles: RoleRow[];
  state: Record<string, Set<string>>;
  pending: boolean;
  onToggle: (roleId: string, key: string, on: boolean) => void;
  onToggleModule: (roleId: string, on: boolean) => void;
}) {
  const keys = group.permissions.map((p) => p.key);
  return (
    <>
      <tr className="border-b bg-muted/40">
        <td className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.module}</td>
        {roles.map((r) => {
          const set = state[r.id]!;
          const count = keys.filter((k) => set.has(k)).length;
          const locked = r.key === "owner";
          return (
            <td key={r.id} className="px-2 py-2">
              <div className="flex justify-center">
                {locked ? (
                  <Badge variant="secondary" className="text-[10px]">
                    All
                  </Badge>
                ) : (
                  <Checkbox
                    checked={count === keys.length ? true : count > 0 ? "indeterminate" : false}
                    onCheckedChange={(v) => onToggleModule(r.id, v === true)}
                    disabled={pending}
                    aria-label={`${r.name}: all ${group.module} permissions`}
                  />
                )}
              </div>
            </td>
          );
        })}
      </tr>
      {group.permissions.map((p) => (
        <tr key={p.key} className="border-b last:border-0 hover:bg-muted/30">
          <td className="px-4 py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{p.description}</span>
              </TooltipTrigger>
              <TooltipContent side="right">
                <code className="text-xs">{p.key}</code>
              </TooltipContent>
            </Tooltip>
          </td>
          {roles.map((r) => (
            <td key={r.id} className="px-2 py-2">
              <div className="flex justify-center">
                <Checkbox
                  checked={r.key === "owner" ? true : state[r.id]!.has(p.key)}
                  disabled={r.key === "owner" || pending}
                  onCheckedChange={(v) => onToggle(r.id, p.key, v === true)}
                  aria-label={`${r.name}: ${p.description}`}
                  data-testid={`perm-${r.key}-${p.key}`}
                />
              </div>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
