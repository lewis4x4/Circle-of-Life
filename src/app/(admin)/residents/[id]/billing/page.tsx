"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CreditCard } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatColLabel } from "@/lib/col-labels";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

import { BillingInvoiceLedger, PayerTypeBadge, mapDbPayerTypeToUi } from "../../../billing/billing-invoice-ledger";

type SupabaseResident = {
  id: string;
  organization_id: string;
  facility_id: string;
  first_name: string | null;
  last_name: string | null;
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

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
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

  const [residentName, setResidentName] = useState("");
  const [residentOrganizationId, setResidentOrganizationId] = useState("");
  const [residentFacilityId, setResidentFacilityId] = useState("");
  const [payers, setPayers] = useState<SupabasePayer[]>([]);
  const [providers, setProviders] = useState<MedicaidProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [savingPayerId, setSavingPayerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!residentId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setNotFound(false);
    try {
      const supabase = createClient();
      const res = (await supabase
        .from("residents" as never)
        .select("id, organization_id, facility_id, first_name, last_name, deleted_at")
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
      setResidentName(`${fn} ${ln}`.trim() || "Resident");
      setResidentOrganizationId(r.organization_id);
      setResidentFacilityId(r.facility_id);

      const [payRes, providerRes] = await Promise.all([
        supabase
          .from("resident_payers" as never)
          .select("id, payer_type, is_primary, payer_name, effective_date, end_date, medicaid_rate_unit, facility_medicaid_provider_id, deleted_at")
          .eq("resident_id", residentId)
          .is("deleted_at", null)
          .order("effective_date", { ascending: false }),
        supabase
          .from("facility_medicaid_providers" as never)
          .select("id, provider_name, rate_unit")
          .eq("facility_id", r.facility_id)
          .is("deleted_at", null)
          .eq("active", true)
          .order("provider_name", { ascending: true }),
      ]);
      const payList = payRes as unknown as QueryListResult<SupabasePayer>;
      if (payList.error) throw payList.error;
      const providerList = providerRes as unknown as QueryListResult<MedicaidProvider>;
      if (providerList.error) throw providerList.error;
      setPayers(payList.data ?? []);
      setProviders(providerList.data ?? []);
    } catch {
      setNotFound(true);
      setPayers([]);
      setProviders([]);
    } finally {
      setIsLoading(false);
    }
  }, [residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMedicaidFields(payerId: string, rateUnit: string, providerId: string | null) {
    setSavingPayerId(payerId);
    setActionError(null);
    setActionMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("resident_payers" as never)
        .update({ medicaid_rate_unit: rateUnit, facility_medicaid_provider_id: providerId || null } as never)
        .eq("id", payerId)
        .eq("resident_id", residentId);
      if (error) throw error;
      setActionMessage("Medicaid payer details saved.");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save Medicaid payer details.");
    } finally {
      setSavingPayerId(null);
    }
  }

  async function addMedicaidPayer() {
    setSavingPayerId("new");
    setActionError(null);
    setActionMessage(null);
    try {
      const supabase = createClient();
      const provider = providers[0] ?? null;
      const { error } = await supabase.from("resident_payers" as never).insert({
        resident_id: residentId,
        organization_id: residentOrganizationId,
        facility_id: residentFacilityId,
        payer_type: "medicaid_oss",
        payer_name: provider?.provider_name ?? "Medicaid",
        effective_date: new Date().toISOString().slice(0, 10),
        medicaid_rate_unit: provider?.rate_unit ?? "monthly",
        facility_medicaid_provider_id: provider?.id ?? null,
      } as never);
      if (error) throw error;
      setActionMessage("Medicaid payer row added.");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not add Medicaid payer row.");
    } finally {
      setSavingPayerId(null);
    }
  }

  if (!residentId || notFound) {
    return (
      <div className="space-y-6 p-1">
        <div className="p-6 sm:p-8 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 shadow-sm">
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
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
          <div className="space-y-3">
             <Link
               href={`/admin/residents/${residentId}`}
               className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
             >
                 <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO PROFILE
             </Link>
             <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Billing <span className="font-semibold text-brand-600 dark:text-brand-400 opacity-60 ml-2">/ {residentName}</span>
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Invoices and payer coverage records.
            </p>
          </div>
        </header>

      <header>
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Billing
        </h2>
        <p className="mt-1 text-slate-500 dark:text-slate-400">Invoices and payer coverage for this resident.</p>
      </header>

        <div className="p-6 sm:p-8 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 shadow-sm relative overflow-hidden transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-brand-500" />
              Payers on File
            </h3>
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-mono tracking-wider text-slate-400 mt-1 uppercase">
                Primary and secondary coverage
              </p>
              <button
                type="button"
                onClick={() => void addMedicaidPayer()}
                disabled={savingPayerId === "new" || !residentOrganizationId || !residentFacilityId}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingPayerId === "new" ? "Adding…" : "+ Medicaid payer"}
              </button>
            </div>
          </div>
          {actionError ? <p className="mb-4 text-sm text-rose-600 dark:text-rose-400">{actionError}</p> : null}
          {actionMessage ? <p className="mb-4 text-sm text-emerald-700 dark:text-emerald-300">{actionMessage}</p> : null}
          
          <div className="relative z-10 w-full overflow-hidden">
            {payers.length === 0 ? (
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 py-4">No payer records returned.</p>
            ) : (
              <>
                 <div className="hidden lg:grid grid-cols-[1fr_2fr_1fr_1fr_1fr_2fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                   <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Type</div>
                   <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Name</div>
                   <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Effective</div>
                   <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">End</div>
                   <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mt-0.5">Role</div>
                   <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">Medicaid details</div>
                 </div>
                 
                 <div className="space-y-4 mt-6 relative z-10">
                   <MotionList className="space-y-4">
                     {payers.map((p) => (
                       <MotionItem key={p.id}>
                         <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr_1fr_1fr_1fr_2fr] gap-4 lg:items-center p-6 rounded-lg bg-white border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none">
                           
                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Type</span>
                             <div className="flex items-start"><PayerTypeBadge payerType={mapDbPayerTypeToUi(p.payer_type)} /></div>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Name</span>
                             <span className="font-semibold text-lg text-slate-900 dark:text-slate-100 tracking-tight">{p.payer_name?.trim() || "—"}</span>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Effective</span>
                             <span className="font-mono text-sm text-slate-600 dark:text-slate-400">{formatDate(p.effective_date)}</span>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">End</span>
                             <span className="font-mono text-sm text-slate-600 dark:text-slate-400">{p.end_date ? formatDate(p.end_date) : "—"}</span>
                           </div>

                           <div className="flex flex-col items-start lg:items-start">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Role</span>
                             {p.is_primary ? (
                               <div className="inline-flex px-3 py-1 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 rounded-[1rem] font-bold text-[10px] uppercase tracking-wider">
                                 Primary
                               </div>
                             ) : (
                               <span className="text-slate-400">—</span>
                             )}
                           </div>

                           <div className="flex flex-col gap-2">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-wider font-bold mb-1">Medicaid details</span>
                             {mapDbPayerTypeToUi(p.payer_type) === "medicaid" ? (
                               <div className="space-y-2">
                                 <div className="grid gap-2 sm:grid-cols-2">
                                   <select
                                     value={p.facility_medicaid_provider_id ?? ""}
                                     onChange={(event) => {
                                       const providerId = event.target.value || null;
                                       const provider = providers.find((item) => item.id === providerId);
                                       const rateUnit = provider?.rate_unit ?? p.medicaid_rate_unit ?? "monthly";
                                       void saveMedicaidFields(p.id, rateUnit, providerId);
                                     }}
                                     className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                                   >
                                     <option value="">Select provider/MCO</option>
                                     {providers.map((provider) => (
                                       <option key={provider.id} value={provider.id}>
                                         {provider.provider_name}
                                       </option>
                                     ))}
                                   </select>
                                   <select
                                     value={p.medicaid_rate_unit ?? "monthly"}
                                     onChange={(event) => void saveMedicaidFields(p.id, event.target.value, p.facility_medicaid_provider_id)}
                                     className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                                   >
                                     <option value="monthly">Monthly</option>
                                     <option value="daily">Daily</option>
                                     <option value="weekly">Weekly</option>
                                     <option value="per_billable_day">Per Billable Day</option>
                                   </select>
                                 </div>
                                 <p className="text-xs text-slate-500">
                                   Current: {providers.find((item) => item.id === p.facility_medicaid_provider_id)?.provider_name ?? "—"} · {formatRateUnitLabel(p.medicaid_rate_unit)}
                                 </p>
                                 {savingPayerId === p.id ? <p className="text-xs text-slate-400">Saving…</p> : null}
                               </div>
                             ) : (
                               <span className="text-slate-400">—</span>
                             )}
                           </div>

                         </div>
                       </MotionItem>
                     ))}
                   </MotionList>
                 </div>
              </>
            )}
          </div>
        </div>

        <BillingInvoiceLedger
          title="Invoices"
          description={`Open and historical invoices for ${residentName}.`}
          cardTitle="Resident invoices"
          cardDescription="Scoped to this resident; facility filter still applies when set."
          residentIdFilter={residentId}
        />
      </div>
    </div>
  );
}
