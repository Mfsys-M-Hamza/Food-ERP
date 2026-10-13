"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { productSchema } from "@/server/modules/menu/schemas";
import { saveProductAction, archiveProductAction, uploadMenuImageAction } from "@/server/modules/menu/actions";
import type { ProductEditor as ProductEditorData } from "@/server/modules/menu/service";
import { useHydrated } from "@/hooks/use-hydrated";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ImageField } from "@/components/shared/image-field";
import { formatMoney, money } from "@/lib/money";

type Values = Omit<ProductEditorData, "id">;
type GroupOption = { id: string; name: string; minSelect: number; maxSelect: number; addons: { name: string; price: string }[] };

const EMPTY: Values = {
  name: "",
  categoryId: "",
  type: "SIMPLE",
  sku: "",
  description: "",
  imageUrl: "",
  basePrice: "",
  cost: "0",
  prepTimeMinutes: 10,
  isAvailable: true,
  isActive: true,
  isFeatured: false,
  showOnPos: true,
  showOnline: true,
  variants: [],
  addonGroupIds: [],
  removables: [],
};

const NUMERIC = /^\d+(\.\d+)?$/;

/** Food-cost % for live display. Ignores incomplete or invalid input instead of throwing. */
function margin(price: string | undefined, cost: string | undefined) {
  if (!price || !NUMERIC.test(price.trim())) return null;
  const p = money(price.trim());
  if (p.isZero()) return null;
  const c = cost && NUMERIC.test(cost.trim()) ? money(cost.trim()) : money(0);
  return c.dividedBy(p).times(100).toDecimalPlaces(0).toNumber();
}

