import "server-only";
import { z } from "zod";
import { db, withTransaction, Prisma } from "@/server/core/db";
import type { Ctx } from "@/server/core/context";
import { authorize, authorizeAny, can } from "@/server/core/rbac";
import { recordAudit, diffObjects } from "@/server/core/audit";
import { forbidden, notFound, validationFailed } from "@/server/core/errors";
import { zodFieldErrors } from "@/server/core/action";
import { nextSequence, formatDocNumber } from "@/server/core/numbering";
import { encryptField, decryptField, last4 } from "@/server/core/crypto";
import { dayToDate, dateToDay } from "@/server/core/today";
import { normalizePhone } from "@/lib/phone";
import { formatHm, parseHm } from "@/lib/attendance";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw validationFailed(zodFieldErrors(r.error));
  return r.data;
}

const rate = z.union([z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount"), z.literal("")]);

export const employeeSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the name").max(80),
    phone: z.string().trim().max(20).refine((v) => !v || normalizePhone(v), "Enter a valid phone").optional().default(""),
    designation: z.string().trim().min(2, "Enter the job title").max(60),
    department: z.string().trim().max(60).optional().default(""),
    employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]).default("FULL_TIME"),
    status: z.enum(["ACTIVE", "ON_LEAVE", "LEFT"]).default("ACTIVE"),
    joiningDate: z.iso.date("Enter the joining date"),
    leavingDate: z.union([z.iso.date(), z.literal("")]).optional().default(""),
    workShiftId: z.union([z.uuid(), z.literal("")]).optional().default(""),
    weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    userId: z.union([z.uuid(), z.literal("")]).optional().default(""),
    address: z.string().trim().max(300).optional().default(""),
    emergencyName: z.string().trim().max(80).optional().default(""),
    emergencyPhone: z.string().trim().max(20).optional().default(""),
    notes: z.string().trim().max(500).optional().default(""),
    // Sensitive (need employees.sensitive)
    payType: z.enum(["MONTHLY", "DAILY", "HOURLY"]).optional(),
    baseRate: rate.optional(),
    overtimeRate: rate.optional(),
    nationalId: z
      .string()
      .trim()
      .max(20)
      .refine((v) => !v || /^\d{5}-?\d{7}-?\d$/.test(v), "Use the 13-digit CNIC, e.g. 35202-1234567-1")
      .optional(),
    bankName: z.string().trim().max(60).optional(),
    bankAccount: z.string().trim().max(40).optional(),
  })
  .superRefine((v, c) => {
    if (v.leavingDate && v.leavingDate < v.joiningDate) c.addIssue({ code: "custom", path: ["leavingDate"], message: "Cannot be before the joining date" });
    if (v.status === "LEFT" && !v.leavingDate) c.addIssue({ code: "custom", path: ["leavingDate"], message: "Enter the last working day" });
  });
export type EmployeeInput = z.input<typeof employeeSchema>;

const SENSITIVE = ["payType", "baseRate", "overtimeRate", "nationalId", "bankName", "bankAccount"] as const;

function formatCnic(v: string) {
  const d = v.replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : v;
}

export type EmployeeRow = {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string;
  phone: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "LEFT";
  joiningDate: string;
  workShift: string | null;
  userName: string | null;
  payType: string | null;
  baseRate: string | null;
  openAdvances: string | null;
};

