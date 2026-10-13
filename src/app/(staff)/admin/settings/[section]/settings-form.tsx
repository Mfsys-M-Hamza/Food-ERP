"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { useRef, useState, useTransition } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ImageUp, Info, Loader2, Lock } from "lucide-react";
import { settingsSchemas, type FieldDef, type SectionDef } from "@/lib/settings/registry";
import { saveSettingsAction, uploadLogoAction } from "@/server/modules/settings/actions";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Values = Record<string, unknown>;

/** Values going into the form: numbers and selects are edited as strings. */
function toFormValues(section: SectionDef, values: Values): Values {
  const out: Values = { ...values };
  for (const f of section.fields) {
    if (f.type === "select" || f.type === "number" || f.type === "percent") out[f.name] = String(values[f.name] ?? "");
  }
  return out;
}

export function SettingsForm({
  section,
  initialValues,
  canEdit,
}: {
  section: SectionDef;
  initialValues: Values;
  canEdit: boolean;
}) {
  const schema = settingsSchemas[section.key];
  const form = useForm<Values>({
    resolver: zodResolver(schema as never) as unknown as Resolver<Values>,
    defaultValues: toFormValues(section, initialValues),
  });
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(values: Values) {
    setFormError(null);
    startTransition(async () => {
      const res = await saveSettingsAction(section.key, values);
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        form.reset(toFormValues(section, res.data as Values));
      } else {
        setFormError(res.error);
        for (const [name, messages] of Object.entries(res.fieldErrors ?? {})) {
          form.setError(name, { message: messages[0] });
        }
      }
    });
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!canEdit && (
            <Alert>
              <Lock />
              <AlertDescription>You can view these settings. Only the Owner can change them.</AlertDescription>
            </Alert>
          )}
          {section.notice && (
            <Alert className="border-warning/50 bg-warning/10">
              <Info />
              <AlertDescription>{section.notice}</AlertDescription>
            </Alert>
          )}
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <fieldset disabled={!hydrated || !canEdit || pending} className="contents">
            <FieldGroup className="grid gap-6 md:grid-cols-2">
              {section.fields.map((f) => (
                <FormField key={f.name} field={f} form={form} error={errors[f.name]?.message as string | undefined} canEdit={canEdit} />
              ))}
            </FieldGroup>
          </fieldset>
        </CardContent>
        {canEdit && (
          <CardFooter className="justify-end gap-2 border-t">
            <Button type="button" variant="ghost" disabled={!form.formState.isDirty || pending} onClick={() => form.reset()}>
              Discard changes
            </Button>
            <Button type="submit" disabled={pending || !form.formState.isDirty} data-testid="save-settings">
              {pending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}

function FormField({
  field: f,
  form,
  error,
  canEdit,
}: {
  field: FieldDef;
  form: ReturnType<typeof useForm<Values>>;
  error?: string;
  canEdit: boolean;
}) {
  const id = `f-${f.name}`;
  const wide = f.type === "textarea" || f.name === "logoUrl";

  if (f.type === "switch") {
    return (
      <Field orientation="horizontal" className="rounded-lg border p-3 md:col-span-1" data-invalid={!!error}>
        <Controller
          control={form.control}
          name={f.name}
          render={({ field }) => (
            <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
          )}
        />
        <FieldLabel htmlFor={id} className="font-normal">
          {f.label}
        </FieldLabel>
      </Field>
    );
  }

  if (f.name === "logoUrl") {
    return <LogoField form={form} error={error} canEdit={canEdit} label={f.label} help={f.help} />;
  }

  return (
    <Field data-invalid={!!error} className={wide ? "md:col-span-2" : undefined}>
      <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
      {f.type === "textarea" ? (
        <Textarea id={id} rows={3} aria-invalid={!!error} placeholder={f.placeholder} {...form.register(f.name)} />
      ) : f.type === "select" ? (
        <Controller
          control={form.control}
          name={f.name}
          render={({ field }) => (
            <Select value={String(field.value ?? "")} onValueChange={field.onChange} disabled={!canEdit}>
              <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      ) : (
        <Input
          id={id}
          aria-invalid={!!error}
          placeholder={f.placeholder}
          type={f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"}
          inputMode={f.type === "money" || f.type === "percent" ? "decimal" : f.type === "number" ? "numeric" : undefined}
          className={f.type === "money" || f.type === "percent" || f.type === "number" ? "tabular" : undefined}
          {...form.register(f.name)}
        />
      )}
      {f.help && <FieldDescription>{f.help}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function LogoField({
  form,
  error,
  canEdit,
  label,
  help,
}: {
  form: ReturnType<typeof useForm<Values>>;
  error?: string;
  canEdit: boolean;
  label: string;
  help?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const url = String(form.watch("logoUrl") ?? "");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadLogoAction(fd);
    setUploading(false);
    if (res.ok) {
      form.setValue("logoUrl", res.data.url, { shouldDirty: true });
      toast.success("Logo uploaded — remember to save changes.");
    } else {
      toast.error(res.fieldErrors?.file?.[0] ?? res.error);
    }
  }

  return (
    <Field data-invalid={!!error} className="md:col-span-2">
      <FieldLabel htmlFor="f-logoUrl">{label}</FieldLabel>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-provided logo URL
            <img src={url} alt="Logo preview" className="size-full object-contain" />
          ) : (
            <ImageUp className="size-6 text-muted-foreground" />
          )}
        </div>
        <Input id="f-logoUrl" placeholder="https://… or upload" aria-invalid={!!error} {...form.register("logoUrl")} />
        {canEdit && (
          <>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />}
              Upload
            </Button>
          </>
        )}
      </div>
      {help && <FieldDescription>{help} PNG, JPG or WebP up to 2 MB.</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
