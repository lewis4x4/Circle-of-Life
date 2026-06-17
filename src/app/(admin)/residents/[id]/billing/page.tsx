"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BadgeDollarSign, CreditCard, Loader2, Save } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatColLabel } from "@/lib/col-labels";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

import { BillingInvoiceLedger, PayerTypeBadge, billingCurrency, mapDbPayerTypeToUi } from "../../../billing/billing-invoice-ledger";

type SupabaseResident = {
  id: string;
  facility_id: string;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  acuity_level: string | null;
  monthly_base_rate: number | null;
  monthly_care_surcharge: number | null;
  monthly_total_rate: number | null;
  rate_effective_date: string | null;
  deleted_at: string | null;
};

type SupabasePayer = {
  id: string;
  payer_type: string;
  is_primary: boolean;
  payer_name: string | null;
  effective_date: string;
  end_date: string | null;
  medicaid_rate_unit: string | null;
  facility_medicaid_provider_id: string | null;
  deleted_at: string | null;
};

type MedicaidProvider = {
  id: string;
  provider_name: string;
  rate_unit: string;
};

type RateSchedule = {
  id: string;
  name: string;
  effective_date: string;
  base_rate_private: number;
  base_rate_semi_private: number | null;
  care_surcharge_level_1: number;
  care_surcharge_level_2: number;
  care_surcharge_level_3: number;
};

type RateAgreement = {
  id: string;
  resident_id: string;
  facility_id: string;
  organization_id: string;
  status: string;
  version: number;
  effective_date: string;
  end_date: string | null;
  room_class: "private" | "companion" | "other";
  standard_base_rate_at_signing: number;
  standard_care_surcharge_at_signing: number;
  standard_monthly_total_at_signing: number;
  negotiated_base_rate: number;
  care_charge_mode: "standard" | "flat" | "bundled" | "waived";
  negotiated_care_surcharge: number | null;
  negotiated_monthly_total: number;
  concession_amount_at_signing: number;
  concession_pct_at_signing: number;
  concession_reason: string;
  concession_notes: string | null;
  concession_expires_on: string | null;
  approved_at: string | null;
  notes: string | null;
};

type QueryResult<T> = { data: T | null; error: { message: string; code?: string } | null };
type QueryListResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };

const CONCESSION_REASONS = [
  ["none", "None / standard"],
  ["move_in_incentive", "Move-in incentive"],
  ["financial_hardship", "Financial hardship"],
  ["length_of_stay_loyalty", "Length-of-stay loyalty"],
  ["legacy_rate_lock", "Legacy rate lock"],
  ["medicaid_pending_bridge", "Medicaid pending bridge"],
  ["referral_partner", "Referral partner"],
  ["care_level_offset", "Care level offset"],
  ["goodwill_service_recovery", "Goodwill / service recovery"],
  ["other", "Other"],
] as const;

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/[$,]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function rateForRoom(schedule: RateSchedule | null, roomClass: "private" | "companion" | "other"): number {
  if (!schedule) return 0;
  if (roomClass === "companion") return schedule.base_rate_semi_private ?? schedule.base_rate_private;
  return schedule.base_rate_private;
}

function careForAcuity(schedule: RateSchedule | null, acuity: string | null): number {
  if (!schedule) return 0;
  if (acuity === "level_1") return schedule.care_surcharge_level_1 ?? 0;
  if (acuity === "level_2") return schedule.care_surcharge_level_2 ?? 0;
  if (acuity === "level_3") return schedule.care_surcharge_level_3 ?? 0;
  return 0;
}

function reasonLabel(reason: string): string {
  return CONCESSION_REASONS.find(([value]) => value === reason)?.[1] ?? reason.replace(/_/g, " ");
}

function formatRateUnitLabel(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "monthly") return "Monthly";
  if (value === "daily") return "Daily";
  if (value === "weekly") return "Weekly";
  if (value === "per_billable_day") return "Per Billable Day";
  return formatColLabel(value);
}