export async function listEmployees(ctx: Ctx, f: { q?: string; status?: string } = {}): Promise<EmployeeRow[]> {
  authorizeAny(ctx, ["employees.manage", "attendance.manage", "payroll.prepare"]);
  const sensitive = can(ctx, "employees.sensitive");
  const q = f.q?.trim();
  const status = f.status === "ALL" ? undefined : f.status === "LEFT" ? "LEFT" : f.status === "ON_LEAVE" ? "ON_LEAVE" : f.status === "ACTIVE" ? "ACTIVE" : undefined;
  const rows = await db.employee.findMany({
    where: {
      branchId: ctx.branchId,
      deletedAt: null,
      ...(status ? { status } : f.status === "ALL" ? {} : { status: { not: "LEFT" } }),
      ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { employeeCode: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { designation: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ status: "asc" }, { fullName: "asc" }],
    include: {
      workShift: { select: { name: true } },
      user: { select: { name: true } },
      advances: sensitive ? { where: { status: "OPEN" }, select: { amount: true, recoveredAmount: true } } : false,
    },
  });
  return rows.map((e) => ({
    id: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    designation: e.designation,
    phone: e.phone,
    status: e.status,
    joiningDate: dateToDay(e.joiningDate),
    workShift: e.workShift?.name ?? null,
    userName: e.user?.name ?? null,
    payType: sensitive ? e.payType : null,
    baseRate: sensitive ? e.baseRate.toFixed(2) : null,
    openAdvances: sensitive ? (e.advances ?? []).reduce((a, x) => a.plus(x.amount).minus(x.recoveredAmount), D(0)).toFixed(2) : null,
  }));
}

export async function getEmployee(ctx: Ctx, id: string) {
  authorizeAny(ctx, ["employees.manage", "attendance.manage", "payroll.prepare"]);
  const e = await db.employee.findFirst({
    where: { id, branchId: ctx.branchId, deletedAt: null },
    include: { user: { select: { id: true, name: true, email: true } }, workShift: true },
  });
  if (!e) throw notFound("Employee");
  const sensitive = can(ctx, "employees.sensitive");
  let nationalId = "";
  let bankAccount = "";
  if (sensitive && (e.nationalIdEnc || e.bankAccountEnc)) {
    nationalId = decryptField(e.nationalIdEnc) ?? "";
    bankAccount = decryptField(e.bankAccountEnc) ?? "";
    // Reading decrypted identity data is itself audited.
    await recordAudit(db, ctx, { action: "employee.sensitive_view", module: "employees", entityType: "employee", entityId: e.id });
  }
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    sensitive,
    linkedUser: e.user,
    form: {
      fullName: e.fullName,
      phone: e.phone ?? "",
      designation: e.designation,
      department: e.department ?? "",
      employmentType: e.employmentType,
      status: e.status,
      joiningDate: dateToDay(e.joiningDate),
      leavingDate: e.leavingDate ? dateToDay(e.leavingDate) : "",
      workShiftId: e.workShiftId ?? "",
      weeklyOffDays: e.weeklyOffDays,
      userId: e.userId ?? "",
      address: e.address ?? "",
      emergencyName: e.emergencyName ?? "",
      emergencyPhone: e.emergencyPhone ?? "",
      notes: e.notes ?? "",
      ...(sensitive
        ? {
            payType: e.payType,
            baseRate: e.baseRate.toFixed(2),
            overtimeRate: e.overtimeRate?.toFixed(2) ?? "",
            nationalId,
            bankName: e.bankName ?? "",
            bankAccount,
          }
        : {}),
    } satisfies EmployeeInput,
    nationalIdHint: e.nationalIdLast4 ? `•••• ${e.nationalIdLast4}` : null,
    workShift: e.workShift ? { name: e.workShift.name, start: formatHm(e.workShift.startMinute), end: formatHm(e.workShift.endMinute) } : null,
  };
}

