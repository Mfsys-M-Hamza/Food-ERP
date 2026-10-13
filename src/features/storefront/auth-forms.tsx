"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { safeNextPath } from "@/lib/safe-redirect";
import { registerAction } from "@/server/modules/storefront/actions";
import { useHydrated } from "@/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-sm py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function Field({ id, label, error, ...props }: { id: string; label: string; error?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-11" aria-invalid={!!error} {...props} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function CustomerLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const hydrated = useHydrated();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Shell title="Sign in" subtitle="See your orders, saved addresses and favourites.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const { error } = await authClient.signIn.email({ email, password });
            if (error) setError(error.status === 429 ? "Too many attempts. Please wait a minute." : "Wrong e-mail or password.");
            else {
              router.replace(safeNextPath(params.get("next"), "/account"));
              router.refresh();
            }
          });
        }}
      >
        <fieldset disabled={!hydrated || pending} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field id="email" label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" className="h-11 w-full rounded-full" data-testid="customer-sign-in">
            {pending && <Loader2 className="animate-spin" />} Sign in
          </Button>
        </fieldset>
        <div className="flex justify-between text-sm">
          <Link href="/account/forgot-password" className="text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
          <Link href={`/account/register${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="font-medium text-brand">
            Create account
          </Link>
        </div>
      </form>
    </Shell>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const hydrated = useHydrated();
  const [v, setV] = useState({ name: "", phone: "", email: "", password: "", marketingOptIn: false });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const e = (k: string) => errors[k]?.[0];
  return (
    <Shell title="Create your account" subtitle="Order faster next time and track every order.">
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          setErrors({});
          start(async () => {
            const r = await registerAction(v);
            if (!r.ok) {
              setErrors(r.fieldErrors ?? { _form: [r.error] });
              return;
            }
            const { error } = await authClient.signIn.email({ email: v.email, password: v.password });
            if (error) {
              toast.error("Account created. Please sign in.");
              router.push("/account/login");
            } else {
              toast.success("Welcome!");
              router.replace(safeNextPath(params.get("next"), "/account"));
              router.refresh();
            }
          });
        }}
      >
        <fieldset disabled={!hydrated || pending} className="space-y-4">
          {e("_form") && (
            <Alert variant="destructive">
              <AlertDescription>{e("_form")}</AlertDescription>
            </Alert>
          )}
          <Field id="r-name" label="Name" autoComplete="name" value={v.name} error={e("name")} onChange={(x) => setV({ ...v, name: x.target.value })} />
          <Field id="r-phone" label="Mobile number" inputMode="tel" autoComplete="tel" value={v.phone} error={e("phone")} onChange={(x) => setV({ ...v, phone: x.target.value })} />
          <Field id="r-email" label="E-mail" type="email" autoComplete="email" value={v.email} error={e("email")} onChange={(x) => setV({ ...v, email: x.target.value })} />
          <Field id="r-password" label="Password" type="password" autoComplete="new-password" value={v.password} error={e("password")} onChange={(x) => setV({ ...v, password: x.target.value })} />
          <p className="-mt-2 text-xs text-muted-foreground">At least 10 characters with a number.</p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={v.marketingOptIn} onCheckedChange={(c) => setV({ ...v, marketingOptIn: c === true })} />
            Send me deals and offers
          </label>
          <Button type="submit" className="h-11 w-full rounded-full" data-testid="register">
            {pending && <Loader2 className="animate-spin" />} Create account
          </Button>
        </fieldset>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/account/login" className="font-medium text-brand">
            Sign in
          </Link>
        </p>
      </form>
    </Shell>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Shell title="Reset your password" subtitle="We will e-mail you a link to choose a new password.">
      {sent ? (
        <Alert>
          <AlertDescription>If an account exists for {email}, a reset link is on its way. It is valid for 30 minutes.</AlertDescription>
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              await authClient.requestPasswordReset({ email, redirectTo: "/account/reset-password" });
              setSent(true);
            });
          }}
        >
          <Field id="f-email" label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="h-11 w-full rounded-full" disabled={pending || !email}>
            {pending && <Loader2 className="animate-spin" />} Send reset link
          </Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Shell title="Choose a new password" subtitle="At least 10 characters with a number.">
      {!token || params.get("error") ? (
        <Alert variant="destructive">
          <AlertDescription>
            This link is invalid or has expired. <Link href="/account/forgot-password" className="underline">Request a new one</Link>.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const { error } = await authClient.resetPassword({ newPassword: password, token });
              if (error) setError(error.message ?? "Could not reset the password.");
              else {
                toast.success("Password changed. Please sign in.");
                router.push("/account/login");
              }
            });
          }}
        >
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field id="n-password" label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" className="h-11 w-full rounded-full" disabled={pending || password.length < 10}>
            {pending && <Loader2 className="animate-spin" />} Save password
          </Button>
        </form>
      )}
    </Shell>
  );
}
