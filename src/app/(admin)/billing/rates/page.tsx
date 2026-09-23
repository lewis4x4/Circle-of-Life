"use client";

import { formatDisplayDate } from "@/lib/format/datetime";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Percent } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

import { formatBillingRateSurchargeCents } from "@/lib/billing/rates-display-copy";
import {
  RATE_OVERLAP_RULE_COPY,
  SCHEDULE_TIMELINE_LABEL,
  resolveBillingRateRule,
  resolveFacilitySchedule,
  scheduleTimelineState,
  type BillingRateRuleRow,
  type FacilityScheduleResolution,
  type RateOverlapRule,
} from "@/lib/billing/rate-schedule-in-force";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

type RateRow = {
  id: string;
  facilityId: string;
  organizationId: string;
  status: string;
  name: string;
  effectiveDate: string;
  endDate: string | null;
  basePrivateCents: number;
  baseSemiPrivateCents: number | null;
  careSurchargeLevel1Cents: number | null;
  careSurchargeLevel2Cents: number | null;
  careSurchargeLevel3Cents: number | null;
  communityFeeCents: number | null;
};

type SupabaseRateRow = {
  id: string;
  facility_id: string;
  organization_id: string;
  status: string | null;
  name: string;
  effective_date: string;
  end_date: string | null;
  base_rate_private: number;
  base_rate_semi_private: number | null;
  care_surcharge_level_1: number | null;
  care_surcharge_level_2: number | null;
  care_surcharge_level_3: number | null;
  community_fee: number | null;
  deleted_at: string | null;
};

type FacilityNameRow = { id: string; name: string };

