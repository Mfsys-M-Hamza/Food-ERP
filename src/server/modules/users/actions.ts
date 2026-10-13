"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { createStaff, updateStaff, resetStaffPassword, setStaffPin, clearStaffPin } from "./service";

export async function createStaffAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const user = await createStaff(ctx, input);
    return { id: user.id };
  }, "Staff member added");
}

export async function updateStaffAction(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const user = await updateStaff(ctx, id, input);
    refresh();
    return { id: user.id };
  }, "Changes saved");
}

export async function resetStaffPasswordAction(id: string, input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await resetStaffPassword(ctx, id, input);
    return undefined;
  }, "Password changed. The user has been signed out of other devices.");
}

export async function setStaffPinAction(id: string, input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await setStaffPin(ctx, id, input);
    refresh();
    return undefined;
  }, "PIN saved");
}

export async function clearStaffPinAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await clearStaffPin(ctx, id);
    refresh();
    return undefined;
  }, "PIN removed");
}