export function ProductEditor({
  product,
  categories,
  groups,
  canChangePrice,
}: {
  product?: ProductEditorData;
  categories: { id: string; name: string }[];
  groups: GroupOption[];
  canChangePrice: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(productSchema as never) as unknown as Resolver<Values>,
    defaultValues: product ? { ...product } : { ...EMPTY, categoryId: categories[0]?.id ?? "" },
  });
  const variants = useFieldArray({ control: form.control, name: "variants", keyName: "_key" });
  const removables = useFieldArray({ control: form.control, name: "removables", keyName: "_key" });
  const { errors, isDirty } = form.formState;
  const hasVariants = variants.fields.length > 0;
  const watched = useWatch({ control: form.control }) as Values;

  function onSubmit(values: Values) {
    setFormError(null);
    start(async () => {
      const res = await saveProductAction(product?.id ?? null, values);
      if (res.ok) {
        toast.success(res.message);
        if (!product) router.push(`/admin/menu/products/${res.data.id}`);
        else form.reset(values);
      } else {
        setFormError(res.error);
        for (const [name, messages] of Object.entries(res.fieldErrors ?? {})) {
          form.setError(name as keyof Values, { message: messages[0] });
        }
      }
    });
  }

  function archive() {
    start(async () => {
      const res = await archiveProductAction(product!.id);
      if (res.ok) {
        toast.success(res.message);
        router.push("/admin/menu/products");
      } else toast.error(res.error);
    });
  }

  function addVariant() {
    variants.append({
      id: "",
      name: "",
      sku: "",
      price: form.getValues("basePrice") || "",
      cost: form.getValues("cost") || "0",
      isDefault: variants.fields.length === 0,
      isAvailable: true,
    });
  }

  function setDefaultVariant(index: number) {
    variants.fields.forEach((_, i) => form.setValue(`variants.${i}.isDefault`, i === index, { shouldDirty: true }));
  }

  const disabled = !hydrated || pending;
  const priceLocked = !canChangePrice && !!product;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit, () => toast.error("Please fix the highlighted fields."))}
      noValidate
    >
      <fieldset disabled={disabled} className="contents">
        {formError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup className="grid gap-5 md:grid-cols-2">
                  <Field data-invalid={!!errors.name} className="md:col-span-2">
                    <FieldLabel htmlFor="name">Name</FieldLabel>
                    <Input id="name" placeholder="Zinger Burger" aria-invalid={!!errors.name} {...form.register("name")} />
                    <FieldError errors={[errors.name]} />
                  </Field>
                  <Field data-invalid={!!errors.categoryId}>
                    <FieldLabel htmlFor="categoryId">Category</FieldLabel>
                    <Controller
                      control={form.control}
                      name="categoryId"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="categoryId" className="w-full" aria-invalid={!!errors.categoryId}>
                            <SelectValue placeholder="Choose…" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldError errors={[errors.categoryId]} />
                  </Field>
                  <Field data-invalid={!!errors.sku}>
                    <FieldLabel htmlFor="sku">SKU / code</FieldLabel>
                    <Input id="sku" placeholder="Auto" className="uppercase" aria-invalid={!!errors.sku} {...form.register("sku")} />
                    <FieldDescription>Leave empty to generate one.</FieldDescription>
                    <FieldError errors={[errors.sku]} />
                  </Field>
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="description">Description</FieldLabel>
                    <Textarea id="description" rows={2} placeholder="Crispy fried chicken fillet, lettuce, house mayo" {...form.register("description")} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="type">Type</FieldLabel>
                    <Controller
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="type" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SIMPLE">Single item</SelectItem>
                            <SelectItem value="DEAL">Deal / combo</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldDescription>Deal choices (e.g. drink) are add-on groups.</FieldDescription>
                  </Field>
                  <Field data-invalid={!!errors.prepTimeMinutes}>
                    <FieldLabel htmlFor="prep">Preparation time (minutes)</FieldLabel>
                    <Input id="prep" inputMode="numeric" className="tabular" {...form.register("prepTimeMinutes")} />
                    <FieldError errors={[errors.prepTimeMinutes]} />
                  </Field>
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="imageUrl">Photo</FieldLabel>
                    <Controller
                      control={form.control}
                      name="imageUrl"
                      render={({ field }) => (
                        <ImageField id="imageUrl" value={field.value} onChange={(v) => field.onChange(v)} upload={uploadMenuImageAction} />
                      )}
                    />
                    <FieldDescription>Square photos look best. PNG, JPG or WebP up to 3 MB.</FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Price & sizes</CardTitle>
                    <CardDescription>
                      Add sizes such as Small / Medium / Large or Single / Double. Each size has its own full price.
                    </CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addVariant} disabled={priceLocked}>
                    <Plus /> Add size
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {priceLocked && (
                  <Alert>
                    <AlertDescription>You can edit details, but only users with the price permission can change prices.</AlertDescription>
                  </Alert>
                )}
                {!hasVariants ? (
                  <div className="grid gap-5 md:grid-cols-3">
                    <Field data-invalid={!!errors.basePrice}>
                      <FieldLabel htmlFor="basePrice">Selling price</FieldLabel>
                      <Input id="basePrice" inputMode="decimal" className="tabular" readOnly={priceLocked} aria-invalid={!!errors.basePrice} {...form.register("basePrice")} />
                      <FieldError errors={[errors.basePrice]} />
                    </Field>
                    <Field data-invalid={!!errors.cost}>
                      <FieldLabel htmlFor="cost">Estimated cost</FieldLabel>
                      <Input id="cost" inputMode="decimal" className="tabular" aria-invalid={!!errors.cost} {...form.register("cost")} />
                      <FieldError errors={[errors.cost]} />
                    </Field>
                    <div className="flex flex-col justify-end pb-2 text-sm text-muted-foreground">
                      {margin(watched.basePrice, watched.cost) !== null && (
                        <span>
                          Food cost <strong className="text-foreground tabular">{margin(watched.basePrice, watched.cost)}%</strong>
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Size</th>
                          <th className="px-3 py-2 font-medium">Price</th>
                          <th className="px-3 py-2 font-medium">Est. cost</th>
                          <th className="px-3 py-2 text-center font-medium">Default</th>
                          <th className="px-3 py-2 text-center font-medium">In stock</th>
                          <th className="w-0" />
                        </tr>
                      </thead>
                      <tbody>
                        {variants.fields.map((f, i) => (
                          <tr key={f._key} className="border-t align-top">
                            <td className="px-3 py-2">
                              <Input aria-label={`Size ${i + 1} name`} placeholder="Large" {...form.register(`variants.${i}.name`)} />
                              <FieldError errors={[errors.variants?.[i]?.name]} />
                            </td>
                            <td className="px-3 py-2">
                              <Input aria-label={`Size ${i + 1} price`} inputMode="decimal" className="tabular" readOnly={priceLocked} {...form.register(`variants.${i}.price`)} />
                              <FieldError errors={[errors.variants?.[i]?.price]} />
                            </td>
                            <td className="px-3 py-2">
                              <Input aria-label={`Size ${i + 1} cost`} inputMode="decimal" className="tabular" {...form.register(`variants.${i}.cost`)} />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="radio"
                                name="defaultVariant"
                                className="mt-2.5 size-4 accent-[var(--brand)]"
                                checked={!!watched.variants?.[i]?.isDefault}
                                onChange={() => setDefaultVariant(i)}
                                aria-label={`Size ${i + 1} is default`}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Controller
                                control={form.control}
                                name={`variants.${i}.isAvailable`}
                                render={({ field }) => (
                                  <Switch className="mt-2" checked={field.value} onCheckedChange={field.onChange} aria-label={`Size ${i + 1} in stock`} />
                                )}
                              />
                            </td>
                            <td className="whitespace-nowrap px-2 py-2">
                              <Button type="button" variant="ghost" size="icon" disabled={i === 0} onClick={() => variants.move(i, i - 1)} aria-label="Move up">
                                <ArrowUp />
                              </Button>
                              <Button type="button" variant="ghost" size="icon" disabled={i === variants.fields.length - 1} onClick={() => variants.move(i, i + 1)} aria-label="Move down">
                                <ArrowDown />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={priceLocked}
                                onClick={() => {
                                  const wasDefault = form.getValues(`variants.${i}.isDefault`);
                                  variants.remove(i);
                                  if (wasDefault && variants.fields.length > 1) setTimeout(() => setDefaultVariant(0));
                                }}
                                aria-label="Remove size"
                              >
                                <Trash2 />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <FieldError errors={[errors.variants as { message?: string } | undefined]} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Add-ons & choices</CardTitle>
                <CardDescription>Extras the customer can add, or choices they must make (e.g. drink in a deal).</CardDescription>
              </CardHeader>
              <CardContent>
                {groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No add-on groups yet. Create them under Menu › Add-on groups.</p>
                ) : (
                  <Controller
                    control={form.control}
                    name="addonGroupIds"
                    render={({ field }) => (
                      <div className="grid gap-2 md:grid-cols-2">
                        {groups.map((g) => {
                          const checked = field.value.includes(g.id);
                          return (
                            <label
                              key={g.id}
                              className="flex cursor-pointer gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-brand/50 has-[[data-state=checked]]:bg-brand/5"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => field.onChange(v ? [...field.value, g.id] : field.value.filter((x) => x !== g.id))}
                                aria-label={g.name}
                              />
                              <span className="min-w-0">
                                <span className="flex items-center gap-2 text-sm font-medium">
                                  {g.name}
                                  {g.minSelect > 0 && <Badge variant="secondary">Required</Badge>}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {g.addons.map((a) => (money(a.price).isZero() ? a.name : `${a.name} +${formatMoney(a.price)}`)).join(", ")}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Removable ingredients</CardTitle>
                    <CardDescription>Options like “No onions” that the customer or cashier can tick.</CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => removables.append({ id: "", label: "No " })}>
                    <Plus /> Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {removables.fields.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
                {removables.fields.map((f, i) => (
                  <div key={f._key} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input aria-label={`Removable option ${i + 1}`} {...form.register(`removables.${i}.label`)} />
                      <FieldError errors={[errors.removables?.[i]?.label]} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removables.remove(i)} aria-label="Remove option">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Availability</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {(
                  [
                    ["isAvailable", "In stock", "Switch off when you run out today"],
                    ["isActive", "Published", "Hidden products are not sold anywhere"],
                    ["showOnPos", "Show on POS", ""],
                    ["showOnline", "Show on website / app", ""],
                    ["isFeatured", "Featured", "Highlighted on the website"],
                  ] as const
                ).map(([name, label, help]) => (
                  <Controller
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-2.5 hover:bg-muted/50">
                        <span>
                          <span className="block text-sm font-medium">{label}</span>
                          {help && <span className="block text-xs text-muted-foreground">{help}</span>}
                        </span>
                        <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={label} />
                      </label>
                    )}
                  />
                ))}
              </CardContent>
            </Card>
            {product && (
              <Card>
                <CardHeader>
                  <CardTitle>Archive</CardTitle>
                  <CardDescription>Removes it from the menu. Past orders keep their history.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" className="w-full text-destructive">
                        Archive product
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive {product.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          It disappears from the POS and website. To sell it again later, create it again.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </fieldset>

      <div className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-6 border-t bg-background/95 backdrop-blur md:-mx-6 md:-mb-6 lg:-mx-8 lg:-mb-8">
        <div className="flex items-center justify-end gap-2 px-4 py-3 md:px-8">
          <span className="mr-auto text-sm text-muted-foreground">{isDirty ? "Unsaved changes" : product ? "All changes saved" : ""}</span>
          <Button type="button" variant="ghost" onClick={() => router.push("/admin/menu/products")} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={disabled || (!!product && !isDirty)} data-testid="save-product">
            {pending && <Loader2 className="animate-spin" />}
            {product ? "Save changes" : "Create product"}
          </Button>
        </div>
      </div>
    </form>
  );
}
