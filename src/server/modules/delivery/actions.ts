"use server";

import { refresh, updateTag } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { saveZone, archiveZone } from "./zones";

export async function saveZoneAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const r = await saveZone(ctx, id ? String(id) : null, input);
    updateTag("settings");
    refresh();
    return r;
  }, "Delivery area saved");
}

export async function archiveZoneAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await archiveZone(ctx, String(id));
    updateTag("settings");
    refresh();
    return undefined;
  }, "Delivery area removed");
}
