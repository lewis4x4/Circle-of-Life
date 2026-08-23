"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign, FileSpreadsheet, UserCircle } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { V2Card } from "@/components/ui/v2-card";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

import { formatConcessionsDateDisplay } from "@/lib/billing/concessions-display-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

type ResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  acuity_level: string | null;
  monthly_total_rate: number | null;
  monthly_base_rate: number | null;
  rate_effective_date: string | null;
};

type RateSchedule = {
  base_rate_private: number;
  base_rate_semi_private: number | null;
  care_surcharge_level_1: number;
  care_surcharge_level_2: number;
  care_surcharge_level_3: number;
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

type ConcessionRow = {
  residentId: string;
  residentName: string;
  source: "agreement" | "imported";
  roomClass: string;
  standardCents: number;
  actualCents: number;
  concessionCents: number;
  reason: string;
  effectiveDate: string | null;
  expiresOn: string | null;
};

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function residentName(row: ResidentRow): string {
  return `${(row.last_name ?? "").trim()}, ${(row.first_name ?? "").trim()}`.replace(/^, |, $/, "") || "Resident";
}

function reasonLabel(reason: string): string {
  if (!reason || reason === "none") return "None";
  return reason.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function careForAcuity(schedule: RateSchedule | null, acuity: string | null): number {
  if (!schedule) return 0;
  if (acuity === "level_1") return schedule.care_surcharge_level_1 ?? 0;
  if (acuity === "level_2") return schedule.care_surcharge_level_2 ?? 0;
  if (acuity === "level_3") return schedule.care_surcharge_level_3 ?? 0;
  return 0;
}

function baseForRoom(schedule: RateSchedule | null, roomClass: string): number {
  if (!schedule) return 0;
  if (roomClass === "companion") return schedule.base_rate_semi_private ?? schedule.base_rate_private;
  return schedule.base_rate_private;
}

export default function BillingConcessionsPage() {
  const { selectedFacilityId } = useFacilityStore();
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
        setRows([]);
        setError("Select a facility to view concession tracking.");
        return;
      }

      const targetDate = todayFacilityDateIso();
      const [residentRes, scheduleRes, agreementRes] = (await Promise.all([
        supabase
          .from("residents" as never)
          .select("id, first_name, last_name, acuity_level, monthly_total_rate, monthly_base_rate, rate_effective_date")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .eq("status", "active")
          .order("last_name", { ascending: true })
          .limit(500),
        supabase
          .from("rate_schedules" as never)
          .select("base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .lte("effective_date", targetDate)
          .or(`end_date.is.null,end_date.gte.${targetDate}`)
          .order("effective_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1),
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
      ])) as unknown as [QueryListResult<ResidentRow>, QueryListResult<RateSchedule>, QueryListResult<AgreementRow>];

      if (residentRes.error) throw residentRes.error;
      if (scheduleRes.error) throw scheduleRes.error;
      if (agreementRes.error) throw agreementRes.error;

      const residents = residentRes.data ?? [];
      const schedule = (scheduleRes.data ?? [])[0] ?? null;
      const agreements = agreementRes.data ?? [];
      const agreementByResident = new Map<string, AgreementRow>();
      for (const agreement of agreements) {
        if (!agreementByResident.has(agreement.resident_id)) agreementByResident.set(agreement.resident_id, agreement);
      }

      const builtRows: ConcessionRow[] = [];
      for (const resident of residents) {
        const agreement = agreementByResident.get(resident.id);
        if (agreement) {
          const currentStandard = baseForRoom(schedule, agreement.room_class) + careForAcuity(schedule, resident.acuity_level);
          const standard = currentStandard > 0 ? currentStandard : agreement.standard_monthly_total_at_signing;
          builtRows.push({
            residentId: resident.id,
            residentName: residentName(resident),
            source: "agreement",
            roomClass: agreement.room_class,
            standardCents: standard,
            actualCents: agreement.negotiated_monthly_total,
            concessionCents: standard - agreement.negotiated_monthly_total,
            reason: agreement.concession_reason,
            effectiveDate: agreement.effective_date,
            expiresOn: agreement.concession_expires_on,
          });
          continue;
        }

        if (!resident.monthly_total_rate || resident.monthly_total_rate <= 0) continue;
        const standard = (schedule?.base_rate_private ?? 0) + careForAcuity(schedule, resident.acuity_level);
        builtRows.push({
          residentId: resident.id,
          residentName: residentName(resident),
          source: "imported",
          roomClass: "unconfirmed",
          standardCents: standard,
          actualCents: resident.monthly_total_rate,
          concessionCents: standard - resident.monthly_total_rate,
          reason: "legacy_rate_lock",
          effectiveDate: resident.rate_effective_date,
          expiresOn: null,
        });
      }
      builtRows.sort((a, b) => b.concessionCents - a.concessionCents);

      setRows(builtRows);
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

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      standard: acc.standard + row.standardCents,
      actual: acc.actual + row.actualCents,
      concessions: acc.concessions + Math.max(0, row.concessionCents),
      premiums: acc.premiums + Math.max(0, -row.concessionCents),
    }),
    { standard: 0, actual: 0, concessions: 0, premiums: 0 },
  ), [rows]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
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
              Shows current posted standard rate versus actual resident monthly rent. Imported rows should be confirmed into negotiated billing agreements from each resident billing profile.
            </p>
            <p className="text-sm text-muted-foreground">
              Rate schedules and agreements as of {asOfDate} Eastern.
            </p>
          </div>
        </header>

        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}

        {!isLoading && rows.length > 0 ? (
          <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
            <div className="h-[160px]"><MetricCard label="Posted standard" value={totals.standard} tone="slate" /></div>
            <div className="h-[160px]"><MetricCard label="Actual rent" value={totals.actual} tone="emerald" /></div>
            <div className="h-[160px]"><MetricCard label="Concessions" value={totals.concessions} tone="amber" /></div>
            <div className="h-[160px]"><MetricCard label="Premiums" value={totals.premiums} tone="indigo" /></div>
          </KineticGrid>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && rows.length === 0 && !error ? (
          <AdminEmptyState title="No concession rows" description="Confirm negotiated terms on resident billing profiles or import monthly rent data." />
        ) : null}

        {!isLoading && rows.length > 0 ? (
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Resident Detail</h3>
              <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase"><FileSpreadsheet className="inline h-3 w-3 mr-1" />Management visibility</p>
            </div>
            <MotionList className="space-y-3">
              {rows.map((row) => (
                <MotionItem key={`${row.source}-${row.residentId}`}>
                  <Link href={`/admin/residents/${row.residentId}/billing`} className="block rounded-2xl focus-visible:outline-none focus:ring-2 focus:ring-amber-500">
                    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-amber-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.03] lg:grid-cols-[1.5fr_0.8fr_1fr_1fr_1fr_1fr] lg:items-center">
                      <div className="flex items-center gap-3">
                        <div className="rounded-full bg-amber-50 p-2 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"><UserCircle className="h-5 w-5" /></div>
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{row.residentName}</p>
                          <p className="text-xs text-slate-500">{formatConcessionsDateDisplay(row.effectiveDate)} · {row.roomClass.replace(/_/g, " ")}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="w-fit capitalize">{row.source === "agreement" ? "Confirmed" : "Imported"}</Badge>
                      <MoneyCell label="Standard" value={row.standardCents} />
                      <MoneyCell label="Actual" value={row.actualCents} />
                      <MoneyCell label={row.concessionCents >= 0 ? "Concession" : "Premium"} value={Math.abs(row.concessionCents)} />
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-slate-500">Reason</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{reasonLabel(row.reason)}</p>
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
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{billingCurrency.format(value / 100)}</p>
    </div>
  );
}
