"use server";

import { refresh, updateTag } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { validationFailed } from "@/server/core/errors";
import { authorize } from "@/server/core/rbac";
import { uploadPublicImage } from "@/server/core/storage";
import {
  archiveAddonGroup,
  archiveCategory,
  archiveProduct,
  createCategory,
  createProduct,
  reorderCategories,
  saveAddonGroup,
  setAvailability,
  updateCategory,
  updateProduct,
} from "./service";

/** Menu changes invalidate cached customer menus (tag "menu") and refresh the admin view. */
function menuChanged() {
  updateTag("menu");
  refresh();
}

export async function saveCategoryAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const c = id ? await updateCategory(ctx, id, input) : await createCategory(ctx, input);
    menuChanged();
    return { id: c.id };
  }, "Category saved");
}

export async function archiveCategoryAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await archiveCategory(ctx, id);
    menuChanged();
    return undefined;
  }, "Category archived");
}

export async function reorderCategoriesAction(ids: string[]): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await reorderCategories(ctx, ids);
    menuChanged();
    return undefined;
  });
}

export async function saveProductAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const r = id ? await updateProduct(ctx, id, input) : await createProduct(ctx, input);
    menuChanged();
    return r;
  }, "Product saved");
}

export async function archiveProductAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await archiveProduct(ctx, id);
    menuChanged();
    return undefined;
  }, "Product archived");
}

export async function setAvailabilityAction(input: {
  productId: string;
  variantId?: string | null;
  available: boolean;
}): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await setAvailability(ctx, {
      productId: String(input?.productId),
      variantId: input?.variantId ? String(input.variantId) : null,
      available: input?.available === true,
    });
    menuChanged();
    return undefined;
  }, input?.available ? "Marked available" : "Marked out of stock");
}

export async function saveAddonGroupAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const r = await saveAddonGroup(ctx, id, input);
    menuChanged();
    return r;
  }, "Add-on group saved");
}

export async function archiveAddonGroupAction(id: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await archiveAddonGroup(ctx, id);
    menuChanged();
    return undefined;
  }, "Add-on group archived");
}

export async function uploadMenuImageAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    authorize(ctx, "menu.manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw validationFailed({ file: ["Choose an image file"] });
    const { url } = await uploadPublicImage(ctx, file, { folder: "menu", maxBytes: 3 * 1024 * 1024 });
    return { url };
  }, "Image uploaded");
}
