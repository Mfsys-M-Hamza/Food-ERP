"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateCustomerAction } from "@/server/modules/customers/actions";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

type C = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  marketingOptIn: boolean;
  isBlocked: boolean;
  blockReason: string;
};

export function CustomerEditor({ customer, canBlock }: { customer: C; canBlock: boolean }) {
  const [v, setV] = useState(customer);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(customer);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {(
            [
              ["name", "Name"],
              ["phone", "Phone"],
              ["email", "E-mail"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} data-invalid={!!errors[k]}>
              <FieldLabel htmlFor={`ce-${k}`}>{label}</FieldLabel>
              <Input id={`ce-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
              <FieldError>{errors[k]?.[0]}</FieldError>
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor="ce-notes">Notes (staff only)</FieldLabel>
            <Textarea id="ce-notes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            Agrees to marketing messages
            <Switch checked={v.marketingOptIn} onCheckedChange={(x) => setV({ ...v, marketingOptIn: x })} />
          </label>
          {canBlock && (
            <>
              <label className="flex items-center justify-between gap-3 text-sm">
                Block online / COD orders
                <Switch checked={v.isBlocked} onCheckedChange={(x) => setV({ ...v, isBlocked: x })} aria-label="Blocked" />
              </label>
              {v.isBlocked && <Input placeholder="Reason (e.g. fake orders)" value={v.blockReason} onChange={(e) => setV({ ...v, blockReason: e.target.value })} />}
            </>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end border-t">
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const r = await updateCustomerAction(customer.id, v);
              if (r.ok) {
                toast.success(r.message);
                setErrors({});
              } else setErrors(r.fieldErrors ?? { name: [r.error] });
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}
