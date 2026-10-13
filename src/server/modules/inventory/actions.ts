"use server";

import { refresh, updateTag } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { saveIngredient, archiveIngredient, adjustStock, startStockCount, saveStockCount, postStockCount, ingredientUnits } from "./service";
import { saveRecipe, setRemovableIngredient } from "./recipes";
import { recordWastage } from "./wastage";

export async function saveIngredientAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await saveIngredient(await requireContext(), id ? String(id) : null, input);
    refresh();
    return r;
  }, "Ingredient saved");
}

export async function archiveIngredientAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await archiveIngredient(await requireContext(), String(id));
    refresh();
    return undefined;
  }, "Ingredient archived");
}

export async function adjustStockAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await adjustStock(await requireContext(), input);
    refresh();
    return undefined;
  }, "Stock adjusted");
}

export async function ingredientUnitsAction(ingredientId: string) {
  return runAction(async () => {
    await requireContext();
    return ingredientUnits(String(ingredientId));
  });
}

export async function startStockCountAction(note?: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => startStockCount(await requireContext(), note ? String(note) : undefined));
}

export async function saveStockCountAction(id: string, lines: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await saveStockCount(await requireContext(), String(id), lines);
    return undefined;
  }, "Count saved");
}

export async function postStockCountAction(id: string): Promise<ActionResult<{ varianceValue: string }>> {
  return runAction(async () => {
    const r = await postStockCount(await requireContext(), String(id));
    refresh();
    return r;
  }, "Count posted — stock updated");
}

export async function saveRecipeAction(input: unknown): Promise<ActionResult<{ cost: string | null }>> {
  return runAction(async () => {
    const r = await saveRecipe(await requireContext(), input);
    updateTag("menu");
    return r;
  }, "Recipe saved");
}

export async function setRemovableIngredientAction(removableId: string, ingredientId: string | null): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await setRemovableIngredient(await requireContext(), String(removableId), ingredientId ? String(ingredientId) : null);
    return undefined;
  }, "Saved");
}

export async function recordWastageAction(input: unknown) {
  return runAction(async () => {
    const r = await recordWastage(await requireContext(), input);
    refresh();
    return r;
  }, "Wastage recorded");
}
