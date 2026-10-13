import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { getAllSettings } from "@/server/modules/settings/service";
import { sectionBySlug } from "@/lib/settings/registry";
import { AccessDenied } from "@/components/shared/access-denied";
import { SettingsForm } from "./settings-form";

export async function generateMetadata({ params }: PageProps<"/admin/settings/[section]">): Promise<Metadata> {
  const { section } = await params;
  return { title: sectionBySlug(section)?.title ?? "Settings" };
}

export default async function SettingsSectionPage({ params }: PageProps<"/admin/settings/[section]">) {
  const { section: slug } = await params;
  const section = sectionBySlug(slug);
  if (!section) notFound();

  const ctx = await requireStaffPage(`/admin/settings/${slug}`);
  if (!can(ctx, "settings.view")) return <AccessDenied />;

  const all = await getAllSettings(ctx);
  return (
    <SettingsForm
      key={section.key}
      section={section}
      initialValues={all[section.key] as Record<string, unknown>}
      canEdit={can(ctx, "settings.manage")}
    />
  );
}
