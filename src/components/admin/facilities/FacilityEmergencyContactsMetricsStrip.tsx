"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { EmergencyContactRow } from "@/hooks/useFacilityEmergencyContacts";
import { countMissingEmergencySlots, type SlotContext } from "@/lib/admin/facilities/emergency-directory";

function Tile({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-[8px] border border-border bg-muted/10 p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div className={cn("mt-2 text-3xl font-semibold tabular-nums text-foreground", valueClassName)}>{value}</div>
      {sub ? <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function FacilityEmergencyContactsMetricsStrip({
  contacts,
  isLoading,
  slotContext,
}: {
  contacts: EmergencyContactRow[];
  isLoading: boolean;
  slotContext: SlotContext;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[112px] animate-pulse rounded-[8px] border border-border bg-muted/20" />
        ))}
      </div>
    );
  }

  const total = contacts.length;
  const missing = countMissingEmergencySlots(contacts, slotContext);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Tile label="Total contacts" value={total} sub="Lines in this directory" />

      <Tile
        label="Verified (<90 days)"
        value="—"
        sub="Timestamps not available yet — enable in a future schema update"
        valueClassName="text-muted-foreground text-2xl"
      />

      <Tile
        label="24/7 lines confirmed"
        value="—"
        sub="Availability hours not stored yet — enable in a future schema update"
        valueClassName="text-muted-foreground text-2xl"
      />

      <Tile
        label="Required slots open"
        value={missing}
        sub={
          missing > 0 ? (
            <Link href="#emergency-required-gaps" className="font-medium text-primary underline-offset-4 hover:underline">
              Review gaps →
            </Link>
          ) : (
            "All tracked slots covered"
          )
        }
        valueClassName={missing > 0 ? "text-warning" : undefined}
      />
    </div>
  );
}
