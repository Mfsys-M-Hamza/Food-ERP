"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { createRoleAction } from "@/server/modules/rbac/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

export function NewRoleDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createRoleAction({ name, description, permissions: [] });
      if (res.ok) {
        toast.success("Role created. Tick its permissions in the table.");
        setOpen(false);
        setName("");
        setDescription("");
        setErrors({});
      } else {
        setErrors(res.fieldErrors ?? { _form: [res.error] });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus /> New role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>For example “Shift Supervisor”. It starts with no permissions.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="role-name">Name</FieldLabel>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <FieldError>{errors.name?.[0] ?? errors._form?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="role-desc">Description (optional)</FieldLabel>
              <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending || name.trim().length < 2}>
              {pending && <Loader2 className="animate-spin" />}
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
