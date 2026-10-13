import type { Metadata } from "next";
import { requireStaffPage } from "@/server/core/page-guard";
import { can } from "@/server/core/rbac";
import { AccessDenied } from "@/components/shared/access-denied";
import { QueryProvider } from "@/components/shared/query-provider";
import { PosApp } from "@/features/pos/pos-app";

export const instant = false;
export const metadata: Metadata = { title: "POS" };

export default async function PosPage() {
  const ctx = await requireStaffPage("/pos");
  if (!can(ctx, "pos.use")) return <AccessDenied />;
  return (
    <QueryProvider>
      <PosApp />
    </QueryProvider>
  );
}
