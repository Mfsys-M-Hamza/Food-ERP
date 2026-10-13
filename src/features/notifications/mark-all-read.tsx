"use client";

import { useTransition } from "react";
import { CheckCheck, Loader2 } from "lucide-react";
import { markNotificationsReadAction } from "@/server/modules/marketing/actions";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => void (await markNotificationsReadAction("all")))}>
      {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Mark all read
    </Button>
  );
}
