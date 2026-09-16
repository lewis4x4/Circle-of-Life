"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { loadCaregiverFacilityContext, type CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchCareEventReceiptStatus, readCachedOnCallPhone, type CareEventReceiptStatus } from "@/lib/care-events/report-data";
import type { CareEventReceipt } from "@/lib/care-events/submit";
import { createClient } from "@/lib/supabase/client";

import { ReportReceipt } from "./ReportReceipt";

type RevisitData =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; ctx: CaregiverFacilityContext; event: CareEventReceiptStatus };

/**
 * `/caregiver/report/[careEventId]`: reopen a receipt to add a photo or voice
 * note and watch the acknowledgment (spec 07A §6.4).
 */
export function CareEventReceiptRevisit({ careEventId }: { careEventId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<RevisitData>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await loadCaregiverFacilityContext(supabase);
        if (!resolved.ok) {
          if (!cancelled) setData({ status: "error", message: resolved.error });
          return;
        }
        const event = await fetchCareEventReceiptStatus(supabase, careEventId);
        if (cancelled) return;
        setData(event ? { status: "ready", ctx: resolved.ctx, event } : { status: "missing" });
      } catch {
        if (!cancelled) setData({ status: "error", message: "This receipt could not be opened. Tell the Administrator or Assistant in person." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, careEventId]);

  if (data.status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground" role="status">
        <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Loading the receipt</span>
      </div>
    );
  }
  if (data.status === "missing") {
    return (
      <p role="alert" className="rounded-lg border border-border bg-muted/40 px-5 py-4 text-sm text-foreground">
        That event is not on your list. It may belong to another facility.
      </p>
    );
  }
  if (data.status === "error") {
    return (
      <p role="alert" className="rounded-lg border border-border bg-muted/40 px-5 py-4 text-sm text-foreground">
        {data.message}
      </p>
    );
  }

  const { ctx, event } = data;
  const receipt: CareEventReceipt = {
    care_event_id: event.careEventId,
    level: event.level,
    incident_number: event.incidentNumber,
    incident_id: event.incidentId,
    deliveries: event.deliveries.map((delivery) => ({
      target_name: delivery.target_name,
      target_role: delivery.target_role,
      channel: delivery.channel,
      status: delivery.status,
    })),
    next_check_at: event.nextCheckAt,
    replayed: false,
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Something happened</h1>
        <p className="text-sm text-muted-foreground">Receipt</p>
      </header>
      <ReportReceipt
        supabase={supabase}
        organizationId={ctx.organizationId}
        facilityId={ctx.facilityId}
        timeZone={ctx.timeZone}
        kind={event.kind}
        level={event.level}
        sentence={event.sentence}
        resident={event.resident ? { firstName: event.resident.firstName, lastName: event.resident.lastName } : null}
        savedAtIso={event.createdAt}
        receipt={receipt}
        offline={false}
        onCallPhone={readCachedOnCallPhone(ctx.facilityId)}
      />
    </div>
  );
}
