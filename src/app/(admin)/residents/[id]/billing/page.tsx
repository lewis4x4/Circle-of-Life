"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CreditCard } from "lucide-react";

import { AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

import { BillingInvoiceLedger, PayerTypeBadge, mapDbPayerTypeToUi } from "../../../billing/billing-invoice-ledger";

type SupabaseResident = {
  id: string;
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
  deleted_at: string | null;
};

type QueryResult<T> = { data: T | null; error: { message: string } | null };
type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function ResidentBillingPage() {
  const params = useParams();
  const rawId = typeof params?.id === "string" ? params.id : "";
  const residentId = UUID_STRING_RE.test(rawId) ? rawId : "";
  const { selectedFacilityId } = useFacilityStore();

  const [residentName, setResidentName] = useState("");
  const [payers, setPayers] = useState<SupabasePayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
        .select("id, facility_id, first_name, last_name, deleted_at")
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

      const payRes = (await supabase
        .from("resident_payers" as never)
        .select("id, payer_type, is_primary, payer_name, effective_date, end_date, deleted_at")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .order("effective_date", { ascending: false })) as unknown as QueryListResult<SupabasePayer>;
      if (payRes.error) throw payRes.error;
      setPayers(payRes.data ?? []);
    } catch {
      setNotFound(true);
      setPayers([]);
    } finally {
      setIsLoading(false);
    }
  }, [residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      <AmbientMatrix />
      
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
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Invoices and payer coverage records.
            </p>
          </div>
        </header>

      <header>
        <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Billing
        </h2>
        <p className="mt-1 text-slate-500 dark:text-slate-400">Invoices and payer coverage for this resident.</p>
      </header>

        <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-brand-500" />
              Payers on File
            </h3>
            <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
              Primary and secondary coverage
            </p>
          </div>
          
          <div className="relative z-10 w-full overflow-hidden">
            {payers.length === 0 ? (
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 py-4">No payer records returned.</p>
            ) : (
              <>
                 <div className="hidden lg:grid grid-cols-[1fr_2fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Type</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Name</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Effective</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">End</div>
                   <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 mt-0.5">Role</div>
                 </div>
                 
                 <div className="space-y-4 mt-6 relative z-10">
                   <MotionList className="space-y-4">
                     {payers.map((p) => (
                       <MotionItem key={p.id}>
                         <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr_1fr_1fr_1fr] gap-4 lg:items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg dark:hover:bg-white/[0.05] transition-all duration-300 w-full outline-none">
                           
                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Type</span>
                             <div className="flex items-start"><PayerTypeBadge payerType={mapDbPayerTypeToUi(p.payer_type)} /></div>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Name</span>
                             <span className="font-semibold text-lg text-slate-900 dark:text-slate-100 tracking-tight">{p.payer_name?.trim() || "—"}</span>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Effective</span>
                             <span className="font-mono text-sm text-slate-600 dark:text-slate-400">{formatDate(p.effective_date)}</span>
                           </div>

                           <div className="flex flex-col">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">End</span>
                             <span className="font-mono text-sm text-slate-600 dark:text-slate-400">{p.end_date ? formatDate(p.end_date) : "—"}</span>
                           </div>

                           <div className="flex flex-col items-start lg:items-start">
                             <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Role</span>
                             {p.is_primary ? (
                               <div className="inline-flex px-3 py-1 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 rounded-[1rem] font-bold text-[10px] uppercase tracking-widest">
                                 Primary
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
