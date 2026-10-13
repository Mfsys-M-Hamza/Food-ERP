"use client";

import { useState, useTransition } from "react";
import { Bike, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listRidersAction, assignRiderAction } from "@/server/modules/delivery/rider-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Rider = { id: string; name: string; activeDeliveries: number };

/** Dropdown to assign / change / remove the rider of a delivery order. */
export function AssignRiderButton({
  orderId,
  currentRiderName,
  onDone,
  size = "sm",
}: {
  orderId: string;
  currentRiderName?: string | null;
  onDone?: () => void;
  size?: "sm" | "default";
}) {
  const [riders, setRiders] = useState<Rider[] | null>(null);
  const [pending, start] = useTransition();

  function load(open: boolean) {
    if (!open || riders) return;
    start(async () => {
      const r = await listRidersAction();
      if (r.ok) setRiders(r.data);
      else toast.error(r.error);
    });
  }

  function assign(riderId: string | null) {
    start(async () => {
      const r = await assignRiderAction(orderId, riderId);
      if (r.ok) {
        toast.success(r.message);
        onDone?.();
      } else toast.error(r.error);
    });
  }

  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} data-testid={`assign-rider-${orderId}`}>
          {pending ? <Loader2 className="animate-spin" /> : <Bike />}
          {currentRiderName ? currentRiderName : "Assign rider"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Riders</DropdownMenuLabel>
        {!riders && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
        {riders?.length === 0 && <DropdownMenuItem disabled>No riders. Give a user the Rider role.</DropdownMenuItem>}
        {riders?.map((r) => (
          <DropdownMenuItem key={r.id} onSelect={() => assign(r.id)}>
            <span className="flex-1">{r.name}</span>
            <span className="text-xs text-muted-foreground">{r.activeDeliveries ? `${r.activeDeliveries} active` : "free"}</span>
          </DropdownMenuItem>
        ))}
        {currentRiderName && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => assign(null)} className="text-destructive">
              Remove rider
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
