"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveRecipeAction, setRemovableIngredientAction } from "@/server/modules/inventory/actions";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney, money } from "@/lib/money";
import { cn } from "@/lib/utils";

type Ingredient = { id: string; name: string; baseUnit: "g" | "ml" | "piece"; averageCost: string };
type Line = { ingredientId: string; quantity: string };
type Data = {
  product: { id: string; name: string; price: string };
  base: Line[];
  variants: { id: string; name: string; price: string; items: Line[]; hasOwn: boolean }[];
  addons: { id: string; name: string; groupName: string; price: string; items: Line[] }[];
  removables: { id: string; label: string; ingredientId: string | null }[];
  ingredients: Ingredient[];
};

function lineCost(lines: Line[], ingredients: Ingredient[]) {
  return lines.reduce((s, l) => {
    const ing = ingredients.find((i) => i.id === l.ingredientId);
    if (!ing || !/^\d+(\.\d+)?$/.test(l.quantity)) return s;
    return s.plus(money(l.quantity).times(ing.averageCost));
  }, money(0));
}

function RecipeCard({
  title,
  description,
  price,
  target,
  initial,
  ingredients,
  testId,
}: {
  title: string;
  description?: string;
  price: string;
  target: { productId: string } | { variantId: string } | { addonId: string };
  initial: Line[];
  ingredients: Ingredient[];
  testId: string;
}) {
  const [lines, setLines] = useState<Line[]>(initial);
  const [saved, setSaved] = useState<Line[]>(initial);
  const [pending, start] = useTransition();
  const cost = lineCost(lines, ingredients);
  const pct = money(price).isZero() ? null : cost.dividedBy(price).times(100).toDecimalPlaces(0).toNumber();
  const dirty = JSON.stringify(lines) !== JSON.stringify(saved);

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold tabular" data-testid={`${testId}-cost`}>
              Cost {formatMoney(cost.toFixed(2))}
            </div>
            {pct !== null && (
              <div className={cn("text-xs tabular", pct > 40 ? "text-destructive" : "text-muted-foreground")}>
                {pct}% of {formatMoney(price)}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {lines.length === 0 && <p className="text-sm text-muted-foreground">No ingredients yet.</p>}
        {lines.map((l, i) => {
          const ing = ingredients.find((x) => x.id === l.ingredientId);
          return (
            <div key={i} className="grid grid-cols-[1fr_110px_auto_auto] items-center gap-2">
              <select
                aria-label={`${title} ingredient ${i + 1}`}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={l.ingredientId}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))}
              >
                <option value="">Choose…</option>
                {ingredients.map((x) => (
                  <option key={x.id} value={x.id} disabled={lines.some((y, k) => k !== i && y.ingredientId === x.id)}>
                    {x.name}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`${title} quantity ${i + 1}`}
                inputMode="decimal"
                className="h-9 tabular"
                value={l.quantity}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, "") } : x)))}
              />
              <span className="w-10 text-xs text-muted-foreground">{ing ? (ing.baseUnit === "piece" ? "pcs" : ing.baseUnit) : ""}</span>
              <Button variant="ghost" size="icon" aria-label="Remove ingredient" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          );
        })}
        <Button variant="outline" size="sm" onClick={() => setLines([...lines, { ingredientId: "", quantity: "" }])}>
          <Plus /> Add ingredient
        </Button>
      </CardContent>
      <CardFooter className="justify-end border-t">
        <Button
          disabled={!dirty || pending || lines.some((l) => !l.ingredientId || !l.quantity)}
          onClick={() =>
            start(async () => {
              const r = await saveRecipeAction({ target, items: lines });
              if (r.ok) {
                setSaved(lines);
                toast.success(`${title}: recipe saved`);
              }
              else toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0]![0] : r.error);
            })
          }
          data-testid={`${testId}-save`}
        >
          {pending && <Loader2 className="animate-spin" />} Save recipe
        </Button>
      </CardFooter>
    </Card>
  );
}

export function RecipeEditor({ data }: { data: Data }) {
  const [pending, start] = useTransition();
  return (
    <Tabs defaultValue="item">
      <TabsList>
        <TabsTrigger value="item">{data.variants.length ? "Sizes" : "Recipe"}</TabsTrigger>
        {data.addons.length > 0 && <TabsTrigger value="addons">Add-ons ({data.addons.length})</TabsTrigger>}
        {data.removables.length > 0 && <TabsTrigger value="removables">Removable options</TabsTrigger>}
      </TabsList>
      <TabsContent value="item" className="mt-4 space-y-4">
        <RecipeCard
          title={data.variants.length ? "Base recipe (all sizes)" : data.product.name}
          description={data.variants.length ? "Used for every size that has no recipe of its own." : undefined}
          price={data.product.price}
          target={{ productId: data.product.id }}
          initial={data.base}
          ingredients={data.ingredients}
          testId="recipe-base"
        />
        {data.variants.map((v) => (
          <RecipeCard
            key={v.id}
            title={v.name}
            description={v.hasOwn ? "Own recipe" : "Uses the base recipe until you save one here."}
            price={v.price}
            target={{ variantId: v.id }}
            initial={v.items}
            ingredients={data.ingredients}
            testId={`recipe-variant-${v.name}`}
          />
        ))}
      </TabsContent>
      <TabsContent value="addons" className="mt-4 grid gap-4 lg:grid-cols-2">
        {data.addons.map((a) => (
          <RecipeCard
            key={a.id}
            title={a.name}
            description={a.groupName}
            price={a.price}
            target={{ addonId: a.id }}
            initial={a.items}
            ingredients={data.ingredients}
            testId={`recipe-addon-${a.name}`}
          />
        ))}
      </TabsContent>
      <TabsContent value="removables" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Removable options</CardTitle>
            <CardDescription>When a customer picks “No onions”, the linked ingredient is not deducted from stock.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.removables.map((r) => (
              <div key={r.id} className="grid grid-cols-[160px_1fr] items-center gap-3">
                <span className="text-sm font-medium">{r.label}</span>
                <select
                  aria-label={`${r.label} ingredient`}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  defaultValue={r.ingredientId ?? ""}
                  disabled={pending}
                  onChange={(e) =>
                    start(async () => {
                      const res = await setRemovableIngredientAction(r.id, e.target.value || null);
                      if (res.ok) toast.success(`${r.label} linked`);
                      else toast.error(res.error);
                    })
                  }
                >
                  <option value="">Not linked</option>
                  {data.ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
