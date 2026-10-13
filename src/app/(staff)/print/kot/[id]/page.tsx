import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { isAppError } from "@/server/core/errors";
import { getReceiptModel } from "@/server/modules/orders/receipt";
import { AccessDenied } from "@/components/shared/access-denied";
import { formatDateTime } from "@/lib/format";
import { PrintStyles, AutoPrint } from "../../print-styles";

export const instant = false;
export const metadata: Metadata = { title: "Kitchen ticket", robots: { index: false } };

const TYPE: Record<string, string> = { TAKEAWAY: "TAKEAWAY", DELIVERY: "DELIVERY", DINE_IN: "DINE-IN" };

/** Kitchen order ticket: large, no prices — for kitchens without a screen or during outages. */
export default async function KotPage({ params }: PageProps<"/print/kot/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/print/kot/${id}`);
  let model;
  try {
    model = await getReceiptModel(ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    if (isAppError(e) && e.code === "PERMISSION_DENIED") return <AccessDenied />;
    throw e;
  }
  const { order: o, receipt } = model;
  return (
    <>
      <PrintStyles width={receipt.paperWidth} />
      <AutoPrint />
      <main className="ticket" data-testid="kot" style={{ fontSize: 14 }}>
        <div className="c bold">KITCHEN</div>
        <div className="c big" style={{ fontSize: 30 }}>#{o.displayNumber}</div>
        <div className="c bold">{TYPE[o.type]}{o.tableLabel ? ` · ${o.tableLabel}` : ""}</div>
        <div className="c">{formatDateTime(o.createdAt)}</div>
        <hr />
        {o.items.map((i) => (
          <div key={i.id} style={{ marginBottom: 6 }}>
            <div className="bold" style={{ fontSize: 16 }}>
              {i.quantity} × {i.productName}
              {i.variantName ? ` (${i.variantName})` : ""}
            </div>
            {i.addons.map((a) => (
              <div key={a.id} style={{ paddingLeft: 12 }}>+ {a.name}</div>
            ))}
            {i.removals.map((r) => (
              <div key={r.label} className="bold" style={{ paddingLeft: 12 }}>!! {r.label.toUpperCase()}</div>
            ))}
            {i.note && <div style={{ paddingLeft: 12 }}>» {i.note}</div>}
          </div>
        ))}
        {o.kitchenNote && (
          <>
            <hr />
            <div className="bold">NOTE: {o.kitchenNote}</div>
          </>
        )}
      </main>
    </>
  );
}
