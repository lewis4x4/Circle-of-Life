"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { loadCareEventPrintPacket, type CareEventPrintPacket } from "@/lib/care-events/print-data";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE } from "@/lib/supabase/env";

import { IncidentFormSheet } from "./IncidentFormSheet";
import { PhysicianSheet } from "./PhysicianSheet";
import { PrintGate } from "./PrintGate";

export type CareEventPrintPageClientProps = {
  careEventId: string;
  sheet: "incident_form" | "physician_sheet";
};

/**
 * `/admin/care-events/[id]/print/incident-form` and `.../physician-sheet`.
 *
 * The audit row is written first (PrintGate) and the packet is loaded in
 * parallel, but neither sheet renders until the row is in: a sheet that reaches
 * a printer always has a record saying what it was.
 */
export function CareEventPrintPageClient({ careEventId, sheet }: CareEventPrintPageClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const [packet, setPacket] = useState<CareEventPrintPacket | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Whether the route carried a usable id is known at render. Only the load
  // failure is state.
  const validId = UUID_STRING_RE.test(careEventId);
  const error = validId ? loadError : "Open this page from a care event; no event was named.";

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    loadCareEventPrintPacket(supabase, careEventId)
      .then((loaded) => {
        if (!cancelled) setPacket(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError("That care event could not be loaded. It may be outside your facilities.");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, careEventId, validId]);

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <p role="alert" className="text-base font-medium text-destructive">
          {error}
        </p>
        <Link href="/admin/incidents" className="text-sm underline-offset-4 hover:underline">
          Back to the incidents board
        </Link>
      </div>
    );
  }

  return (
    <PrintGate supabase={supabase} kind={sheet} careEventId={careEventId}>
      {packet === null ? (
        <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading the sheet
        </p>
      ) : sheet === "incident_form" ? (
        <IncidentFormSheet packet={packet} />
      ) : (
        <PhysicianSheet packet={packet} />
      )}
    </PrintGate>
  );
}
