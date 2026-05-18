"use client";

import React, { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import { cn } from "@/lib/utils";

/** Dispatched from hero refresh; ledger listens to pull fresh invoices + cohort counts. */
export const BILLING_AR_OVERVIEW_REFRESH = "billing-ar-overview-refresh";

export function BillingArOverviewHero() {
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);
  const [asOf, setAsOf] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setAsOf(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const bump = () => setAsOf(new Date());
    window.addEventListener(BILLING_AR_OVERVIEW_REFRESH, bump);
    return () => window.removeEventListener(BILLING_AR_OVERVIEW_REFRESH, bump);
  }, []);

  function triggerRefresh() {
    setAsOf(new Date());
    window.dispatchEvent(new CustomEvent(BILLING_AR_OVERVIEW_REFRESH));
  }

  function pickAllFacilities() {
    setSelectedFacility(null);
    syncSelectedFacilityCookie(null);
  }

  function pickFacility(id: string) {
    setSelectedFacility(id);
    syncSelectedFacilityCookie(id);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Billing & AR</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Organization receivables and cash signals for the scope you pick below. Open Invoices for the full ledger, AR
          aging for buckets, Rate library for posted rates, Revenue for recognition views, and Per-facility AR for a
          facility-by-facility roll-up.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">Scope</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Billing data scope">
          <button
            type="button"
            role="radio"
            aria-checked={selectedFacilityId == null}
            onClick={pickAllFacilities}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
              selectedFacilityId == null
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            All facilities
          </button>
          {availableFacilities.map((f) => {
            const on = selectedFacilityId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pickFacility(f.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                  on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          As of{" "}
          {asOf.toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          ET
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={triggerRefresh}>
          <RotateCw className="size-3.5" aria-hidden />
          Refresh
        </Button>
        <span className="text-[11px] text-muted-foreground/80">Shortcuts: / search · R refresh · E export</span>
      </p>
    </div>
  );
}