export default function ResidentBillingPage() {
  const params = useParams();
  const rawId = typeof params?.id === "string" ? params.id : "";
  const residentId = UUID_STRING_RE.test(rawId) ? rawId : "";
  const { selectedFacilityId } = useFacilityStore();

  const [resident, setResident] = useState<SupabaseResident | null>(null);
  const [residentName, setResidentName] = useState("");
  const [payers, setPayers] = useState<SupabasePayer[]>([]);
  const [providers, setProviders] = useState<MedicaidProvider[]>([]);
  const [agreements, setAgreements] = useState<RateAgreement[]>([]);
  const [rateSchedule, setRateSchedule] = useState<RateSchedule | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentAgreement = agreements.find((agreement) => agreement.status === "active" && !agreement.end_date) ?? agreements[0] ?? null;

  const [roomClass, setRoomClass] = useState<"private" | "companion" | "other">("private");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [negotiatedBase, setNegotiatedBase] = useState("");
  const [careMode, setCareMode] = useState<"standard" | "flat" | "bundled" | "waived">("standard");
  const [negotiatedCare, setNegotiatedCare] = useState("");
  const [negotiatedTotal, setNegotiatedTotal] = useState("");
  const [concessionReason, setConcessionReason] = useState("legacy_rate_lock");
  const [concessionNotes, setConcessionNotes] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");

  const standardBase = useMemo(() => rateForRoom(rateSchedule, roomClass), [rateSchedule, roomClass]);
  const standardCare = useMemo(() => careForAcuity(rateSchedule, resident?.acuity_level ?? null), [rateSchedule, resident?.acuity_level]);
  const standardTotal = standardBase + standardCare;
  const negotiatedTotalCents = dollarsToCents(negotiatedTotal) ?? 0;
  const concessionCents = standardTotal - negotiatedTotalCents;
  const concessionPct = standardTotal > 0 ? (concessionCents / standardTotal) * 100 : 0;

  const load = useCallback(async () => {
    if (!residentId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const supabase = createClient();
      const res = (await supabase
        .from("residents" as never)
        .select("id, facility_id, organization_id, first_name, last_name, acuity_level, monthly_base_rate, monthly_care_surcharge, monthly_total_rate, rate_effective_date, deleted_at")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<SupabaseResident>;
      if (res.error) throw res.error;
      const r = res.data;
      if (!r) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }
      if (isValidFacilityIdForQuery(selectedFacilityId) && r.facility_id !== selectedFacilityId) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }
      const fn = r.first_name?.trim() ?? "";
      const ln = r.last_name?.trim() ?? "";
      setResident(r);
      setResidentName(`${fn} ${ln}`.trim() || "Resident");
      const scheduleTargetDate = r.rate_effective_date ?? todayIso();

      const [payRes, scheduleRes, agreementRes, providerRes] = (await Promise.all([
        supabase
          .from("resident_payers" as never)
          .select("id, payer_type, is_primary, payer_name, effective_date, end_date, medicaid_rate_unit, facility_medicaid_provider_id, deleted_at")
          .eq("resident_id", residentId)
          .is("deleted_at", null)
          .order("effective_date", { ascending: false }),
        supabase
          .from("rate_schedules" as never)
          .select("id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3")
          .eq("facility_id", r.facility_id)
          .is("deleted_at", null)
          .lte("effective_date", scheduleTargetDate)
          .or(`end_date.is.null,end_date.gte.${scheduleTargetDate}`)
          .order("effective_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("resident_rate_agreements" as never)
          .select("*")
          .eq("resident_id", residentId)
          .is("deleted_at", null)
          .order("effective_date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("facility_medicaid_providers" as never)
          .select("id, provider_name, rate_unit")
          .eq("facility_id", r.facility_id)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("provider_name", { ascending: true }),
      ])) as unknown as [QueryListResult<SupabasePayer>, QueryListResult<RateSchedule>, QueryListResult<RateAgreement>, QueryListResult<MedicaidProvider>];

      if (payRes.error) throw payRes.error;
      if (scheduleRes.error) throw scheduleRes.error;
      if (agreementRes.error) throw agreementRes.error;
      if (providerRes.error) throw providerRes.error;
      setPayers(payRes.data ?? []);
      setProviders(providerRes.data ?? []);
      setRateSchedule((scheduleRes.data ?? [])[0] ?? null);
      setAgreements(agreementRes.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load resident billing profile.");
      setNotFound(true);
      setPayers([]);
      setProviders([]);
      setAgreements([]);
    } finally {
      setIsLoading(false);
    }
  }, [residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!resident || !effectiveDate) return;
    const residentForSchedule = resident;
    const scheduleDate = effectiveDate;
    let cancelled = false;
    async function loadScheduleForEffectiveDate() {
      try {
        const supabase = createClient();
        const scheduleRes = (await supabase
          .from("rate_schedules" as never)
          .select("id, name, effective_date, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3")
          .eq("facility_id", residentForSchedule.facility_id)
          .is("deleted_at", null)
          .lte("effective_date", scheduleDate)
          .or(`end_date.is.null,end_date.gte.${scheduleDate}`)
          .order("effective_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)) as unknown as QueryListResult<RateSchedule>;
        if (scheduleRes.error) throw scheduleRes.error;
        if (!cancelled) setRateSchedule((scheduleRes.data ?? [])[0] ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load posted rate schedule.");
      }
    }
    void loadScheduleForEffectiveDate();
    return () => {
      cancelled = true;
    };
  }, [resident, effectiveDate]);

  useEffect(() => {
    if (!resident) return;
    const active = agreements.find((agreement) => agreement.status === "active" && !agreement.end_date) ?? agreements[0] ?? null;
    if (active) {
      setRoomClass(active.room_class);
      setEffectiveDate(active.effective_date);
      setNegotiatedBase(centsToInput(active.negotiated_base_rate));
      setCareMode(active.care_charge_mode);
      setNegotiatedCare(centsToInput(active.negotiated_care_surcharge));
      setNegotiatedTotal(centsToInput(active.negotiated_monthly_total));
      setConcessionReason(active.concession_reason);
      setConcessionNotes(active.concession_notes ?? "");
      setExpiresOn(active.concession_expires_on ?? "");
      setNotes(active.notes ?? "");
      return;
    }

    setRoomClass("private");
    setEffectiveDate(resident.rate_effective_date ?? todayIso());
    setNegotiatedBase(centsToInput(resident.monthly_base_rate ?? resident.monthly_total_rate));
    setCareMode(resident.monthly_care_surcharge && resident.monthly_care_surcharge > 0 ? "flat" : "standard");
    setNegotiatedCare(centsToInput(resident.monthly_care_surcharge));
    setNegotiatedTotal(centsToInput(resident.monthly_total_rate));
    setConcessionReason(resident.monthly_total_rate ? "legacy_rate_lock" : "none");
    setConcessionNotes(resident.monthly_total_rate ? "Imported from current Homewood A/R monthly rent." : "");
    setExpiresOn("");
    setNotes("");
  }, [agreements, resident]);

  async function saveMedicaidFields(payerId: string, rateUnit: string, providerId: string | null) {
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("resident_payers" as never)
        .update({ medicaid_rate_unit: rateUnit, facility_medicaid_provider_id: providerId || null } as never)
        .eq("id", payerId);
      if (updateError) throw updateError;
      setMessage("Medicaid payer details saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Medicaid payer details.");
    }
  }

  async function saveAgreement() {
    if (!resident || !rateSchedule || saving) return;
    const base = dollarsToCents(negotiatedBase);
    const care = negotiatedCare.trim() ? dollarsToCents(negotiatedCare) : null;
    const total = dollarsToCents(negotiatedTotal);
    if (base == null) {
      setError("Enter a valid negotiated base rent.");
      return;
    }
    if (careMode === "flat" && care == null) {
      setError("Enter a valid flat care surcharge or choose another care mode.");
      return;
    }
    if (total == null) {
      setError("Enter a valid actual monthly invoice amount.");
      return;
    }
    if (standardTotal > total && concessionReason === "none") {
      setError("Choose a concession reason when the actual amount is below the posted standard.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const concession = standardTotal - total;
      const { error: saveError } = await supabase.rpc("haven_replace_active_resident_rate_agreement" as never, {
        p_resident_id: resident.id,
        p_facility_id: resident.facility_id,
        p_organization_id: resident.organization_id,
        p_effective_date: effectiveDate,
        p_rate_schedule_id: rateSchedule.id,
        p_room_class: roomClass,
        p_standard_base_rate_at_signing: standardBase,
        p_standard_care_surcharge_at_signing: standardCare,
        p_standard_monthly_total_at_signing: standardTotal,
        p_negotiated_base_rate: base,
        p_care_charge_mode: careMode,
        p_negotiated_care_surcharge: careMode === "flat" ? care : null,
        p_negotiated_monthly_total: total,
        p_concession_amount_at_signing: concession,
        p_concession_pct_at_signing: Number(concessionPct.toFixed(2)),
        p_concession_reason: concessionReason,
        p_concession_notes: concessionNotes.trim() || null,
        p_concession_expires_on: expiresOn || null,
        p_notes: notes.trim() || null,
      } as never);
      if (saveError) throw saveError;
      setMessage("Negotiated billing terms saved and activated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save billing terms.");
    } finally {
      setSaving(false);
    }
  }

  if (!residentId || notFound) {
    return (
      <div className="space-y-6 p-1">
        <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm">
          <div className="mb-4 border-b border-slate-200 dark:border-white/5 pb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Resident not found</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Check the ID or facility selector.</p>
          </div>
          <Link href="/admin/residents" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Back to residents
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-1">
        <AdminTableLoadingState />
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 rounded-[3rem] bg-gradient-to-b from-amber-500/10 via-transparent to-transparent blur-3xl" aria-hidden />
      <div className="relative z-10 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
            <Link
              href={`/admin/residents/${residentId}`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO PROFILE
            </Link>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Billing <span className="font-semibold text-brand-600 dark:text-brand-400 opacity-60 ml-2">/ {residentName}</span>
            </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-3xl">
              Payers, invoices, and resident-specific negotiated billing terms. Posted Homewood rates stay unchanged; actual rent lives here.
            </p>
          </div>
        </header>

        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</div> : null}
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">{error}</div> : null}

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-emerald-500/20 bg-emerald-50/30 dark:border-emerald-500/10 dark:bg-emerald-900/10 backdrop-blur-3xl shadow-sm">
            <div className="mb-6 border-b border-emerald-500/20 pb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                  <BadgeDollarSign className="h-5 w-5 text-emerald-500" /> Negotiated Billing Terms
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Save the resident&apos;s actual monthly rent while preserving the posted standard rate for concession reporting.
                </p>
              </div>
              <Badge className="w-fit uppercase tracking-widest text-[10px]">
                {currentAgreement ? `Agreement v${currentAgreement.version}` : resident?.monthly_total_rate ? "Imported A/R baseline" : "Needs terms"}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-3 mb-6">
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-black/20">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Posted standard</p>
                <p className="mt-2 text-2xl font-display text-slate-900 dark:text-white">{billingCurrency.format(standardTotal / 100)}</p>
                <p className="text-xs text-slate-500 mt-1">{roomClass === "companion" ? "Companion" : roomClass === "other" ? "Other" : "Private"} + current acuity</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-black/20">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Actual monthly rent</p>
                <p className="mt-2 text-2xl font-display text-emerald-600 dark:text-emerald-400">{billingCurrency.format(negotiatedTotalCents / 100)}</p>
                <p className="text-xs text-slate-500 mt-1">Used for future invoices</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-black/20">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Monthly concession</p>
                <p className={cn("mt-2 text-2xl font-display", concessionCents >= 0 ? "text-amber-600 dark:text-amber-400" : "text-indigo-600 dark:text-indigo-400")}>{billingCurrency.format(concessionCents / 100)}</p>
                <p className="text-xs text-slate-500 mt-1">{concessionPct.toFixed(1)}% vs posted</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Room class</span>
                <select value={roomClass} onChange={(event) => setRoomClass(event.target.value as "private" | "companion" | "other")} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                  <option value="private">Private</option>
                  <option value="companion">Companion / shared</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Effective date</span>
                <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Negotiated base rent</span>
                <input inputMode="decimal" value={negotiatedBase} onChange={(event) => setNegotiatedBase(event.target.value)} placeholder="4800.00" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Actual monthly invoice amount</span>
                <input inputMode="decimal" value={negotiatedTotal} onChange={(event) => setNegotiatedTotal(event.target.value)} placeholder="4800.00" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Care charge mode</span>
                <select value={careMode} onChange={(event) => setCareMode(event.target.value as "standard" | "flat" | "bundled" | "waived")} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                  <option value="standard">Use posted acuity surcharge</option>
                  <option value="flat">Flat negotiated care amount</option>
                  <option value="bundled">Bundled in rent</option>
                  <option value="waived">Waived</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Flat care amount</span>
                <input inputMode="decimal" value={negotiatedCare} onChange={(event) => setNegotiatedCare(event.target.value)} disabled={careMode !== "flat"} placeholder="0.00" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Concession reason</span>
                <select value={concessionReason} onChange={(event) => setConcessionReason(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                  {CONCESSION_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span className="text-xs uppercase tracking-widest text-slate-500">Concession expires</span>
                <input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="space-y-1.5 text-sm font-medium md:col-span-2">
                <span className="text-xs uppercase tracking-widest text-slate-500">Concession notes</span>
                <textarea value={concessionNotes} onChange={(event) => setConcessionNotes(event.target.value)} rows={2} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
              <label className="space-y-1.5 text-sm font-medium md:col-span-2">
                <span className="text-xs uppercase tracking-widest text-slate-500">Internal agreement notes</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </label>
            </div>

            <div className="mt-6 flex justify-end">
              <Button type="button" onClick={() => void saveAgreement()} disabled={saving || !rateSchedule} className="gap-2 rounded-full px-6">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save negotiated terms
              </Button>
            </div>
          </section>

          <section className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-brand-500" /> Payers on File
              </h3>
              <p className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">Primary and secondary coverage</p>
            </div>
            {payers.length === 0 ? (
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 py-4">No payer records returned.</p>
            ) : (
              <MotionList className="space-y-4">
                {payers.map((p) => (
                  <MotionItem key={p.id}>
                    <div className="rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <PayerTypeBadge payerType={mapDbPayerTypeToUi(p.payer_type)} />
                        {p.is_primary ? <Badge variant="outline">Primary</Badge> : null}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{p.payer_name?.trim() || "Responsible party"}</p>
                        <p className="text-xs text-slate-500 mt-1">Effective {formatDate(p.effective_date)}{p.end_date ? ` — ${formatDate(p.end_date)}` : " — current"}</p>
                      </div>
                      {mapDbPayerTypeToUi(p.payer_type) === "medicaid" ? (
                        <div className="grid gap-3 border-t border-slate-100 pt-3 dark:border-white/5 sm:grid-cols-2">
                          <label className="space-y-1.5 text-xs font-medium uppercase tracking-widest text-slate-500">
                            Provider / MCO
                            <select
                              value={p.facility_medicaid_provider_id ?? ""}
                              onChange={(event) => {
                                const providerId = event.target.value || null;
                                const provider = providers.find((item) => item.id === providerId);
                                const rateUnit = provider?.rate_unit ?? p.medicaid_rate_unit ?? "monthly";
                                void saveMedicaidFields(p.id, rateUnit, providerId);
                              }}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 normal-case tracking-normal dark:border-slate-700 dark:bg-slate-900"
                            >
                              <option value="">Select provider/MCO</option>
                              {providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.provider_name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1.5 text-xs font-medium uppercase tracking-widest text-slate-500">
                            Medicaid rate unit
                            <select
                              value={p.medicaid_rate_unit ?? "monthly"}
                              onChange={(event) => void saveMedicaidFields(p.id, event.target.value, p.facility_medicaid_provider_id)}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 normal-case tracking-normal dark:border-slate-700 dark:bg-slate-900"
                            >
                              <option value="monthly">Monthly</option>
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="per_billable_day">Per Billable Day</option>
                            </select>
                          </label>
                          <p className="text-xs text-slate-500 sm:col-span-2">
                            Current: {providers.find((item) => item.id === p.facility_medicaid_provider_id)?.provider_name ?? "—"} · {formatRateUnitLabel(p.medicaid_rate_unit)}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </MotionItem>
                ))}
              </MotionList>
            )}
          </section>
        </div>

        {agreements.length > 0 ? (
          <section className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4">
              <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Agreement History</h3>
              <p className="text-sm text-slate-500 mt-1">Effective-dated versions are kept for audit and reporting.</p>
            </div>
            <MotionList className="space-y-3">
              {agreements.map((agreement) => (
                <MotionItem key={agreement.id}>
                  <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03] md:grid-cols-5 md:items-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Version</p>
                      <p className="font-semibold">v{agreement.version} · {agreement.status}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Effective</p>
                      <p className="font-mono text-sm">{formatDate(agreement.effective_date)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Actual</p>
                      <p className="font-mono text-sm">{billingCurrency.format(agreement.negotiated_monthly_total / 100)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Concession</p>
                      <p className="font-mono text-sm">{billingCurrency.format(agreement.concession_amount_at_signing / 100)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Reason</p>
                      <p className="text-sm">{reasonLabel(agreement.concession_reason)}</p>
                    </div>
                  </div>
                </MotionItem>
              ))}
            </MotionList>
          </section>
        ) : null}

        <BillingInvoiceLedger
          title="Invoices"
          cardTitle="Resident invoices"
          cardDescription="Scoped to this resident; facility filter still applies when set."
          residentIdFilter={residentId}
        />
      </div>
    </div>
  );
}
