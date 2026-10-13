import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { isAppError } from "@/server/core/errors";
import { getReceiptModel } from "@/server/modules/orders/receipt";
import { AccessDenied } from "@/components/shared/access-denied";
import { formatMoney, money } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { PrintStyles, AutoPrint } from "../../print-styles";

export const instant = false;
export const metadata: Metadata = { title: "Receipt", robots: { index: false } };

const METHOD: Record<string, string> = { CASH: "Cash", CARD: "Card", ONLINE: "Online", WALLET: "Wallet", LOYALTY: "Points" };
const TYPE: Record<string, string> = { TAKEAWAY: "Takeaway", DELIVERY: "Delivery", DINE_IN: "Dine-in" };

export default async function ReceiptPage({ params }: PageProps<"/print/receipt/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/print/receipt/${id}`);
  let model;
  try {
    model = await getReceiptModel(ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    if (isAppError(e) && e.code === "PERMISSION_DENIED") return <AccessDenied />;
    throw e;
  }
  const { order: o, profile, receipt, finance } = model;
  const m = (v: string) => formatMoney(v, { symbol: finance.currencySymbol });
  const change = o.payments.reduce((s, p) => s.plus(p.changeGiven ?? 0), money(0));

  return (
    <>
      <PrintStyles width={receipt.paperWidth} />
      <AutoPrint />
      <main className="ticket" data-testid="receipt">
        {receipt.showLogo && profile.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- printed receipt
          <img src={profile.logoUrl} alt="" />
        )}
        <h1>{profile.name}</h1>
        {profile.address && <div className="c">{[profile.address, profile.city].filter(Boolean).join(", ")}</div>}
        {profile.phone && <div className="c">Tel {profile.phone}</div>}
        {profile.taxNumber && <div className="c">NTN {profile.taxNumber}</div>}
        {receipt.header && <div className="c" style={{ whiteSpace: "pre-line", marginTop: 4 }}>{receipt.header}</div>}
        <hr />
        <div className="c big">#{o.displayNumber}</div>
        <div className="row"><span>Order</span><span>{o.orderNumber}</span></div>
        <div className="row"><span>Date</span><span>{formatDateTime(o.createdAt)}</span></div>
        <div className="row"><span>Type</span><span>{TYPE[o.type]}{o.tableLabel ? ` · ${o.tableLabel}` : ""}</span></div>
        {receipt.showCashier && o.createdBy && <div className="row"><span>Cashier</span><span>{o.createdBy}</span></div>}
        {(o.customerName || o.customerPhone) && (
          <div className="row"><span>Customer</span><span>{[o.customerName, formatPhone(o.customerPhone)].filter(Boolean).join(" ")}</span></div>
        )}
        {o.delivery && <div className="muted" style={{ marginTop: 2 }}>Deliver to: {o.delivery.addressText}{o.delivery.landmark ? ` (${o.delivery.landmark})` : ""}</div>}
        <hr />
        {o.items.map((i) => (
          <div key={i.id} style={{ marginBottom: 3 }}>
            <div className="row">
              <span>
                {i.quantity} × {i.productName}
                {i.variantName ? ` (${i.variantName})` : ""}
              </span>
              <span>{m(i.lineTotal)}</span>
            </div>
            <div className="muted" style={{ paddingLeft: 10 }}>
              @ {m(money(i.unitPrice).plus(i.addonsUnitTotal).toFixed(2))}
              {i.addons.map((a) => (
                <div key={a.id}>+ {a.name}</div>
              ))}
              {i.removals.map((r) => (
                <div key={r.label}>{r.label}</div>
              ))}
            </div>
          </div>
        ))}
        <hr />
        <div className="row"><span>Subtotal</span><span>{m(o.subtotal)}</span></div>
        {money(o.discountTotal).greaterThan(0) && <div className="row"><span>Discount</span><span>-{m(o.discountTotal)}</span></div>}
        {money(o.serviceCharge).greaterThan(0) && <div className="row"><span>Service charge</span><span>{m(o.serviceCharge)}</span></div>}
        {money(o.taxTotal).greaterThan(0) && receipt.showTaxBreakdown && (
          <div className="row"><span>{finance.taxLabel} {o.taxRate}%{o.taxInclusive ? " (incl.)" : ""}</span><span>{m(o.taxTotal)}</span></div>
        )}
        {money(o.deliveryCharge).greaterThan(0) && <div className="row"><span>Delivery</span><span>{m(o.deliveryCharge)}</span></div>}
        {!money(o.roundingAdjustment).isZero() && <div className="row"><span>Rounding</span><span>{m(o.roundingAdjustment)}</span></div>}
        <div className="row bold big" style={{ fontSize: 16 }}><span>TOTAL</span><span>{m(o.grandTotal)}</span></div>
        <hr />
        {o.payments.map((p) => (
          <div key={p.id} className="row"><span>Paid · {METHOD[p.method]}</span><span>{m(p.tendered ?? p.amount)}</span></div>
        ))}
        {change.greaterThan(0) && <div className="row"><span>Change</span><span>{m(change.toFixed(2))}</span></div>}
        {money(o.balanceDue).greaterThan(0) && <div className="row bold"><span>BALANCE DUE</span><span>{m(o.balanceDue)}</span></div>}
        {o.refunds.map((r) => (
          <div key={r.id} className="row"><span>Refund {r.refundNumber}</span><span>-{m(r.amount)}</span></div>
        ))}
        {o.status === "CANCELLED" && <div className="c bold">*** CANCELLED ***</div>}
        <hr />
        <div className="c" style={{ whiteSpace: "pre-line" }}>{receipt.footer}</div>
      </main>
    </>
  );
}
