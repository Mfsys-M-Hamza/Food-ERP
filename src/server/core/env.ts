import "server-only";
import { z } from "zod";

/**
 * Server-only environment, validated once at first use.
 * Never import this from client components (the `server-only` import enforces it).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_PUBLIC_BUCKET: z.string().default("public-assets"),
  SUPABASE_PRIVATE_BUCKET: z.string().default("private-docs"),
  CRON_SECRET: z.string().optional(),
}).superRefine((e, ctx) => {
  // Production must not start with development shortcuts.
  if (e.NODE_ENV !== "production" || process.env.E2E_DISABLE_RATE_LIMIT) return;
  const need = (ok: boolean, path: string, message: string) => ok || ctx.addIssue({ code: "custom", path: [path], message });
  need(!!e.DATA_ENCRYPTION_KEY, "DATA_ENCRYPTION_KEY", "is required in production (encrypts CNIC and bank details)");
  need(!!e.DATA_ENCRYPTION_KEY && e.DATA_ENCRYPTION_KEY !== e.BETTER_AUTH_SECRET, "DATA_ENCRYPTION_KEY", "must differ from BETTER_AUTH_SECRET");
  need(!/change-me/i.test(e.BETTER_AUTH_SECRET), "BETTER_AUTH_SECRET", "still has the example value");
  need(!!e.CRON_SECRET && e.CRON_SECRET.length >= 16 && !/change-me/i.test(e.CRON_SECRET), "CRON_SECRET", "must be set to a random value of at least 16 characters");
  need(!process.env.VERCEL || e.BETTER_AUTH_URL.startsWith("https://"), "BETTER_AUTH_URL", "must be the https:// address of the site");
  need(!process.env.VERCEL || e.STORAGE_DRIVER === "supabase", "STORAGE_DRIVER", "must be \"supabase\" on Vercel (its disk is not permanent)");
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