export async function saveEmployee(ctx: Ctx, id: string | null, input: unknown) {
  authorize(ctx, "employees.manage");
  const d = parse(employeeSchema, input);
  const sensitive = can(ctx, "employees.sensitive");
  if (!sensitive && SENSITIVE.some((k) => d[k] !== undefined && d[k] !== "")) {
    throw forbidden("You cannot set salary, CNIC or bank details.");
  }
  return withTransaction(async (tx) => {
    if (d.userId) {
      const u = await tx.user.findFirst({ where: { id: d.userId, kind: "STAFF" } });
      if (!u) throw validationFailed({ userId: ["Choose a staff login"] });
      const taken = await tx.employee.findFirst({ where: { userId: d.userId, deletedAt: null, ...(id ? { NOT: { id } } : {}) } });
      if (taken) throw validationFailed({ userId: [`Already linked to ${taken.fullName}`] });
    }
    if (d.workShiftId) {
      const ws = await tx.workShift.findFirst({ where: { id: d.workShiftId, branchId: ctx.branchId } });
      if (!ws) throw validationFailed({ workShiftId: ["Unknown shift"] });
    }
    const common = {
      fullName: d.fullName,
      phone: d.phone ? normalizePhone(d.phone) : null,
      designation: d.designation,
      department: d.department || null,
      employmentType: d.employmentType,
      status: d.status,
      joiningDate: dayToDate(d.joiningDate),
      leavingDate: d.leavingDate ? dayToDate(d.leavingDate) : null,
      workShiftId: d.workShiftId || null,
      weeklyOffDays: [...new Set(d.weeklyOffDays)].sort(),
      userId: d.userId || null,
      address: d.address || null,
      emergencyName: d.emergencyName || null,
      emergencyPhone: d.emergencyPhone || null,
      notes: d.notes || null,
    };
    const secret: Prisma.EmployeeUncheckedUpdateInput = {};
    if (sensitive) {
      if (d.payType !== undefined) secret.payType = d.payType;
      if (d.baseRate !== undefined) secret.baseRate = D(d.baseRate || 0);
      if (d.overtimeRate !== undefined) secret.overtimeRate = d.overtimeRate ? D(d.overtimeRate) : null;
      if (d.nationalId !== undefined) {
        const cnic = d.nationalId ? formatCnic(d.nationalId) : "";
        secret.nationalIdEnc = cnic ? encryptField(cnic) : null;
        secret.nationalIdLast4 = cnic ? last4(cnic) : null;
      }
      if (d.bankName !== undefined) secret.bankName = d.bankName || null;
      if (d.bankAccount !== undefined) secret.bankAccountEnc = d.bankAccount ? encryptField(d.bankAccount) : null;
    }
    // Audit records which sensitive fields changed, never their values.
    const changedSecret = Object.keys(secret).filter((k) => !k.endsWith("Last4"));

    if (id) {
      const before = await tx.employee.findFirst({ where: { id, branchId: ctx.branchId, deletedAt: null } });
      if (!before) throw notFound("Employee");
      await tx.employee.update({ where: { id }, data: { ...common, ...secret } });
      const b = { ...common, joiningDate: dateToDay(before.joiningDate), leavingDate: before.leavingDate ? dateToDay(before.leavingDate) : null };
      const diff = diffObjects(
        { fullName: before.fullName, designation: before.designation, status: before.status, joiningDate: b.joiningDate, leavingDate: b.leavingDate, workShiftId: before.workShiftId, userId: before.userId, phone: before.phone },
        { fullName: common.fullName, designation: common.designation, status: common.status, joiningDate: d.joiningDate, leavingDate: d.leavingDate || null, workShiftId: common.workShiftId, userId: common.userId, phone: common.phone },
      );
      const rateChanged = sensitive && d.baseRate !== undefined && !before.baseRate.equals(D(d.baseRate || 0));
      await recordAudit(tx, ctx, {
        action: "employee.update",
        module: "employees",
        entityType: "employee",
        entityId: id,
        before: { ...diff.before, ...(rateChanged ? { baseRate: before.baseRate.toFixed(2) } : {}) },
        after: { ...diff.after, ...(rateChanged ? { baseRate: D(d.baseRate || 0).toFixed(2) } : {}), sensitiveFields: changedSecret },
      });
      return { id };
    }
    const n = await nextSequence(tx, ctx.branchId, "EMPLOYEE", "ALL");
    const e = await tx.employee.create({
      data: { ...common, ...(secret as Prisma.EmployeeUncheckedCreateInput), branchId: ctx.branchId, employeeCode: formatDocNumber("EMP", n, 3) },
    });
    await recordAudit(tx, ctx, { action: "employee.create", module: "employees", entityType: "employee", entityId: e.id, after: { employeeCode: e.employeeCode, fullName: e.fullName, designation: e.designation } });
    return { id: e.id };
  });
}

