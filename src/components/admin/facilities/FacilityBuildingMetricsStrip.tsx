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

  const lastFireLabel =
    lastFire == null
      ? "—"
      : new Date(`${lastFire}T12:00:00.000Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "America/New_York",
        });

  const nextFireLabel =
    nextFire == null
      ? "—"
      : new Date(`${nextFire}T12:00:00.000Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "America/New_York",
        });

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
            "mt-2 text-2xl font-semibold tabular-nums leading-tight",
            fireInspectionStalenessAccent(sinceFire),
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
        <p className={cn("mt-2 text-2xl font-semibold tabular-nums leading-tight", fireNextDueAccent(untilNext))}>
          {nextFireLabel}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">{nextFireSub}</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">CEMP status</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-muted-foreground leading-tight">—</p>
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
            "mt-2 text-2xl font-semibold tabular-nums leading-tight",
            generatorTestAccent(sinceGen, hasGen),
          )}
        >
          {genTest == null
            ? "—"
            : new Date(`${genTest}T12:00:00.000Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "America/New_York",
              })}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">{genSub}</p>
      </div>
    </div>
  );
}
