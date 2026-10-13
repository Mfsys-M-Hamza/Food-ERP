"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setAvailabilityAction } from "@/server/modules/menu/actions";
import { Switch } from "@/components/ui/switch";

export function AvailabilitySwitch({
  productId,
  variantId,
  name,
  available,
  disabled,
}: {
  productId: string;
  variantId?: string;
  name: string;
  available: boolean;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(available);

  return (
    <Switch
      checked={optimistic}
      disabled={disabled || pending}
      aria-label={`${name} in stock`}
      data-testid={`availability-${name}`}
      onCheckedChange={(v) =>
        start(async () => {
          setOptimistic(v);
          const res = await setAvailabilityAction({ productId, variantId, available: v });
          if (res.ok) toast.success(`${name}: ${v ? "back in stock" : "out of stock"}`);
          else toast.error(res.error);
        })
      }
    />
  );
}
