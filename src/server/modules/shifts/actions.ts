"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { openShift, addCashMovement, closeShift, approveShift, type ShiftSummary } from "./service";

export async function openShiftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const s = await openShift(ctx, input);
    return { id: s.id };
  }, "Shift opened");
}

export async function cashMovementAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await addCashMovement(ctx, input);
    return undefined;
  }, "Cash movement recorded");
}

export async function closeShiftAction(input: unknown): Promise<ActionResult<ShiftSummary>> {
  return runAction(async () => {
    const ctx = await requireContext();
    return closeShift(ctx, input);
  }, "Shift closed");
}

export async function approveShiftAction(shiftId: string, note?: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await approveShift(ctx, String(shiftId), note ? String(note).slice(0, 300) : undefined);
    refresh();
    return undefined;
  }, "Shift approved");
}
