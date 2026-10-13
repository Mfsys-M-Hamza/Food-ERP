import { z } from "zod";

/** Shared (client + server) validation for staff user management. */

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password is too long")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letters and at least one number");

export const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^[+0-9 ()-]*$/, "Use digits, spaces, + ( ) - only");

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  email: z.email("Enter a valid e-mail").trim().toLowerCase(),
  phone: phoneSchema.optional().default(""),
  password: passwordSchema,
  roleKeys: z.array(z.string().min(1)).min(1, "Choose at least one role"),
  pin: z.union([pinSchema, z.literal("")]).optional().default(""),
});
export type CreateStaffInput = z.input<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  email: z.email("Enter a valid e-mail").trim().toLowerCase(),
  phone: phoneSchema.optional().default(""),
  roleKeys: z.array(z.string().min(1)).min(1, "Choose at least one role"),
  status: z.enum(["ACTIVE", "DISABLED"]),
});
export type UpdateStaffInput = z.input<typeof updateStaffSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });
export const setPinSchema = z.object({ pin: pinSchema });
