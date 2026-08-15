"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { FacilityDetailRow } from "@/types/facility";
import {
  facilityDateYmdInTimezone,
  isRateCurrentForYmd,
  isRoomBoardRateType,
  compareYmd,
} from "@/lib/admin/facilities/rate-schedule-metrics";
import { formatUsdCurrencyFromCents } from "@/lib/format/usd-monthly";
import {
  RATES_STRIP_CONTRACTED_MRR_COPY,
  RATES_STRIP_NO_FULL_CENSUS_MODEL_COPY,
  formatRatesStripNextScheduledChange,
  ratesStripNextScheduledChangeIsMissing,
} from "@/lib/facilities/rates-metrics-strip-display-copy";

export type FacilityRateRow = {
  rate_type: string;
  amount_cents: number;
  effective_from: string;
  effective_to: string | null;
};

export function FacilityRatesMetricsStrip({
  facility,
  rates,
}: {
  facility: FacilityDetailRow;
  rates: FacilityRateRow[];
}) {
  const tz =
    typeof facility.timezone === "string" && facility.timezone.trim().length > 0
      ? facility.timezone.trim()
      : "America/New_York";

  const snapshot = useMemo(() => {
    const todayYmd = facilityDateYmdInTimezone(new Date(), tz);

    const roomRows = rates.filter((r) => isRoomBoardRateType(r.rate_type));
    const activeTypes = new Set(
      roomRows
        .filter((r) => isRateCurrentForYmd(r.effective_from, r.effective_to, todayYmd))
        .map((r) => r.rate_type),
    );

    const futureFroms = rates
      .filter((r) => compareYmd(r.effective_from, todayYmd) > 0)
      .map((r) => r.effective_from);
    const nextScheduled =
      futureFroms.length > 0 ? futureFroms.reduce((a, b) => (compareYmd(a, b) < 0 ? a : b)) : null;

    const licensed = facility.licensed_beds ?? 0;

    return {
      activeRoomRateCount: activeTypes.size,
      nextScheduled,
      licensed,
      todayYmd,
    };
  }, [rates, facility.licensed_beds, tz]);

  const nextLabel = formatRatesStripNextScheduledChange(snapshot.nextScheduled, tz);
  const nextScheduledMissing = ratesStripNextScheduledChangeIsMissing(snapshot.nextScheduled);

  const atFullCensusUsd = useMemo(() => {
    const todayYmd = snapshot.todayYmd;
    const roomRows = rates.filter((r) => isRoomBoardRateType(r.rate_type));
    const byType = new Map<string, { cents: number }>();
    for (const t of ["private_room", "semi_private_room"] as const) {
      const current = roomRows
        .filter((r) => r.rate_type === t && isRateCurrentForYmd(r.effective_from, r.effective_to, todayYmd))
        .sort((a, b) => compareYmd(b.effective_from, a.effective_from))[0];
      if (current) byType.set(t, { cents: current.amount_cents });
    }
    if (byType.size === 0 || snapshot.licensed <= 0) return null;
    const privateCents = byType.get("private_room")?.cents ?? null;
    const semiCents = byType.get("semi_private_room")?.cents ?? null;
    if (privateCents == null && semiCents == null) return null;
    if (privateCents != null && semiCents != null) {
      const avg = (privateCents + semiCents) / 2;
      return Math.round(avg * snapshot.licensed) / 100;
    }
    const only = privateCents ?? semiCents!;
    return Math.round(only * snapshot.licensed) / 100;
  }, [rates, snapshot.licensed, snapshot.todayYmd]);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Active room rates</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{snapshot.activeRoomRateCount}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Private &amp; semi-private lines</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Contracted MRR</p>
        <p className="mt-2 text-lg font-semibold leading-snug text-muted-foreground">{RATES_STRIP_CONTRACTED_MRR_COPY}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Per-type census by room category is required to compute contracted MRR.
        </p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">At full census</p>
        {atFullCensusUsd != null && snapshot.licensed > 0 ? (
          <>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground leading-snug">
              {formatUsdCurrencyFromCents(Math.round(atFullCensusUsd * 100))}
              <span className="text-base font-medium text-muted-foreground"> · 100% of capacity</span>
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Upper bound from posted private/semi rates × licensed beds (unit mix not modeled).
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-lg font-semibold leading-snug text-muted-foreground">
              {RATES_STRIP_NO_FULL_CENSUS_MODEL_COPY}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">Add current room rates to model revenue at capacity.</p>
          </>
        )}
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Next scheduled rate change</p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums leading-snug",
            nextScheduledMissing ? "text-lg text-muted-foreground" : "text-2xl text-foreground",
          )}
        >
          {nextLabel}
        </p>
        {!nextScheduledMissing ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            From a future-dated row in the schedule (
            <Link
              href={`/admin/facilities/${facility.id}?tab=rates#facility-rate-schedule`}
              className="text-primary hover:underline"
            >
              view rates
            </Link>
            ).
          </p>
        ) : (
          <p className="mt-1 text-[12px] text-muted-foreground">No future-dated rows yet.</p>
        )}
      </div>
    </div>
  );
}
