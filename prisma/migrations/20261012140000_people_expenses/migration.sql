-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH_DRAWER', 'CASH_OTHER', 'BANK_TRANSFER', 'CHEQUE', 'CARD');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'LEFT');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'PAID_LEAVE', 'UNPAID_LEAVE', 'OFF');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'SELF', 'BIOMETRIC', 'IMPORT');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'RECOVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayslipLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "system_key" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "expense_number" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "expense_date" DATE NOT NULL,
    "payment_method" "ExpensePaymentMethod" NOT NULL,
    "payee" TEXT,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "receipt_file_id" UUID,
    "cash_shift_id" UUID,
    "source_type" TEXT,
    "source_id" UUID,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "voided_by" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_shifts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "grace_minutes" INTEGER NOT NULL DEFAULT 10,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "designation" TEXT NOT NULL,
    "department" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "joining_date" DATE NOT NULL,
    "leaving_date" DATE,
    "work_shift_id" UUID,
    "weekly_off_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "pay_type" "PayType" NOT NULL DEFAULT 'MONTHLY',
    "base_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtime_rate" DECIMAL(12,2),
    "national_id_enc" TEXT,
    "national_id_last4" TEXT,
    "bank_account_enc" TEXT,
    "bank_name" TEXT,
    "address" TEXT,
    "emergency_name" TEXT,
    "emergency_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "work_shift_id" UUID,
    "status" "AttendanceStatus" NOT NULL,
    "check_in_at" TIMESTAMPTZ(6),
    "check_out_at" TIMESTAMPTZ(6),
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL',
    "source_ref" TEXT,
    "note" TEXT,
    "recorded_by" UUID,
    "locked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "recovered_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "installment" DECIMAL(12,2),
    "issued_on" DATE NOT NULL,
    "reason" TEXT,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "expense_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "run_number" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "prepared_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employee_name" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "pay_type" "PayType" NOT NULL,
    "base_rate" DECIMAL(12,2) NOT NULL,
    "period_days" INTEGER NOT NULL,
    "payable_days" DECIMAL(6,2) NOT NULL,
    "present_days" DECIMAL(6,2) NOT NULL,
    "absent_days" DECIMAL(6,2) NOT NULL,
    "leave_days" DECIMAL(6,2) NOT NULL,
    "off_days" INTEGER NOT NULL,
    "unrecorded_days" INTEGER NOT NULL,
    "late_count" INTEGER NOT NULL,
    "worked_minutes" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "payment_method" "ExpensePaymentMethod",
    "expense_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_lines" (
    "id" UUID NOT NULL,
    "payslip_id" UUID NOT NULL,
    "kind" "PayslipLineKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "advance_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_system_key_key" ON "expense_categories"("system_key");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expense_number_key" ON "expenses"("expense_number");

-- CreateIndex
CREATE INDEX "expenses_branch_id_expense_date_idx" ON "expenses"("branch_id", "expense_date");

-- CreateIndex
CREATE INDEX "expenses_category_id_expense_date_idx" ON "expenses"("category_id", "expense_date");

-- CreateIndex
CREATE INDEX "expenses_cash_shift_id_idx" ON "expenses"("cash_shift_id");

-- CreateIndex
CREATE INDEX "expenses_created_by_created_at_idx" ON "expenses"("created_by", "created_at");

-- CreateIndex
CREATE INDEX "expenses_source_type_source_id_idx" ON "expenses"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_branch_id_status_idx" ON "employees"("branch_id", "status");

-- CreateIndex
CREATE INDEX "attendance_branch_id_work_date_idx" ON "attendance"("branch_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_work_date_key" ON "attendance"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_expense_id_key" ON "employee_advances"("expense_id");

-- CreateIndex
CREATE INDEX "employee_advances_employee_id_status_idx" ON "employee_advances"("employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_run_number_key" ON "payroll_runs"("run_number");

-- CreateIndex
CREATE INDEX "payroll_runs_branch_id_period_start_idx" ON "payroll_runs"("branch_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_expense_id_key" ON "payslips"("expense_id");

-- CreateIndex
CREATE INDEX "payslips_employee_id_idx" ON "payslips"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payroll_run_id_employee_id_key" ON "payslips"("payroll_run_id", "employee_id");

-- CreateIndex
CREATE INDEX "payslip_lines_payslip_id_idx" ON "payslip_lines"("payslip_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_file_id_fkey" FOREIGN KEY ("receipt_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_shift_id_fkey" FOREIGN KEY ("work_shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_work_shift_id_fkey" FOREIGN KEY ("work_shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written ─────────────────────────────────────────────────────────────
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_amount_positive" CHECK ("amount" > 0 AND "recovered_amount" >= 0 AND "recovered_amount" <= "amount");
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_minutes" CHECK ("start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 0 AND 1439 AND "grace_minutes" >= 0 AND "break_minutes" >= 0);
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period" CHECK ("period_end" >= "period_start");
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories" (lower("name"));
CREATE UNIQUE INDEX "payroll_runs_period_active_key" ON "payroll_runs" ("branch_id", "period_start", "period_end") WHERE "status" <> 'CANCELLED';

-- Money records are never deleted.
CREATE TRIGGER expenses_no_delete BEFORE DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER employee_advances_no_delete BEFORE DELETE ON "employee_advances" FOR EACH ROW EXECUTE FUNCTION app_block_delete();
CREATE TRIGGER payroll_runs_no_delete BEFORE DELETE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION app_block_delete();

-- Approved payroll is frozen: payslip amounts and lines cannot change once the run leaves DRAFT.
CREATE OR REPLACE FUNCTION app_payroll_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  run_id uuid;
  run_status "PayrollStatus";
BEGIN
  IF TG_TABLE_NAME = 'payslip_lines' THEN
    SELECT p.payroll_run_id INTO run_id FROM payslips p WHERE p.id = COALESCE(NEW.payslip_id, OLD.payslip_id);
  ELSE
    run_id := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  END IF;
  SELECT status INTO run_status FROM payroll_runs WHERE id = run_id;
  IF run_status IS NULL OR run_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'payslips' AND TG_OP = 'UPDATE'
     AND NEW.gross = OLD.gross AND NEW.deductions = OLD.deductions AND NEW.net = OLD.net
     AND NEW.employee_id = OLD.employee_id AND NEW.payroll_run_id = OLD.payroll_run_id THEN
    RETURN NEW; -- payment details may still be recorded
  END IF;
  RAISE EXCEPTION 'Payroll % is % and cannot be changed', run_id, run_status USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER payslips_frozen BEFORE INSERT OR UPDATE OR DELETE ON "payslips" FOR EACH ROW EXECUTE FUNCTION app_payroll_frozen();
CREATE TRIGGER payslip_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON "payslip_lines" FOR EACH ROW EXECUTE FUNCTION app_payroll_frozen();

-- Attendance covered by an approved payroll is locked.
CREATE OR REPLACE FUNCTION app_attendance_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Attendance for % is locked by an approved payroll', OLD.work_date USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER attendance_locked BEFORE UPDATE OR DELETE ON "attendance" FOR EACH ROW EXECUTE FUNCTION app_attendance_locked();

SELECT app_enable_rls();
