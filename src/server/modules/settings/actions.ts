"use server";

import { refresh, updateTag } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import { validationFailed } from "@/server/core/errors";
import { authorize } from "@/server/core/rbac";
import { uploadPublicImage } from "@/server/core/storage";
import { isSettingsKey } from "@/lib/settings/registry";
import { updateBusinessHours, updateSetting } from "./service";

export async function saveSettingsAction(key: string, values: unknown): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    if (!isSettingsKey(key)) throw validationFailed({ _form: ["Unknown settings section"] });
    const ctx = await requireContext();
    const saved = await updateSetting(ctx, key, values);
    updateTag("settings");
    refresh();
    return saved;
  }, "Settings saved");
}

export async function saveBusinessHoursAction(rows: unknown): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const saved = await updateBusinessHours(ctx, rows);
    updateTag("settings");
    refresh();
    return saved;
  }, "Opening hours saved");
}

/** Upload a logo image; the caller then saves the returned URL in business.profile. */
export async function uploadLogoAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    authorize(ctx, "settings.manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw validationFailed({ file: ["Choose an image file"] });
    const { url } = await uploadPublicImage(ctx, file, { folder: "branding", maxBytes: 2 * 1024 * 1024 });
    return { url };
  }, "Logo uploaded");
}
