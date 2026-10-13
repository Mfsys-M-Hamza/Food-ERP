import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { pinSwitchPlugin } from "./pin-plugin";
import { db } from "./db";
import { env } from "./env";
import { sendEmail } from "./mailer";

/**
 * Better Auth instance. Sessions are stored server-side in `sessions` and
 * referenced by an httpOnly, SameSite=Lax cookie (Secure in production).
 *
 * Public sign-up is disabled: staff accounts are created by the Owner from
 * Admin › Users. Customer sign-up arrives in Phase 5 through its own endpoint.
 */
export const auth = betterAuth({
  secret: env().BETTER_AUTH_SECRET,
  baseURL: env().BETTER_AUTH_URL,
  trustedOrigins: [env().BETTER_AUTH_URL],
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 30,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Use this link within 30 minutes to choose a new password: ${url}

If you did not ask for this, ignore this e-mail.`,
        html: `<p>Use the link below within 30 minutes to choose a new password.</p><p><a href="${url}">Reset password</a></p><p>If you did not ask for this, ignore this e-mail.</p>`,
      });
    },
  },
  user: {
    additionalFields: {
      kind: { type: "string", required: false, defaultValue: "STAFF", input: false },
      status: { type: "string", required: false, defaultValue: "ACTIVE", input: false },
      phone: { type: "string", required: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 hours
    updateAge: 60 * 60, // refresh expiry at most hourly while active
  },
  rateLimit: {
    // Disabled only for automated tests. E2E_DISABLE_RATE_LIMIT is ignored on Vercel production.
    enabled:
      env().NODE_ENV !== "test" &&
      !(process.env.E2E_DISABLE_RATE_LIMIT === "true" && process.env.VERCEL_ENV !== "production"),
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/forget-password": { window: 300, max: 3 },
      "/request-password-reset": { window: 300, max: 3 },
      "/pin/switch": { window: 60, max: 10 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: env().NODE_ENV === "production",
    cookiePrefix: "ferp",
  },
  databaseHooks: {
    session: {
      create: {
        // Disabled accounts cannot obtain a session.
        before: async (session) => {
          const user = await db.user.findUnique({ where: { id: session.userId }, select: { status: true } });
          if (!user || user.status !== "ACTIVE") return false;
          return;
        },
        after: async (session) => {
          await db.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
        },
      },
    },
  },
  telemetry: { enabled: false },
  plugins: [pinSwitchPlugin(), nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
