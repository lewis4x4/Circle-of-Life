"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchExecutiveFacilityCompliance } from "@/lib/executive/facility-rounding-compliance";
import type { HomeRoundingSummary } from "@/lib/home/load-home";
import { formatComplianceRate, onTimeRate } from "@/lib/rounding/observation-compliance-summary";
import { cn } from "@/lib/utils";

import { CARD_CLASS, CARD_HEAD_CLASS, LINK_BUTTON_CLASS } from "./home-styles";

export type FacilityRoundingCardProps = {
  facilityId: string;
  facilityName: string;
  timeZone: string;
  rounding: HomeRoundingSummary;
};

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

/** Facility-scoped rounding assurance. No portfolio comparison on this page. */
export function FacilityRoundingCard({ facilityId, facilityName, timeZone, rounding }: FacilityRoundingCardProps) {
  const [sevenDay, setSevenDay] = useState<{ state: "loading" | "ready" | "unavailable"; label: string }>({ state: "loading", label: "Loading" });

  useEffect(() => {
    let cancelled = false;
    fetchExecutiveFacilityCompliance(facilityId)
      .then((summary) => {
        if (cancelled) return;
        setSevenDay({ state: "ready", label: formatComplianceRate(onTimeRate(summary.totals)) });
      })
      .catch(() => {
        if (!cancelled) setSevenDay({ state: "unavailable", label: "Unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [facilityId]);

  const missedTone = rounding.missedToday > 0 ? "text-warning" : "text-success";
  // Dark-theme destructive text sits under 4.5:1 on the card, so severity is
  // carried by weight plus a dot rather than by the number's colour.
  const escalationTone = rounding.openEscalations > 0 ? "font-semibold" : "";
  const lastEntry = rounding.lastEntryAt
    ? `${formatTime(rounding.lastEntryAt, timeZone)}${rounding.lastEntryBy ? ` · ${rounding.lastEntryBy}` : ""}`
    : "Nothing recorded yet";

  return (
    <section className={cn(CARD_CLASS, "overflow-hidden")} aria-labelledby="rounding-heading">
      <div className={CARD_HEAD_CLASS}>
        <div>
          <h2 id="rounding-heading" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
            <Clock className="size-4 text-muted-foreground" aria-hidden /> Rounding — {facilityName}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">This building only.</p>
        </div>
        <Link href="/admin/rounding" className={LINK_BUTTON_CLASS}>Smart Rounding →</Link>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-3 text-[13px]">
        <dt className="text-muted-foreground">Missed today</dt>
        <dd className={cn("text-right font-medium tabular-nums", rounding.available ? missedTone : "text-muted-foreground")}>{rounding.available ? rounding.missedToday : "Unavailable"}</dd>
        <dt className="text-muted-foreground">On time, last 7 days</dt>
        <dd className="text-right font-medium tabular-nums" aria-live="polite">{sevenDay.label}</dd>
        <dt className="text-muted-foreground">Open escalations</dt>
        <dd className={cn("inline-flex items-center justify-end gap-1.5 text-right font-medium tabular-nums", rounding.available ? escalationTone : "text-muted-foreground")}>
          {rounding.available && rounding.openEscalations > 0 ? <span className="size-1.5 rounded-full bg-destructive" aria-hidden /> : null}
          {rounding.available ? rounding.openEscalations : "Unavailable"}
        </dd>
        <dt className="text-muted-foreground">Last entry</dt>
        <dd className="text-right font-medium tabular-nums">{rounding.available ? lastEntry : "Unavailable"}</dd>
      </dl>
    </section>
  );
}
