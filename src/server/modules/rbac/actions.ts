"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { createRole, deleteRole, updateRolePermissions } from "./service";

export async function createRoleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const role = await createRole(ctx, input);
    refresh();
    return { id: role.id };
  }, "Role created");
}

/** Save several roles' permission sets at once (matrix editor). */
export async function saveRolePermissionsAction(
  changes: { roleId: string; permissions: string[] }[],
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    if (!Array.isArray(changes) || changes.length > 50) throw new Error("Invalid input");
    for (const c of changes) await updateRolePermissions(ctx, String(c.roleId), c.permissions);
    refresh();
    return undefined;
  }, "Permissions saved");
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await deleteRole(ctx, roleId);
    refresh();
    return undefined;
  }, "Role deleted");
}
