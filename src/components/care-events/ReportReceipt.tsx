"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Phone } from "lucide-react";

import type { CareEventKind, CareEventLevel } from "@/lib/care-events/level-engine";
import {
  RECEIPT_NOTE_ONLY_LINE,
  RECEIPT_OFFLINE_SAVED_LINE,
  acknowledgedLine,
  deliveryLine,
  incidentLine,
  nextCheckLine,
  onCallLine,
  savedLine,
} from "@/lib/care-events/receipt-copy";
import { fetchCareEventReceiptStatus, type CareEventReceiptStatus } from "@/lib/care-events/report-data";
import type { CareEventReceipt } from "@/lib/care-events/submit";
import { careEventTileWord } from "@/lib/care-events/tiles";
import { formatLevelWord } from "@/lib/incidents/incidents-display-copy";
import type { Database } from "@/types/database";

import { ReportReceiptActions } from "./ReportReceiptActions";

export const RECEIPT_POLL_MS = 5000;

export type ReportReceiptProps = {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  facilityId: string;
  timeZone: string;
  kind: CareEventKind;
  /** Client-derived level; the server's level replaces it once a receipt exists. */
  level: CareEventLevel;
  sentence: string;
  resident: { firstName: string | null; lastName: string | null } | null;
  savedAtIso: string | null;
  /** Null while the capture sits in the offline queue. */
  receipt: CareEventReceipt | null;
  offline: boolean;
  onCallPhone: string | null;
};

/**
 * The receipt (spec 07A §2 "Receipt screen"). Polls acknowledgment every five
 * seconds until acknowledged or unmounted. Offline mode shows the on-device
 * line and, for Urgent and Emergency, the cached on-call phone.
 */
export function ReportReceipt(props: ReportReceiptProps) {
  const { supabase, receipt, offline, timeZone } = props;
  const careEventId = receipt?.care_event_id ?? null;
  const [status, setStatus] = useState<CareEventReceiptStatus | null>(null);

  useEffect(() => {
    if (!careEventId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await fetchCareEventReceiptStatus(supabase, careEventId);
        if (cancelled) return;
        if (next) setStatus(next);
        if (next?.acknowledgedAt || next?.status === "closed") return;
      } catch {
        // Keep the last known state; try again on the next tick.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), RECEIPT_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [supabase, careEventId]);

  const level = status?.level ?? receipt?.level ?? props.level;
  const sentence = status?.sentence ?? props.sentence;
  const hasResident = props.resident !== null;
  const saved = savedLine({
    residentFirstName: props.resident?.firstName ?? null,
    residentLastName: props.resident?.lastName ?? null,
    hasResident,
    savedAtIso: status?.createdAt ?? props.savedAtIso,
    timeZone,
  });
  const incident = incidentLine(status?.incidentNumber ?? receipt?.incident_number ?? null);
  const nextCheck = nextCheckLine(status?.nextCheckAt ?? receipt?.next_check_at ?? null, timeZone);
  const deliveries = status?.deliveries ?? receipt?.deliveries ?? [];
  const acknowledged = status?.acknowledgedAt ? acknowledgedLine(status.acknowledgedByName, status.acknowledgedAt, timeZone) : null;
  const showOnCall = offline && level >= 3;

  return (
    <section className="space-y-6" aria-labelledby="report-receipt-heading">
      <div>
        <p className="text-sm text-muted-foreground">
          {careEventTileWord(props.kind)}, {formatLevelWord(level)}
        </p>
        <h2 id="report-receipt-heading" className="mt-1 text-2xl font-semibold text-foreground">
          {offline ? RECEIPT_OFFLINE_SAVED_LINE : saved}
        </h2>
        {offline ? <p className="mt-1 text-sm text-muted-foreground">{saved}</p> : null}
      </div>

      {showOnCall ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-4">
          <p className="text-base font-semibold text-foreground">{onCallLine(props.onCallPhone)}</p>
          {props.onCallPhone ? (
            <a
              href={`tel:${props.onCallPhone.replace(/[^+\d]/g, "")}`}
              className="mt-3 flex min-h-14 items-center justify-center gap-2 rounded-lg bg-destructive px-4 text-base font-semibold text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Phone className="size-5" aria-hidden />
              Call the on-call phone
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2" role="status" aria-live="polite" aria-atomic="false">
        <h3 className="text-base font-semibold text-foreground">Who was told</h3>
        {offline ? (
          <p className="text-sm text-muted-foreground">Alerts go out the moment this device is back online.</p>
        ) : acknowledged ? (
          <p className="text-base text-success">{acknowledged}</p>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{RECEIPT_NOTE_ONLY_LINE}</p>
        ) : (
          <ul className="space-y-1">
            {deliveries.map((delivery, index) => (
              <li key={`${delivery.channel}-${delivery.target_role ?? ""}-${index}`} className="text-base text-foreground">
                {deliveryLine(delivery, timeZone)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {incident ? <p className="text-base font-semibold text-foreground">{incident}</p> : null}
      {nextCheck ? (
        <p className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-base text-foreground">{nextCheck}</p>
      ) : null}

      <div>
        <h3 className="text-base font-semibold text-foreground">What was recorded</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{sentence}</p>
      </div>

      <ReportReceiptActions
        supabase={supabase}
        careEventId={careEventId}
        organizationId={props.organizationId}
        facilityId={props.facilityId}
      />

      <Link
        href="/caregiver"
        className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        Back to my residents
      </Link>
    </section>
  );
}
