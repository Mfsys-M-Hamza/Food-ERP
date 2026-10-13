/** Demo staff, shifts, last month's attendance and some expenses (skipped when employees exist). */
import type { PrismaClient } from "../../src/generated/prisma/client";

async function seq(db: PrismaClient, branchId: string, scope: string): Promise<number> {
  const rows = await db.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (branch_id, scope, period_key, last_value, updated_at)
    VALUES (${branchId}::uuid, ${scope}, 'ALL', 1, now())
    ON CONFLICT (branch_id, scope, period_key)
    DO UPDATE SET last_value = number_sequences.last_value + 1, updated_at = now()
    RETURNING last_value`;
  return Number(rows[0]!.last_value);
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Karachi is UTC+5 all year. */
function at(isoDate: string, hm: string, plusDays = 0) {
  const [y, mo, d] = isoDate.split("-").map(Number) as [number, number, number];
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, d, h - 5, m) + plusDays * 86_400_000);
}

export async function seedDemoPeople(db: PrismaClient, branchId: string, log: (m: string) => void) {
  if (await db.employee.count()) {
    log("• Demo staff skipped (employees exist)");
    return;
  }
  const dayShift = await db.workShift.create({ data: { branchId, name: "Day", startMinute: 11 * 60, endMinute: 19 * 60, graceMinutes: 10, breakMinutes: 30 } });
  const evening = await db.workShift.create({ data: { branchId, name: "Evening", startMinute: 16 * 60, endMinute: 60, graceMinutes: 10, breakMinutes: 30 } });

  const user = async (email: string) => (await db.user.findFirst({ where: { email } }))?.id ?? null;
  const people = [
    { fullName: "Ayesha Khan", designation: "Manager", email: "manager@demo.local", shift: dayShift.id, payType: "MONTHLY" as const, rate: 85000, off: [1] },
    { fullName: "Bilal Ahmed", designation: "Cashier", email: "cashier@demo.local", shift: evening.id, payType: "MONTHLY" as const, rate: 45000, off: [2] },
    { fullName: "Usman Ali", designation: "Head cook", email: "kitchen@demo.local", shift: evening.id, payType: "MONTHLY" as const, rate: 60000, off: [3] },
    { fullName: "Hamid Raza", designation: "Rider", email: "rider@demo.local", shift: evening.id, payType: "MONTHLY" as const, rate: 38000, off: [4] },
    { fullName: "Kamran Iqbal", designation: "Kitchen helper", email: null, shift: evening.id, payType: "DAILY" as const, rate: 1500, off: [1] },
    { fullName: "Nadia Pervaiz", designation: "Part-time cashier", email: null, shift: dayShift.id, payType: "HOURLY" as const, rate: 250, off: [0, 6] },
  ];

  const now = new Date(Date.now() + 5 * 3_600_000);
  const firstThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const firstLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastDayLastMonth = new Date(firstThisMonth.getTime() - 86_400_000);

  let n = 0;
  for (const p of people) {
    n++;
    const code = `EMP-${String(await seq(db, branchId, "EMPLOYEE")).padStart(3, "0")}`;
    const userId = p.email ? await user(p.email) : null;
    const e = await db.employee.create({
      data: {
        branchId,
        employeeCode: code,
        userId,
        fullName: p.fullName,
        designation: p.designation,
        phone: `+9230000000${String(10 + n)}`,
        employmentType: p.payType === "MONTHLY" ? "FULL_TIME" : "PART_TIME",
        joiningDate: day("2025-03-01"),
        workShiftId: p.shift,
        weeklyOffDays: p.off,
        payType: p.payType,
        baseRate: p.rate,
      },
    });
    // Last month's attendance: mostly on time, a few late arrivals and one absence each.
    const shift = p.shift === dayShift.id ? { start: "11:00", end: "19:00", next: 0 } : { start: "16:00", end: "01:00", next: 1 };
    const rows = [];
    for (let t = firstLastMonth.getTime(), i = 0; t <= lastDayLastMonth.getTime(); t += 86_400_000, i++) {
      const d = iso(new Date(t));
      if (p.off.includes(new Date(t).getUTCDay())) continue;
      const roll = (i * 7 + n * 3) % 23;
      if (roll === 5) {
        rows.push({ branchId, employeeId: e.id, workDate: day(d), status: "ABSENT" as const, workShiftId: p.shift, source: "MANUAL" as const });
        continue;
      }
      const late = roll === 2 || roll === 11 ? 25 : 0;
      const [sh, sm] = shift.start.split(":").map(Number) as [number, number];
      const inAt = new Date(at(d, shift.start).getTime() + late * 60_000 + ((sh + sm) % 3) * 60_000);
      const extra = roll === 8 ? 60 : 0;
      const outAt = new Date(at(d, shift.end, shift.next).getTime() + extra * 60_000);
      const worked = Math.floor((outAt.getTime() - inAt.getTime()) / 60_000) - 30;
      const scheduled = (shift.next ? 9 * 60 : 8 * 60) - 30;
      rows.push({
        branchId,
        employeeId: e.id,
        workDate: day(d),
        status: late ? ("LATE" as const) : ("PRESENT" as const),
        workShiftId: p.shift,
        checkInAt: inAt,
        checkOutAt: outAt,
        lateMinutes: late,
        workedMinutes: worked,
        overtimeMinutes: worked - scheduled >= 30 ? worked - scheduled : 0,
        source: userId ? ("SELF" as const) : ("MANUAL" as const),
      });
    }
    await db.attendance.createMany({ data: rows });
  }
  log(`✓ ${people.length} demo employees, 2 shifts, last month's attendance`);

  // Expenses this month and last (paid outside the till so shifts stay untouched).
  const cats = new Map((await db.expenseCategory.findMany()).map((c) => [c.name, c.id]));
  const list: [string, number, string, string, number][] = [
    ["Rent", 180000, "Shop rent", "BANK_TRANSFER", -1],
    ["Electricity", 64500, "LESCO bill", "BANK_TRANSFER", -1],
    ["Gas", 18200, "SNGPL bill", "BANK_TRANSFER", -1],
    ["Internet & phone", 4500, "Fibre internet", "BANK_TRANSFER", -1],
    ["Packaging", 22000, "Burger boxes and bags", "CASH_OTHER", -1],
    ["Repairs & maintenance", 7500, "Fryer thermostat repair", "CASH_OTHER", -1],
    ["Rent", 180000, "Shop rent", "BANK_TRANSFER", 0],
    ["Cleaning supplies", 3800, "Detergent and mops", "CASH_OTHER", 0],
    ["Fuel & transport", 6000, "Rider bike fuel", "CASH_OTHER", 0],
    ["Marketing", 15000, "Social media ads", "CARD", 0],
  ];
  for (const [i, [cat, amount, description, method, monthOffset]] of list.entries()) {
    const base = monthOffset < 0 ? firstLastMonth : firstThisMonth;
    const date = new Date(Math.min(base.getTime() + ((i * 3) % 20) * 86_400_000, now.getTime() - 86_400_000));
    const number = `EXP-${String(await seq(db, branchId, "EXPENSE")).padStart(5, "0")}`;
    await db.expense.create({
      data: {
        branchId,
        expenseNumber: number,
        categoryId: cats.get(cat)!,
        amount,
        expenseDate: day(iso(date)),
        paymentMethod: method as "BANK_TRANSFER",
        description,
      },
    });
  }
  log(`✓ ${list.length} demo expenses`);
}
