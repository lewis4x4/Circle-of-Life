"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  formatInsuranceClaimDateOfLoss,
  formatInsuranceClaimNumber,
} from "@/lib/insurance/claims-display-copy";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import {
  INSURANCE_CLAIMS_LIST_SELECT,
  INSURANCE_HUB_LIST_LIMIT,
} from "@/lib/admin/hub-list-limits";
import type { Database } from "@/types/database";

type Row = Database["public"]["Tables"]["insurance_claims"]["Row"];

export default function InsuranceClaimsPage() {
  const supabase = createClient();
  const { organizationId, loading: authLoading } = useHavenAuth();

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["insurance", "claims", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("insurance_claims")
        .select(INSURANCE_CLAIMS_LIST_SELECT)
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("date_of_loss", { ascending: false })
        .limit(INSURANCE_HUB_LIST_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const loading = authLoading || isPending;
  const loadError =
    !authLoading && !organizationId
      ? "Organization missing on profile."
      : error
        ? error.message
        : null;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      
      <div className="relative z-10 space-y-6 w-full">
        <InsuranceHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Insurance Claims {rows.some(r => r.status !== "closed") && <></>}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Corporate GL claims; optional link to incidents when applicable.
            </p>
          </div>
        </header>

        {loadError && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {loadError}
          </p>
        )}

        <div className="p-6 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
           <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-white/5 pl-2">
             <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
               Claim Log
             </h3>
             <span className="text-xs font-medium text-slate-500">{loading ? "Loading…" : `${rows.length} claims`}</span>
           </div>

           <MotionList className="space-y-3">
             {loading ? (
               <p className="text-sm font-mono text-slate-500 pl-2">Loading claims…</p>
             ) : rows.length === 0 ? (
               <div className="p-12 text-center text-slate-500 bg-white/50 rounded-lg border border-dashed border-slate-200 dark:border-white/10 ">
                  <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Claims</p>
                 <p className="text-sm opacity-80 mt-1">No insurance claims have been tracked yet.</p>
               </div>
             ) : (
               rows.map((r) => {
                 const isOpen = r.status !== "closed";
                 const formattedDate = formatInsuranceClaimDateOfLoss(r.date_of_loss);

                 return (
                   <MotionItem
                     key={r.id}
                     className={cn(
                       "p-5 rounded-lg border shadow-sm flex flex-col sm:flex-row gap-4 sm:items-center justify-between group overflow-hidden relative transition-colors",
                       isOpen 
                         ? "border-red-200/80 bg-white dark:border-red-900/30 dark:bg-red-950/20 hover:border-red-300 dark:hover:border-red-800/40"
                         : "border-slate-200/80 bg-white dark:border-white/5 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20"
                     )}
                   >
                     {isOpen && <div className="absolute left-0 top-0 w-1.5 h-full bg-red-500" />}
                     <div className="flex-1 min-w-0 pl-1">
                       <div className="flex items-center gap-3 mb-1">
                         <span className={cn(
                           "text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border",
                           isOpen 
                             ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20" 
                             : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10"
                         )}>
                           {r.status.replace(/_/g, " ")}
                         </span>
                         <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                           Loss: <span className="normal-case">{formattedDate}</span>
                         </span>
                         {r.incident_id && (
                           <Link href={`/admin/incidents/${r.incident_id}`} className="text-[10px] font-bold text-primary-500 hover:text-primary-600 flex items-center gap-1">
                             Incident linked ↗
                           </Link>
                         )}
                       </div>
                       <div className="flex gap-6 mt-3">
                         <div>
                            <p className="text-[10px] font-mono tracking-wider uppercase text-slate-400 mb-0.5">Reserve</p>
                            <p className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatUsdFromCents(r.reserve_cents)}</p>
                         </div>
                         <div>
                            <p className="text-[10px] font-mono tracking-wider uppercase text-slate-400 mb-0.5">Paid</p>
                            <p className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatUsdFromCents(r.paid_cents)}</p>
                         </div>
                         <div className="flex-1">
                            <p className="text-[10px] font-mono tracking-wider uppercase text-slate-400 mb-0.5">Claim #</p>
                            <p className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatInsuranceClaimNumber(r.claim_number)}</p>
                         </div>
                       </div>
                     </div>
                     <div className="shrink-0 flex items-center gap-3 pl-1 sm:pl-0">
                       <Link
                         href={`/admin/insurance/claims/${r.id}`}
                         className={cn(
                           buttonVariants({ variant: "outline", size: "sm" }),
                           "h-10 rounded-full px-5 font-bold text-[10px] bg-white dark:bg-white/5 dark:border-white/10"
                         )}
                       >
                         Manage Claim
                       </Link>
                     </div>
                   </MotionItem>
                 );
               })
             )}
           </MotionList>
        </div>
      </div>
    </div>
  );
}
