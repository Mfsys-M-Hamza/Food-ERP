import { PageHeader } from "@/components/shared/page-header";
import { SettingsNav } from "./settings-nav";
import { SETTINGS_SECTIONS } from "@/lib/settings/registry";

export default function SettingsLayout({ children }: LayoutProps<"/admin/settings">) {
  const items = [
    ...SETTINGS_SECTIONS.slice(0, 1).map((s) => ({ slug: s.slug, title: s.title })),
    { slug: "hours", title: "Opening hours" },
    ...SETTINGS_SECTIONS.slice(1).map((s) => ({ slug: s.slug, title: s.title })),
  ];
  return (
    <>
      <PageHeader title="Settings" description="Business information and rules used across the whole system." />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <SettingsNav items={items} />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