/** One facility's schedules and which one applies today under its overlap rule. */
type FacilityRates = {
  facilityId: string;
  facilityName: string;
  rule: RateOverlapRule;
  resolution: FacilityScheduleResolution<RateRow>;
  schedules: RateRow[];
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

/** Surcharge cells rendered per rate row — defined once, not re-allocated per render. */
const RATE_SURCHARGE_FIELDS: ReadonlyArray<[label: string, get: (row: RateRow) => number | null]> = [
  ["Base companion", (row) => row.baseSemiPrivateCents],
  ["Care surcharge L1", (row) => row.careSurchargeLevel1Cents],
  ["Care surcharge L2", (row) => row.careSurchargeLevel2Cents],
  ["Care surcharge L3", (row) => row.careSurchargeLevel3Cents],
  ["Community fee", (row) => row.communityFeeCents],
];

function formatDate(isoDate: string): string {
  return formatDisplayDate(isoDate, { fallback: isoDate });
}

function buildFacilityRates(
  rows: RateRow[],
  facilityNames: Map<string, string>,
  rules: BillingRateRuleRow[],
  asOfIso: string,
): FacilityRates[] {
  const byFacility = new Map<string, RateRow[]>();
  for (const row of rows) {
    const list = byFacility.get(row.facilityId) ?? [];
    list.push(row);
    byFacility.set(row.facilityId, list);
  }
  return Array.from(byFacility.entries())
    .map(([facilityId, schedules]) => {
      const rule = resolveBillingRateRule(rules, schedules[0].organizationId, facilityId, asOfIso).rateOverlapRule;
      return {
        facilityId,
        facilityName: facilityNames.get(facilityId) ?? "Facility",
        rule,
        resolution: resolveFacilitySchedule(schedules, asOfIso, rule),
        schedules,
      };
    })
    .sort((a, b) => a.facilityName.localeCompare(b.facilityName));
}

function semiPrivateLabel(row: RateRow): string {
  return row.baseSemiPrivateCents == null ? "no semi-private rate" : `semi-private ${billingCurrency.format(row.baseSemiPrivateCents / 100)}`;
}

export default function AdminBillingRatesPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [facilities, setFacilities] = useState<FacilityRates[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const asOfIso = todayFacilityDateIso();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let q = supabase
        .from("rate_schedules" as never)
        .select(
          "id, facility_id, organization_id, status, name, effective_date, end_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3, community_fee, deleted_at",
        )
        .is("deleted_at", null)
        .order("effective_date", { ascending: false })
        .limit(100);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const [res, facilityRes, ruleRes] = (await Promise.all([
        q,
        supabase.from("facilities" as never).select("id, name").is("deleted_at", null),
        supabase
          .from("billing_rate_rules" as never)
          .select("id, organization_id, facility_id, effective_from, rate_overlap_rule, payer_split_is_concession, created_at"),
      ])) as unknown as [
        QueryListResult<SupabaseRateRow>,
        QueryListResult<FacilityNameRow>,
        QueryListResult<BillingRateRuleRow>,
      ];
      if (res.error) throw res.error;
      if (facilityRes.error) throw facilityRes.error;
      // An unreadable rule falls back to the stricter default, the same one the database applies.
      const rules = ruleRes.error ? [] : ruleRes.data ?? [];
      const facilityNames = new Map((facilityRes.data ?? []).map((f) => [f.id, f.name] as const));
      const list = res.data ?? [];
      const rows: RateRow[] = list.map((r) => ({
          id: r.id,
          facilityId: r.facility_id,
          organizationId: r.organization_id,
          status: r.status ?? "published",
          name: r.name,
          effectiveDate: r.effective_date,
          endDate: r.end_date,
          basePrivateCents: r.base_rate_private,
          baseSemiPrivateCents: r.base_rate_semi_private,
          careSurchargeLevel1Cents: r.care_surcharge_level_1,
          careSurchargeLevel2Cents: r.care_surcharge_level_2,
          careSurchargeLevel3Cents: r.care_surcharge_level_3,
          communityFeeCents: r.community_fee,
        }));
      setFacilities(buildFacilityRates(rows, facilityNames, rules, todayFacilityDateIso()));
    } catch (err) {
      setFacilities([]);
      setError(formatLiveDataLoadError(err, "Live rate schedules are unavailable."));
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2">
        <BillingHubNav />
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-5 md:p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Rate Schedules
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
              Posted standard facility rates mapped by effective date. Resident-specific negotiated rent is managed from each resident billing profile and rolled up in Concessions.
            </p>
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Version history is read-only and reflects stored schedule fields.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
             <Link className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-wider text-[10px]")} href="/admin/billing/rates/new">
               + Add Schedule
             </Link>
             <Badge className="bg-muted text-muted-foreground border border-border uppercase tracking-wider font-mono text-[9px] font-bold px-3 shadow-none">
                <Percent className="mr-1.5 h-3 w-3" />
                {facilities.filter((f) => f.resolution.winner).length} of {facilities.length} facilities with a schedule in force
             </Badge>
          </div>
        </header>

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && facilities.length === 0 && !error ? (
          <AdminEmptyState
            title="No rate schedules"
            description={
              isValidFacilityIdForQuery(selectedFacilityId)
                ? "This facility has no posted rate schedule yet. Add one with + Add Schedule."
                : "No facility has a posted rate schedule yet. Add one with + Add Schedule."
            }
          />
        ) : null}
        
        {!isLoading && facilities.length > 0
          ? facilities.map((facility) => (
              <section
                key={facility.facilityId}
                aria-label={`${facility.facilityName} rate schedules`}
                className="relative overflow-hidden rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8"
              >
                <div className="mb-6 flex flex-col gap-3 border-b border-border pb-4">
                  <h3 className="text-xl font-semibold text-foreground">{facility.facilityName}</h3>
                  <InForceSummary facility={facility} />
                  <p className="text-xs text-muted-foreground">Rule: {RATE_OVERLAP_RULE_COPY[facility.rule]}.</p>
                </div>

                <MotionList className="space-y-3">
                  {facility.schedules.map((row) => {
                    const state = scheduleTimelineState(row, asOfIso);
                    const applies = facility.resolution.winner?.id === row.id;
                    return (
                      <MotionItem key={row.id}>
                        <div className="group flex flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-sm transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:shadow-md">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 flex-col gap-2">
                              <div className="flex flex-wrap items-center gap-3">
                                <Badge
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider shadow-none",
                                    applies
                                      ? "border-success/20 bg-success/10 text-success"
                                      : "border-border bg-muted text-muted-foreground",
                                  )}
                                >
                                  {applies ? "Applies today" : SCHEDULE_TIMELINE_LABEL[state]}
                                </Badge>
                                <span className="text-lg font-semibold tracking-tight text-foreground">{row.name}</span>
                              </div>
                              <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                                Duration: {formatDate(row.effectiveDate)} — {row.endDate ? formatDate(row.endDate) : "Ongoing"}
                              </p>
                            </div>
                            <div className="flex w-full flex-col items-start sm:w-1/3 sm:items-end">
                              <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Base Private Rate</span>
                              <span className="text-xl font-medium tabular-nums text-foreground">
                                {billingCurrency.format(row.basePrivateCents / 100)}
                              </span>
                            </div>
                          </div>
                          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-5">
                            {RATE_SURCHARGE_FIELDS.map(([label, get]) => {
                              const cents = get(row);
                              return (
                                <div key={label} className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                                  <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                                    {formatBillingRateSurchargeCents(cents)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </MotionItem>
                    );
                  })}
                </MotionList>
              </section>
            ))
          : null}
      </div>
    </div>
  );
}

/** Names the schedule that applies today, the next one, or why none applies. */
function InForceSummary({ facility }: { facility: FacilityRates }) {
  const { winner, conflicting, next } = facility.resolution;
  return (
    <div className="space-y-1 text-sm text-foreground">
      {winner ? (
        <p>
          <span className="font-semibold">In force today:</span> {winner.name} — private{" "}
          {billingCurrency.format(winner.basePrivateCents / 100)}, {semiPrivateLabel(winner)}.
        </p>
      ) : conflicting.length > 0 ? (
        <p className="text-destructive">
          {conflicting.length} schedules are in force at once ({conflicting.map((row) => row.name).join("; ")}). Only one may
          be in force — end-date the one that no longer applies.
        </p>
      ) : (
        <p className="text-muted-foreground">No schedule is in force today.</p>
      )}
      {next ? (
        <p className="text-muted-foreground">
          Next: {next.name} from {formatDate(next.effectiveDate)} — private {billingCurrency.format(next.basePrivateCents / 100)},{" "}
          {semiPrivateLabel(next)}.
        </p>
      ) : null}
    </div>
  );
}
