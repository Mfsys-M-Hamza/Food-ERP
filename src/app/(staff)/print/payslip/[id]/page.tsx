import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";
import { requireStaffPage } from "@/server/core/page-guard";
import { canAny } from "@/server/core/rbac";
import { isAppError } from "@/server/core/errors";
import { getPayslip } from "@/server/modules/people/payroll";
import { getSetting } from "@/server/modules/settings/service";
import { AccessDenied } from "@/components/shared/access-denied";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { formatMinutes } from "@/lib/attendance";
import { AutoPrint } from "../../print-styles";

export const instant = false;
export const metadata: Metadata = { title: "Salary slip", robots: { index: false } };

const PAY: Record<string, string> = { MONTHLY: "Monthly salary", DAILY: "Daily wage", HOURLY: "Hourly rate" };

export default async function PayslipPrintPage({ params }: PageProps<"/print/payslip/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaffPage(`/print/payslip/${id}`);
  if (!canAny(ctx, ["payroll.prepare", "payroll.approve"])) return <AccessDenied />;
  const p = await getPayslip(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const profile = await getSetting("business.profile");
  const earnings = p.lines.filter((l) => l.kind === "EARNING");
  const deductions = p.lines.filter((l) => l.kind === "DEDUCTION");
  const rows = Math.max(earnings.length, deductions.length);

  return (
    <>
      <style>{`
        @page { size: A5; margin: 12mm; }
        html, body { background: #fff !important; color: #000 !important; }
        .slip { max-width: 180mm; margin: 0 auto; font: 12px/1.45 system-ui, sans-serif; }
        .slip h1 { font-size: 18px; margin: 0; }
        .slip h2 { font-size: 14px; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: .04em; }
        .slip table { width: 100%; border-collapse: collapse; }
        .slip td, .slip th { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
        .slip th { background: #f2f2f2; }
        .slip .r { text-align: right; font-variant-numeric: tabular-nums; }
        .slip .net { font-size: 16px; font-weight: 700; }
        .slip .meta td { border: 0; padding: 1px 0; }
        .slip .sig { display: flex; justify-content: space-between; margin-top: 36px; }
        .slip .sig div { border-top: 1px solid #000; padding-top: 4px; width: 40%; text-align: center; }
        @media screen { body { background: #e5e5e5 !important; } .slip { background: #fff; padding: 12mm; margin: 16px auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
      `}</style>
      <AutoPrint />
      <main className="slip" data-testid="payslip-print">
        <h1>{profile.name}</h1>
        <div>{[profile.address, profile.city].filter(Boolean).join(", ")}</div>
        <h2>
          Salary slip · {formatDate(p.run.periodStart)} – {formatDate(p.run.periodEnd)}
        </h2>
        <table className="meta">
          <tbody>
            <tr>
              <td>Employee</td>
              <td>
                <b>{p.employeeName}</b> ({p.employeeCode})
              </td>
              <td>Payroll</td>
              <td>{p.run.runNumber}</td>
            </tr>
            <tr>
              <td>Designation</td>
              <td>{p.designation}</td>
              <td>{PAY[p.payType]}</td>
              <td>{formatMoney(p.baseRate)}</td>
            </tr>
            <tr>
              <td>Days</td>
              <td>
                {p.periodDays} in period · present {Number(p.presentDays)} · absent {Number(p.absentDays)} · leave {Number(p.leaveDays)} · off {p.offDays}
              </td>
              <td>Late / overtime</td>
              <td>
                {p.lateCount} · {formatMinutes(p.overtimeMinutes)}
              </td>
            </tr>
          </tbody>
        </table>
        <h2>Pay</h2>
        <table>
          <thead>
            <tr>
              <th>Earnings</th>
              <th className="r">Rs</th>
              <th>Deductions</th>
              <th className="r">Rs</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i}>
                <td>{earnings[i]?.label ?? ""}</td>
                <td className="r">{earnings[i] ? formatMoney(earnings[i].amount, { symbol: "" }) : ""}</td>
                <td>{deductions[i]?.label ?? ""}</td>
                <td className="r">{deductions[i] ? formatMoney(deductions[i].amount, { symbol: "" }) : ""}</td>
              </tr>
            ))}
            <tr>
              <th>Gross</th>
              <th className="r">{formatMoney(p.gross, { symbol: "" })}</th>
              <th>Total deductions</th>
              <th className="r">{formatMoney(p.deductions, { symbol: "" })}</th>
            </tr>
          </tbody>
        </table>
        <p className="net">Net pay: {formatMoney(p.net)}</p>
        <p>
          {p.paidAt ? `Paid on ${formatDate(p.paidAt)}` : p.run.status === "DRAFT" ? "DRAFT: not yet approved" : "Approved, payment pending"}
        </p>
        <div className="sig">
          <div>Employee signature</div>
          <div>Authorised by</div>
        </div>
      </main>
    </>
  );
}
