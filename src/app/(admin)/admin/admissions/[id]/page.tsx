"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, FileText, Loader2, UserPlus } from "lucide-react";

import { AdmissionsHubNav } from "../admissions-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

type CaseDetail = Database["public"]["Tables"]["admission_cases"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
  referral_leads: { first_name: string; last_name: string } | null;
  beds: { bed_label: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function formatTs(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function admissionReadinessChecklist(
  row: CaseDetail,
  rateTerms: Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][],
) {
  return [
    {
      key: "financial",
      label: "Financial clearance recorded",
      passed: Boolean(row.financial_clearance_at),
    },
    {
      key: "orders",
      label: "Physician orders received",
      passed: Boolean(row.physician_orders_received_at),
    },
    {
      key: "bed",
      label: "Bed assigned or reserved",
      passed: Boolean(row.bed_id),
    },
    {
      key: "move_in_date",
      label: "Target move-in date set",
      passed: Boolean(row.target_move_in_date),
    },
    {
      key: "rate_terms",
      label: "Rate terms recorded",
      passed: rateTerms.length > 0,
    },
  ];
}

export default function AdminAdmissionCaseDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [rateTerms, setRateTerms] = useState<Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][]>([]);

  const load = useCallback(async () => {
    if (!id) {
      setRow(null);
      setRateTerms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [{ data: c, error: cErr }, { data: rt }] = await Promise.all([
      supabase
        .from("admission_cases")
        .select("*, residents(first_name, last_name), referral_leads(first_name, last_name), beds(bed_label)")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase.from("admission_case_rate_terms").select("*").eq("admission_case_id", id),
    ]);

    if (cErr) {
      setError(cErr.message);
      setRow(null);
      setRateTerms([]);
    } else {
      setRow(c as CaseDetail | null);
      setRateTerms((rt ?? []) as Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][]);
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const wrongFacility =
    row &&
    selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    row.facility_id !== selectedFacilityId;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <AdmissionsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <Link
               href="/admin/admissions"
               className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
             >
                 <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO ADMISSIONS
             </Link>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Admission Case
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Read-only view; status transitions and rate quotes can ship in a follow-up.
            </p>
          </div>
          <div>
            {row?.resident_id && (
              <Link
                href={`/admin/residents/${row.resident_id}`}
                className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-brand-600 hover:bg-brand-700 text-white shadow-lg flex items-center gap-2")}
              >
                Resident Profile
              </Link>
            )}
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center p-12 text-sm text-slate-500 font-medium bg-white/50 dark:bg-white/5 rounded-[2.5rem] border border-slate-200/50 dark:border-white/10 backdrop-blur-3xl">
             <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Case...
          </div>
        ) : error ? (
           <div className="p-6 rounded-[2.5rem] bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 font-medium">
              {error}
           </div>
        ) : !row ? (
          <div className="flex items-center justify-center p-12 text-center text-sm text-slate-500 bg-white/50 dark:bg-white/5 rounded-[2.5rem] border border-slate-200/50 dark:border-white/10 backdrop-blur-3xl">
            No case found for this id, or you do not have access.
          </div>
        ) : (
          <>
            {wrongFacility && (
              <div className="p-6 rounded-[2.5rem] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 font-medium text-sm">
                This case belongs to another facility. Switch the facility in the header to match.
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all h-fit">
                <div className="mb-8 border-b border-slate-200 dark:border-white/5 pb-4 flex flex-col gap-2">
                   <h3 className="text-2xl font-display font-semibold text-slate-900 dark:text-white flex items-center gap-3">
                     <UserPlus className="h-6 w-6 text-brand-500" />
                     {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Resident"}
                   </h3>
                   <p className="font-mono text-xs break-all text-slate-500 dark:text-slate-400">{row.id}</p>
                </div>
                
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Status</dt>
                    <dd className="text-base font-semibold text-slate-900 dark:text-slate-100 capitalize">{formatStatus(row.status)}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Target Move-In</dt>
                    <dd className="text-base font-semibold text-slate-900 dark:text-slate-100">{row.target_move_in_date ?? "—"}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Referral Lead</dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {row.referral_leads ? `${row.referral_leads.first_name} ${row.referral_leads.last_name}` : "—"}
                    </dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Bed</dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.beds?.bed_label ?? "—"}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Financial Clearance</dt>
                    <dd className="text-sm font-mono text-slate-900 dark:text-slate-300">{formatTs(row.financial_clearance_at)}</dd>
                  </div>
                  <div className="bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Physician Orders</dt>
                    <dd className="text-sm font-mono text-slate-900 dark:text-slate-300">{formatTs(row.physician_orders_received_at)}</dd>
                  </div>
                  <div className="sm:col-span-2 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Physician Orders Summary</dt>
                    <dd className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{row.physician_orders_summary ?? "—"}</dd>
                  </div>
                  <div className="sm:col-span-2 bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Notes</dt>
                    <dd className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{row.notes ?? "—"}</dd>
                  </div>
                  <div className="sm:col-span-2 flex items-center justify-end text-[10px] text-slate-400 uppercase tracking-widest font-mono mt-2">
                    Updated: {formatTs(row.updated_at)}
                  </div>
                </dl>
              </div>

              <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 backdrop-blur-3xl shadow-sm relative overflow-hidden h-fit">
                <div className="mb-6 border-b border-amber-200/70 dark:border-amber-900/40 pb-4 flex items-center justify-between">
                  <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white">Move-In Readiness</h3>
                  <span className="text-[10px] font-mono tracking-widest text-amber-700 dark:text-amber-300 uppercase">Operational checklist</span>
                </div>
                <div className="space-y-3">
                  {admissionReadinessChecklist(row, rateTerms).map((item) => (
                    <div key={item.key} className="rounded-2xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</span>
                      <span className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest",
                        item.passed
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                      )}>
                        {item.passed ? "Complete" : "Missing"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-2xl border border-slate-200/70 dark:border-white/5 bg-white/80 dark:bg-black/20 p-4">
                  <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500 mb-2">Next actions</p>
                  <ul className="list-inside list-disc space-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {!row.financial_clearance_at ? <li>Record financial clearance before move-in.</li> : null}
                    {!row.physician_orders_received_at ? <li>Capture physician orders receipt before move-in.</li> : null}
                    {!row.bed_id ? <li>Reserve or assign a bed.</li> : null}
                    {!row.target_move_in_date ? <li>Set a target move-in date.</li> : null}
                    {rateTerms.length === 0 ? <li>Add quoted rate terms for the admission package.</li> : null}
                    {row.financial_clearance_at && row.physician_orders_received_at && row.bed_id && row.target_move_in_date && rateTerms.length > 0 ? (
                      <li>Core readiness items are in place. Advance this case through the move-in workflow.</li>
                    ) : null}
                  </ul>
                </div>
              </div>

              <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative h-fit">
                <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
                  <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2">
                     <FileText className="h-5 w-5 text-indigo-500" /> Quoted Rate Terms
                  </h3>
                  <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Saved in admission_case_rate_terms</p>
                </div>

                <div className="relative z-10 w-full overflow-hidden">
                   {rateTerms.length === 0 ? (
                     <p className="text-sm text-slate-500 dark:text-slate-400 py-4 font-medium px-2">No rate quotes recorded.</p>
                   ) : (
                     <>
                        <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Accommodation</div>
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Base (¢)</div>
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Care (¢)</div>
                           <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Effective</div>
                        </div>

                        <div className="space-y-3 mt-6 relative z-10">
                           <MotionList className="space-y-3">
                              {rateTerms.map((t) => (
                                 <MotionItem key={t.id}>
                                    <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1.5fr] gap-4 sm:items-center p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 w-full outline-none">
                                      <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Accommodation</span>
                                         <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight leading-tight capitalize">{t.accommodation_type.replace("_", " ")}</span>
                                      </div>
                                      <div className="flex flex-col sm:items-end">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Base (¢)</span>
                                         <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{t.quoted_base_rate_cents}</span>
                                      </div>
                                      <div className="flex flex-col sm:items-end">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Care (¢)</span>
                                         <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{t.quoted_care_surcharge_cents}</span>
                                      </div>
                                      <div className="flex flex-col">
                                         <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Effective</span>
                                         <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-slate-400" /> {t.effective_date ?? "—"}</span>
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