/** Staff logins that can be linked to an employee (not linked elsewhere). */
export async function linkableUsers(ctx: Ctx, employeeId?: string) {
  authorize(ctx, "employees.manage");
  const users = await db.user.findMany({
    where: { kind: "STAFF", OR: [{ employee: null }, ...(employeeId ? [{ employee: { id: employeeId } }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
  return users;
}

// ═══ Work shifts ═════════════════════════════════════════════════════════════

export const workShiftSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(40),
  start: z.string().refine((v) => parseHm(v) !== null, "Use HH:MM"),
  end: z.string().refine((v) => parseHm(v) !== null, "Use HH:MM"),
  graceMinutes: z.coerce.number().int().min(0).max(120).default(10),
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  isActive: z.boolean().default(true),
});

export async function listWorkShifts(ctx: Ctx) {
  authorizeAny(ctx, ["employees.manage", "attendance.manage"]);
  const rows = await db.workShift.findMany({ where: { branchId: ctx.branchId }, orderBy: [{ isActive: "desc" }, { startMinute: "asc" }], include: { _count: { select: { employees: { where: { deletedAt: null, status: { not: "LEFT" } } } } } } });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    start: formatHm(s.startMinute),
    end: formatHm(s.endMinute),
    graceMinutes: s.graceMinutes,
    breakMinutes: s.breakMinutes,
    isActive: s.isActive,
    employees: s._count.employees,
  }));
}

export async function saveWorkShift(ctx: Ctx, id: string | null, input: unknown) {
  authorize(ctx, "employees.manage");
  const d = parse(workShiftSchema, input);
  if (d.start === d.end) throw validationFailed({ end: ["End must differ from start"] });
  const data = { name: d.name, startMinute: parseHm(d.start)!, endMinute: parseHm(d.end)!, graceMinutes: d.graceMinutes, breakMinutes: d.breakMinutes, isActive: d.isActive };
  return withTransaction(async (tx) => {
    if (id) {
      const before = await tx.workShift.findFirst({ where: { id, branchId: ctx.branchId } });
      if (!before) throw notFound("Shift");
      await tx.workShift.update({ where: { id }, data });
      await recordAudit(tx, ctx, { action: "work_shift.update", module: "attendance", entityType: "work_shift", entityId: id, ...diffObjects({ name: before.name, startMinute: before.startMinute, endMinute: before.endMinute, graceMinutes: before.graceMinutes, breakMinutes: before.breakMinutes, isActive: before.isActive }, data) });
      return { id };
    }
    const s = await tx.workShift.create({ data: { ...data, branchId: ctx.branchId } });
    await recordAudit(tx, ctx, { action: "work_shift.create", module: "attendance", entityType: "work_shift", entityId: s.id, after: data });
    return { id: s.id };
  });
}

export async function workShiftOptions(ctx: Ctx) {
  authorizeAny(ctx, ["employees.manage", "attendance.manage"]);
  const rows = await db.workShift.findMany({ where: { branchId: ctx.branchId, isActive: true }, orderBy: { startMinute: "asc" } });
  return rows.map((s) => ({ id: s.id, label: `${s.name} (${formatHm(s.startMinute)}–${formatHm(s.endMinute)})` }));
}

/** Employees on the books on a date (joined, not yet left). */
export async function employeesOn(branchId: string, isoDate: string) {
  const day = dayToDate(isoDate);
  return db.employee.findMany({
    where: { branchId, deletedAt: null, joiningDate: { lte: day }, OR: [{ leavingDate: null }, { leavingDate: { gte: day } }] },
    orderBy: { fullName: "asc" },
    include: { workShift: true },
  });
}

