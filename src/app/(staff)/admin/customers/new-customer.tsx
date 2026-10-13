"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createCustomerAction } from "@/server/modules/customers/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function NewCustomerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", phone: "", email: "", address: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const r = await createCustomerAction(
        { name: v.name, phone: v.phone, email: v.email },
        v.address.trim() ? { addressLine: v.address } : undefined,
      );
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        router.push(`/admin/customers/${r.data.id}`);
      } else setErrors(r.fieldErrors ?? { _form: [r.error] });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New customer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          {(
            [
              ["name", "Name"],
              ["phone", "Phone"],
              ["email", "E-mail (optional)"],
              ["address", "Address (optional)"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} data-invalid={!!errors[k] || (k === "address" && !!errors.addressLine)}>
              <FieldLabel htmlFor={`nc-${k}`}>{label}</FieldLabel>
              <Input id={`nc-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
              <FieldError>{errors[k]?.[0] ?? (k === "address" ? errors.addressLine?.[0] : undefined)}</FieldError>
            </Field>
          ))}
          {errors._form && <FieldError>{errors._form[0]}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
