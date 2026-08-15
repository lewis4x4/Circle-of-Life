"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  daysSinceYmd,
  daysUntilYmd,
  fireInspectionStalenessAccent,
  fireNextDueAccent,
  generatorTestAccent,
} from "@/lib/admin/facilities/building-metrics-kpi";
import { BUILDING_TAB_NO_CEMP_STATUS_COPY } from "@/lib/facilities/building-tab-display-copy";
import { formatLicensingTabYmdDate } from "@/lib/facilities/licensing-tab-display-copy";

const BUILDING_STRIP_TZ = "America/New_York";

export function FacilityBuildingMetricsStrip({
  facilityId,
  profile,
  profileLoading,
}: {
  facilityId: string;
  profile: Record<string, unknown> | null;
  profileLoading: boolean;
}) {
  if (profileLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[112px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
        ))}
      </div>
    );
  }

  const p = profile ?? {};
  const lastFire = typeof p.last_fire_inspection_date === "string" ? p.last_fire_inspection_date : null;
  const nextFire = typeof p.next_fire_inspection_date === "string" ? p.next_fire_inspection_date : null;
  const genTest = typeof p.generator_last_test_date === "string" ? p.generator_last_test_date : null;
  const hasGen = Boolean(p.has_generator);

  const sinceFire = daysSinceYmd(lastFire);
  const untilNext = daysUntilYmd(nextFire);
  const sinceGen = daysSinceYmd(genTest);

  const lastFireLabel = formatLicensingTabYmdDate(lastFire, BUILDING_STRIP_TZ);
  const lastFireMissing = lastFire == null;

  const nextFireLabel = formatLicensingTabYmdDate(nextFire, BUILDING_STRIP_TZ);
  const nextFireMissing = nextFire == null;

  const nextFireSub =
    untilNext == null ? "Set next inspection target" : untilNext === 0 ? "Due today" : `In ${untilNext} day${untilNext === 1 ? "" : "s"}`;

  const genSub =
    sinceGen == null
      ? hasGen
        ? "Log last load test"
        : "No generator on file"
      : `${sinceGen} day${sinceGen === 1 ? "" : "s"} ago`;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Last fire inspection</p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums leading-tight",
            lastFireMissing ? "text-lg text-muted-foreground" : "text-2xl",
            !lastFireMissing && fireInspectionStalenessAccent(sinceFire),
          )}
        >
          {lastFireLabel}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {lastFire == null ? (
            <span>Not on file</span>
          ) : (
            <Link href={`/admin/facilities/${facilityId}?tab=documents`} className="text-primary hover:underline">
              Link report in Document Vault
            </Link>
          )}
        </p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Next fire inspection due</p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums leading-tight",
            nextFireMissing ? "text-lg text-muted-foreground" : "text-2xl",
            !nextFireMissing && fireNextDueAccent(untilNext),
          )}
        >
          {nextFireLabel}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">{nextFireSub}</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">CEMP status</p>
        <p className="mt-2 text-lg font-semibold text-muted-foreground leading-tight">{BUILDING_TAB_NO_CEMP_STATUS_COPY}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          County OEM fields ship in schema sprint —{" "}
          <Link href={`/admin/facilities/${facilityId}?tab=documents`} className="text-primary hover:underline">
            store CEMP PDF
          </Link>
        </p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Generator last test</p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums leading-tight",
            genTest == null ? "text-lg text-muted-foreground" : "text-2xl",
            genTest != null && generatorTestAccent(sinceGen, hasGen),
          )}
        >
          {formatLicensingTabYmdDate(genTest, BUILDING_STRIP_TZ)}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">{genSub}</p>
      </div>
    </div>
  );
}
