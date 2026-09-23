"use client";

import { formatDisplayDate } from "@/lib/format/datetime";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign, FileSpreadsheet, UserCircle } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { Badge } from "@/components/ui/badge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/v2-card";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

import { formatConcessionsDateDisplay } from "@/lib/billing/concessions-display-copy";
import {
  buildConcessionRows,
  concessionsResidentCountLabel,
  summarizeConcessions,
  type ConcessionAgreementInput,
  type ConcessionPayerInput,
  type ConcessionRow,
} from "@/lib/billing/concessions-model";
import {
  resolveBillingRateRule,
  resolveFacilitySchedule,
  type BillingRateRuleRow,
} from "@/lib/billing/rate-schedule-in-force";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";
import { enumLabel } from "@/lib/display/enum-label";

type ResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  acuity_level: string | null;
  monthly_total_rate: number | null;
  rate_effective_date: string | null;
  bed_by_id: BedJoin | BedJoin[] | null;
};

type BedJoin = { rooms: { room_type: string | null } | { room_type: string | null }[] | null };

type RateScheduleRow = {
  id: string;
  organization_id: string;
  status: string | null;
  effective_date: string;
  end_date: string | null;
  base_rate_private: number;
  base_rate_semi_private: number | null;
  care_surcharge_level_1: number | null;
  care_surcharge_level_2: number | null;
  care_surcharge_level_3: number | null;
};

type PayerRow = {
  resident_id: string;
  payer_type: string;
  payer_name: string | null;
  payer_share_type: string;
  payer_fixed_amount: number | null;
  medicaid_rate: number | null;
  medicaid_patient_responsibility: number | null;
  effective_date: string;
  end_date: string | null;
};

type AgreementRow = {
  id: string;
  resident_id: string;
  room_class: string;
  status: string;
  effective_date: string;
  end_date: string | null;
  standard_monthly_total_at_signing: number;
  negotiated_monthly_total: number;
  concession_amount_at_signing: number;
  concession_reason: string;
  concession_expires_on: string | null;
};

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function residentName(row: ResidentRow): string {
  return `${(row.last_name ?? "").trim()}, ${(row.first_name ?? "").trim()}`.replace(/^, |, $/, "") || "Resident";
}

