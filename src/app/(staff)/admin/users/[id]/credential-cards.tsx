"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, LockKeyhole } from "lucide-react";
import { passwordSchema, pinSchema } from "@/server/modules/users/schemas";
import {
  resetStaffPasswordAction,
  setStaffPinAction,
  clearStaffPinAction,
} from "@/server/modules/users/actions";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function PasswordCard({ userId }: { userId: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const check = passwordSchema.safeParse(value);
    if (!check.success) return setError(check.error.issues[0]!.message);
    setError(null);
    start(async () => {
      const res = await resetStaffPasswordAction(userId, { password: value });
      if (res.ok) {
        toast.success(res.message);
        setValue("");
      } else setError(res.fieldErrors?.password?.[0] ?? res.error);
    });
  }

  return (
    <form onSubmit={submit}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LockKeyhole className="size-4" /> Reset password
          </CardTitle>
          <CardDescription>Sets a new password and signs the person out everywhere.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!!error}
            />
            <FieldError>{error}</FieldError>
          </Field>
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" variant="outline" disabled={pending || !value}>
            {pending && <Loader2 className="animate-spin" />}
            Set password
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function PinCard({ userId, hasPin }: { userId: string; hasPin: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const check = pinSchema.safeParse(value);
    if (!check.success) return setError(check.error.issues[0]!.message);
    setError(null);
    start(async () => {
      const res = await setStaffPinAction(userId, { pin: value });
      if (res.ok) {
        toast.success(res.message);
        setValue("");
      } else setError(res.fieldErrors?.pin?.[0] ?? res.error);
    });
  }

  function clear() {
    start(async () => {
      const res = await clearStaffPinAction(userId);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <form onSubmit={submit}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> POS PIN
            {hasPin ? <Badge variant="secondary">Set</Badge> : <Badge variant="outline">Not set</Badge>}
          </CardTitle>
          <CardDescription>Used for quick switching and manager approvals on the POS (Phase 3).</CardDescription>
        </CardHeader>
        <CardContent>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="new-pin">{hasPin ? "New PIN" : "PIN"}</FieldLabel>
            <Input
              id="new-pin"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              aria-invalid={!!error}
              className="tabular tracking-[0.3em]"
            />
            <FieldError>{error}</FieldError>
          </Field>
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          {hasPin && (
            <Button type="button" variant="ghost" onClick={clear} disabled={pending}>
              Remove PIN
            </Button>
          )}
          <Button type="submit" variant="outline" disabled={pending || !value}>
            {pending && <Loader2 className="animate-spin" />}
            Save PIN
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
