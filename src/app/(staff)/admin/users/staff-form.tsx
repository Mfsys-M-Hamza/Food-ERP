"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createStaffSchema, updateStaffSchema } from "@/server/modules/users/schemas";
import { createStaffAction, updateStaffAction } from "@/server/modules/users/actions";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type RoleOption = { key: string; name: string; description: string | null };

type Values = {
  name: string;
  email: string;
  phone: string;
  password?: string;
  pin?: string;
  roleKeys: string[];
  status?: "ACTIVE" | "DISABLED";
};

export function StaffForm({
  mode,
  roles,
  userId,
  initial,
  canGrantOwner,
  isSelf,
}: {
  mode: "create" | "edit";
  roles: RoleOption[];
  userId?: string;
  initial?: Values;
  canGrantOwner: boolean;
  isSelf?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);
  const schema = mode === "create" ? createStaffSchema : updateStaffSchema;
  const form = useForm<Values>({
    resolver: zodResolver(schema as never) as unknown as Resolver<Values>,
    defaultValues: initial ?? { name: "", email: "", phone: "", password: "", pin: "", roleKeys: [], status: "ACTIVE" },
  });
  const { errors } = form.formState;

  function onSubmit(values: Values) {
    setFormError(null);
    startTransition(async () => {
      const res = mode === "create" ? await createStaffAction(values) : await updateStaffAction(userId!, values);
      if (res.ok) {
        toast.success(res.message);
        if (mode === "create") router.push(`/admin/users/${res.data.id}`);
        else form.reset(values);
      } else {
        setFormError(res.error);
        for (const [name, messages] of Object.entries(res.fieldErrors ?? {})) {
          form.setError(name as keyof Values, { message: messages[0] });
        }
      }
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{mode === "create" ? "New staff member" : "Profile & roles"}</CardTitle>
          <CardDescription>
            {mode === "create"
              ? "They will sign in with this e-mail and password. Share the password privately."
              : "Changing roles signs the person out so the new access applies immediately."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!hydrated || pending} className="contents">
            <FieldGroup>
              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-6 md:grid-cols-2">
                <Field data-invalid={!!errors.name}>
                  <FieldLabel htmlFor="name">Full name</FieldLabel>
                  <Input id="name" autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
                  <FieldError errors={[errors.name]} />
                </Field>
                <Field data-invalid={!!errors.phone}>
                  <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
                  <Input id="phone" type="tel" aria-invalid={!!errors.phone} {...form.register("phone")} />
                  <FieldError errors={[errors.phone]} />
                </Field>
                <Field data-invalid={!!errors.email} className="md:col-span-2">
                  <FieldLabel htmlFor="email">E-mail (used to sign in)</FieldLabel>
                  <Input id="email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
                  <FieldDescription>Staff without e-mail can use a made-up address such as ali@staff.local.</FieldDescription>
                  <FieldError errors={[errors.email]} />
                </Field>
                {mode === "create" && (
                  <>
                    <Field data-invalid={!!errors.password}>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register("password")} />
                      <FieldDescription>At least 10 characters with a number.</FieldDescription>
                      <FieldError errors={[errors.password]} />
                    </Field>
                    <Field data-invalid={!!errors.pin}>
                      <FieldLabel htmlFor="pin">POS PIN (optional)</FieldLabel>
                      <Input id="pin" inputMode="numeric" autoComplete="off" maxLength={6} aria-invalid={!!errors.pin} {...form.register("pin")} />
                      <FieldDescription>4–6 digits for quick switching on the POS.</FieldDescription>
                      <FieldError errors={[errors.pin]} />
                    </Field>
                  </>
                )}
              </div>

              <FieldSet data-invalid={!!errors.roleKeys}>
                <FieldLegend variant="label">Roles</FieldLegend>
                <Controller
                  control={form.control}
                  name="roleKeys"
                  render={({ field }) => (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {roles.map((role) => {
                        const checked = field.value.includes(role.key);
                        const locked = role.key === "owner" && !canGrantOwner;
                        return (
                          <label
                            key={role.key}
                            className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-[[data-state=checked]]:border-brand/50 has-[[data-state=checked]]:bg-brand/5 ${locked ? "cursor-not-allowed opacity-50" : ""}`}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={locked}
                              onCheckedChange={(v) =>
                                field.onChange(v ? [...field.value, role.key] : field.value.filter((k) => k !== role.key))
                              }
                              aria-label={role.name}
                            />
                            <span>
                              <span className="block text-sm font-medium">{role.name}</span>
                              {role.description && <span className="block text-xs text-muted-foreground">{role.description}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                />
                <FieldError errors={[errors.roleKeys as { message?: string } | undefined]} />
              </FieldSet>

              {mode === "edit" && (
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Field orientation="horizontal" className="rounded-lg border p-3">
                      <Switch
                        id="status"
                        checked={field.value === "ACTIVE"}
                        disabled={isSelf}
                        onCheckedChange={(v) => field.onChange(v ? "ACTIVE" : "DISABLED")}
                      />
                      <FieldLabel htmlFor="status" className="font-normal">
                        Account active
                        <span className="block text-xs text-muted-foreground">
                          {isSelf ? "You cannot disable your own account." : "Disabled accounts cannot sign in. History is kept."}
                        </span>
                      </FieldLabel>
                    </Field>
                  )}
                />
              )}
            </FieldGroup>
          </fieldset>
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          {mode === "create" && (
            <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending || (mode === "edit" && !form.formState.isDirty)}>
            {pending && <Loader2 className="animate-spin" />}
            {mode === "create" ? "Create account" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