function reasonLabel(reason: string): string {
  if (!reason || reason === "none") return "None";
  return reason.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function roomLabel(row: ConcessionRow): string {
  if (!row.roomClass) return "Room not known";
  return row.roomClassFrom === "bed" ? `${enumLabel(row.roomClass)} (from bed)` : enumLabel(row.roomClass);
}

export default function BillingConcessionsPage() {
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);
  const [rows, setRows] = useState<ConcessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const asOfDate = todayFacilityDateIso();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      if (!isValidFacilityIdForQuery(selectedFacilityId)) {
        // Gated below: no facility is not a load failure.
        setRows([]);
        return;
      }

      const targetDate = todayFacilityDateIso();
      const [residentRes, scheduleRes, agreementRes, payerRes, ruleRes] = (await Promise.all([
        supabase
          .from("residents" as never)
          .select("id, first_name, last_name, acuity_level, monthly_total_rate, rate_effective_date, bed_by_id: beds!residents_bed_id_fkey ( rooms ( room_type ) )")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .eq("status", "active")
          .order("last_name", { ascending: true })
          .limit(500),
        supabase
          .from("rate_schedules" as never)
          .select("id, organization_id, status, effective_date, end_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("effective_date", { ascending: false })
          .limit(100),
        supabase
          .from("resident_rate_agreements" as never)
          .select("id, resident_id, room_class, status, effective_date, end_date, standard_monthly_total_at_signing, negotiated_monthly_total, concession_amount_at_signing, concession_reason, concession_expires_on")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .eq("status", "active")
          .lte("effective_date", targetDate)
          .or(`end_date.is.null,end_date.gte.${targetDate}`)
          .order("effective_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("resident_payers" as never)
          .select("resident_id, payer_type, payer_name, payer_share_type, payer_fixed_amount, medicaid_rate, medicaid_patient_responsibility, effective_date, end_date")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .limit(2000),
        supabase
          .from("billing_rate_rules" as never)
          .select("id, organization_id, facility_id, effective_from, rate_overlap_rule, payer_split_is_concession, created_at"),
      ])) as unknown as [
        QueryListResult<ResidentRow>,
        QueryListResult<RateScheduleRow>,
        QueryListResult<AgreementRow>,
        QueryListResult<PayerRow>,
        QueryListResult<BillingRateRuleRow>,
      ];

      if (residentRes.error) throw residentRes.error;
      if (scheduleRes.error) throw scheduleRes.error;
      if (agreementRes.error) throw agreementRes.error;
      if (payerRes.error) throw payerRes.error;

      const schedules = scheduleRes.data ?? [];
      // An unreadable rule falls back to the stricter default, the same one the database applies.
      const rule = resolveBillingRateRule(
        ruleRes.error ? [] : ruleRes.data ?? [],
        schedules[0]?.organization_id ?? "",
        selectedFacilityId!,
        targetDate,
      );
      const resolution = resolveFacilitySchedule(
        schedules.map((row) => ({ ...row, effectiveDate: row.effective_date, endDate: row.end_date, status: row.status ?? "published" })),
        targetDate,
        rule.rateOverlapRule,
      );
      if (resolution.conflicting.length > 0) {
        throw new Error(
          `${resolution.conflicting.length} posted rate schedules are in force at once for this facility. End-date the one that no longer applies on the Rates page before comparing rents.`,
        );
      }
      const winner = resolution.winner;
      const schedule = winner
        ? {
            basePrivateCents: winner.base_rate_private,
            baseSemiPrivateCents: winner.base_rate_semi_private,
            careLevel1Cents: winner.care_surcharge_level_1 ?? 0,
            careLevel2Cents: winner.care_surcharge_level_2 ?? 0,
            careLevel3Cents: winner.care_surcharge_level_3 ?? 0,
          }
        : null;

      const agreementsByResident = new Map<string, ConcessionAgreementInput>();
      for (const agreement of agreementRes.data ?? []) {
        if (agreementsByResident.has(agreement.resident_id)) continue;
        agreementsByResident.set(agreement.resident_id, {
          roomClass: agreement.room_class,
          effectiveDate: agreement.effective_date,
          negotiatedMonthlyTotalCents: agreement.negotiated_monthly_total,
          standardMonthlyTotalAtSigningCents: agreement.standard_monthly_total_at_signing,
          concessionReason: agreement.concession_reason,
          concessionExpiresOn: agreement.concession_expires_on,
        });
      }

      const payersByResident = new Map<string, ConcessionPayerInput[]>();
      for (const payer of payerRes.data ?? []) {
        if (payer.effective_date > targetDate || (payer.end_date != null && payer.end_date < targetDate)) continue;
        const list = payersByResident.get(payer.resident_id) ?? [];
        list.push({
          payerType: payer.payer_type,
          payerName: payer.payer_name,
          payerShareType: payer.payer_share_type,
          payerFixedAmountCents: payer.payer_fixed_amount,
          medicaidRateCents: payer.medicaid_rate,
          medicaidPatientResponsibilityCents: payer.medicaid_patient_responsibility,
        });
        payersByResident.set(payer.resident_id, list);
      }

      setRows(
        buildConcessionRows({
          residents: (residentRes.data ?? []).map((resident) => ({
            id: resident.id,
            name: residentName(resident),
            acuityLevel: resident.acuity_level,
            monthlyTotalRateCents: resident.monthly_total_rate,
            rateEffectiveDate: resident.rate_effective_date,
            bedRoomType: one(one(resident.bed_by_id)?.rooms)?.room_type ?? null,
            payers: payersByResident.get(resident.id) ?? [],
          })),
          agreementsByResident,
          schedule,
          payerSplitIsConcession: rule.payerSplitIsConcession,
        }),
      );
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Could not load concession tracking.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => summarizeConcessions(rows), [rows]);

  return (
    <div className="relative w-full space-y-6 pb-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 rounded-[3rem] bg-gradient-to-b from-amber-500/10 via-transparent to-transparent blur-3xl" aria-hidden />
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <BillingHubNav />

        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-amber-50/30 dark:bg-black/20 p-8 rounded-[2.5rem] border border-amber-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 dark:bg-white/5 border border-amber-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300 mb-2">
              <BadgeDollarSign className="h-3.5 w-3.5" aria-hidden /> Resident concessions
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Rate Concession Register
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-3xl">
              A concession is a discount against the same payer&apos;s posted rate: a private-pay resident&apos;s rent against the posted rate for their room and care level. Residents whose rent is split with Medicaid, insurance or another payer are listed as payer splits, not concessions.
            </p>
            <p className="text-sm text-muted-foreground">
              Rate schedules and agreements as of {formatDisplayDate(asOfDate)}.
            </p>
            {!isLoading && rows.length > 0 ? (
              <p className="text-sm text-muted-foreground">{concessionsResidentCountLabel(rows.length)}.</p>
            ) : null}
          </div>
        </header>

        {!facilityReady ? (
          <FacilityGateNotice reason="Concessions compare each resident's rent with the rate schedule posted for their building." />
        ) : null}

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {!isLoading && rows.length > 0 ? (
          <>
            <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-2" staggerMs={75}>
              <div className="h-[160px]"><MetricCard label="Posted private-pay rate" value={totals.postedCents} tone="slate" /></div>
              <div className="h-[160px]"><MetricCard label="Agreed private rent" value={totals.agreedCents} tone="emerald" /></div>
              <div className="h-[160px]"><MetricCard label="Concessions" value={totals.concessionsCents} tone="amber" /></div>
              <div className="h-[160px]"><MetricCard label="Premiums" value={totals.premiumsCents} tone="indigo" /></div>
            </KineticGrid>
            <p className="mb-6 text-sm text-muted-foreground">
              Tiles cover {totals.concessionResidents} private-pay resident{totals.concessionResidents === 1 ? "" : "s"}.
              {totals.payerSplitResidents > 0
                ? ` ${totals.payerSplitResidents} resident${totals.payerSplitResidents === 1 ? " has" : "s have"} a payer split (${billingCurrency.format(totals.payerSplitTermsCents / 100)} in monthly terms) and ${totals.payerSplitResidents === 1 ? "is" : "are"} not counted as concessions.`
                : ""}
              {totals.notComparedResidents > 0
                ? ` ${totals.notComparedResidents} not compared: no room on file and no posted rate for it.`
                : ""}
            </p>
          </>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && rows.length === 0 && !error ? (
          <AdminEmptyState title="No concession rows" description="Confirm negotiated terms on resident billing profiles or import monthly rent data." />
        ) : null}

        {!isLoading && rows.length > 0 ? (
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Resident Detail</h3>
              <p className="text-[10px] font-mono tracking-widest text-muted-foreground mt-1 uppercase"><FileSpreadsheet className="inline h-3 w-3 mr-1" />Management visibility</p>
            </div>
            <MotionList className="space-y-3">
              {rows.map((row) => (
                <MotionItem key={`${row.kind}-${row.residentId}`}>
                  <Link href={`/admin/residents/${row.residentId}/billing`} className="block rounded-2xl focus-visible:outline-none focus:ring-2 focus:ring-amber-500">
                    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-amber-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.03] lg:grid-cols-[1.5fr_0.8fr_1fr_1fr_1fr_1fr] lg:items-center">
                      <div className="flex items-center gap-3">
                        <div className="rounded-full bg-amber-50 p-2 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"><UserCircle className="h-5 w-5" /></div>
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{row.residentName}</p>
                          <p className="text-xs text-muted-foreground">{formatConcessionsDateDisplay(row.effectiveDate)} · {roomLabel(row)}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="w-fit">
                        {row.kind === "payer_split" ? "Payer split" : row.source === "agreement" ? "Confirmed" : "Imported"}
                      </Badge>
                      {row.kind === "payer_split" ? (
                        <>
                          <MoneyCell label="Monthly terms" value={row.agreedCents} />
                          <div className="lg:col-span-2">
                            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Paid by</p>
                            <ul className="text-sm text-foreground">
                              {row.splits.map((split, index) => (
                                <li key={`${split.label}-${index}`}>
                                  {split.label}: {split.cents == null ? "amount not on file" : billingCurrency.format(split.cents / 100)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </>
                      ) : (
                        <>
                          {row.postedCents == null ? (
                            <TextCell label="Posted rate" value="Not compared" />
                          ) : (
                            <MoneyCell label="Posted rate" value={row.postedCents} />
                          )}
                          <MoneyCell label="Agreed rent" value={row.agreedCents} />
                          {row.concessionCents == null ? (
                            <TextCell label="Concession" value="—" />
                          ) : (
                            <MoneyCell label={row.concessionCents >= 0 ? "Concession" : "Premium"} value={Math.abs(row.concessionCents)} />
                          )}
                        </>
                      )}
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Reason</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{row.kind === "payer_split" ? "Not a concession" : reasonLabel(row.reason)}</p>
                        {row.expiresOn ? <p className="text-xs text-amber-600 dark:text-amber-300">Expires {formatConcessionsDateDisplay(row.expiresOn)}</p> : null}
                      </div>
                    </div>
                  </Link>
                </MotionItem>
              ))}
            </MotionList>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: "slate" | "emerald" | "amber" | "indigo" }) {
  const toneClass = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "indigo" ? "text-indigo-600 dark:text-indigo-400" : "text-slate-700 dark:text-slate-200";
  return (
    <V2Card hoverColor={tone} className="h-full">
      <MonolithicWatermark value={Math.round(value / 100 / 1000) + "k"} className="opacity-40" />
      <div className="relative z-10 flex h-full flex-col justify-between p-2">
        <h3 className={`text-[10px] font-bold tracking-widest uppercase ${toneClass}`}>{label}</h3>
        <p className={`text-3xl font-display font-medium tracking-tight tabular-nums ${toneClass}`}>{billingCurrency.format(value / 100)}</p>
      </div>
    </V2Card>
  );
}

function MoneyCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{billingCurrency.format(value / 100)}</p>
    </div>
  );
}

function TextCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  );
}
