"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, ArrowLeft, Brain, CalendarClock, ClipboardList, Sparkles } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

const STATUS_RANK: Record<string, number> = {
  active: 0,
  under_review: 1,
  draft: 2,
  archived: 3,
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

type ResidentMini = {
  id: string;
  facility_id: string;
  first_name: string | null;
  last_name: string | null;
};

type CarePlanRow = {
  id: string;
  version: number | null;
  status: string | null;
  effective_date: string | null;
  review_due_date: string | null;
  notes: string | null;
  updated_at: string | null;
};

type CarePlanItemRow = {
  id: string;
  category: string | null;
  title: string | null;
  description: string | null;
  assistance_level: string | null;
  frequency: string | null;
  special_instructions: string | null;
  goal: string | null;
  interventions: string[] | null;
  sort_order: number | null;
};

type LoadedState = {
  residentName: string;
  plan: CarePlanRow | null;
  items: CarePlanItemRow[];
};

export default function AdminResidentCarePlanPage() {
  const params = useParams();
  const rawId = params?.id;
  const residentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [noPlan, setNoPlan] = useState(false);
  const [loaded, setLoaded] = useState<LoadedState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setNoPlan(false);
    setLoaded(null);

    if (!residentId || !UUID_STRING_RE.test(residentId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      const resResult = (await supabase
        .from("residents" as never)
        .select("id, facility_id, first_name, last_name")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<ResidentMini>;

      if (resResult.error) throw resResult.error;
      const resident = resResult.data;
      if (!resident) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      if (isValidFacilityIdForQuery(selectedFacilityId) && resident.facility_id !== selectedFacilityId) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const firstName = resident.first_name ?? "";
      const lastName = resident.last_name ?? "";
      const residentName = `${firstName} ${lastName}`.trim() || "Unknown Resident";

      const plansResult = (await supabase
        .from("care_plans" as never)
        .select("id, version, status, effective_date, review_due_date, notes, updated_at")
        .eq("resident_id", residentId)
        .is("deleted_at", null)) as unknown as QueryListResult<CarePlanRow>;

      if (plansResult.error) throw plansResult.error;
      const plans = plansResult.data ?? [];
      const plan = pickCarePlan(plans);

      if (!plan) {
        setNoPlan(true);
        setLoaded({ residentName, plan: null, items: [] });
        setLoading(false);
        return;
      }

      const itemsResult = (await supabase
        .from("care_plan_items" as never)
        .select(
          "id, category, title, description, assistance_level, frequency, special_instructions, goal, interventions, sort_order",
        )
        .eq("care_plan_id", plan.id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })) as unknown as QueryListResult<CarePlanItemRow>;

      if (itemsResult.error) throw itemsResult.error;
      const items = itemsResult.data ?? [];

      setLoaded({ residentName, plan, items });
    } catch {
      setError("Care plan data is unavailable. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [residentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedItems = useMemo(() => groupByCategory(loaded?.items ?? []), [loaded?.items]);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href={`/admin/residents/${residentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Resident profile
        </Link>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to census
        </Link>
        <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm">
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">Resident not found</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            This care plan route is tied to a resident record. Adjust your facility filter or return to the
            census list.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href={`/admin/residents/${residentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Resident profile
        </Link>
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!loaded) {
    return null;
  }

  const { residentName, plan, items } = loaded;
  const reviewState = plan?.review_due_date ? getReviewBadgeState(plan.review_due_date) : null;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <Link
               href={`/admin/residents/${residentId}`}
               className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
             >
                 <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO PROFILE
             </Link>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               Care Plan <span className="font-semibold text-brand-600 dark:text-brand-400 opacity-60 ml-2">/ {residentName}</span>
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               Structured needs and interventions mapped to ADLs and behavioral goals.
            </p>
          </div>
        </header>

        {noPlan || !plan?.id ? (
          <AdminEmptyState
            title="No care plan on file"
            description="When a plan is created in the clinical workflow, version, review dates, and line items will appear here."
          />
        ) : (
          <div className="space-y-6">
            
            <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
              <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                   <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Plan Configuration</h3>
                   <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">
                      Operational metadata
                   </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-2">
                  {plan?.status ? <CarePlanStatusBadge status={plan.status} /> : null}
                  {plan && plan.version != null && (
                    <Badge variant="outline" className="font-mono text-[10px] uppercase font-bold tracking-widest bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 px-3">
                      v{plan.version}
                    </Badge>
                  )}
                  {reviewState ? (
                    <Badge variant="outline" className={cn("font-mono text-[10px] uppercase font-bold tracking-widest px-3 border border-transparent", reviewState.className)}>
                      Review: {reviewState.label}
                    </Badge>
                  ) : null}
                </div>
              </div>
              
              <div className="grid gap-6 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                 <div className="bg-white dark:bg-slate-950/50 p-5 rounded-[1.5rem] border border-slate-200/90 dark:border-white/5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 mb-2">
                       <CalendarClock className="w-3.5 h-3.5" /> Effective Date
                    </p>
                    <p className="text-lg font-medium text-slate-900 dark:text-slate-100">
                       {formatDate(plan?.effective_date ?? null)}
                    </p>
                 </div>
                 <div className="bg-white dark:bg-slate-950/50 p-5 rounded-[1.5rem] border border-slate-200/90 dark:border-white/5 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 mb-2">
                       <CalendarClock className="w-3.5 h-3.5" /> Next Review
                    </p>
                    <p className="text-lg font-medium text-slate-900 dark:text-slate-100">
                       {formatDate(plan?.review_due_date ?? null)}
                    </p>
                 </div>
                 {plan?.notes ? (
                   <div className="sm:col-span-2 lg:col-span-3 bg-white dark:bg-slate-950/50 p-5 rounded-[1.5rem] border border-slate-200/90 dark:border-white/5 shadow-sm">
                     <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Documentation Notes</p>
                     <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{plan.notes}</p>
                   </div>
                 ) : null}
              </div>
            </div>

            {items.length === 0 ? (
              <AdminEmptyState
                title="No active interventions"
                description="Needs and interventions will list ADLs, safety measures, and other ordered protocols."
              />
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {Array.from(groupedItems.entries()).map(([category, rows]) => (
                  <div key={category} className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
                    
                    <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
                       <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-3">
                          <Activity className="w-5 h-5 text-brand-500" />
                          {formatCategoryLabel(category)}
                       </h3>
                       <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase font-bold">
                          {rows.length} Configured Rule{rows.length > 1 && "s"}
                       </p>
                    </div>

                    <div className="relative z-10 pt-2">
                       <MotionList className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {rows.map((row) => (
                             <MotionItem key={row.id}>
                                <div className="group flex flex-col h-full justify-between p-6 rounded-[1.5rem] border border-slate-200/90 bg-white dark:border-white/5 dark:bg-white/[0.03] shadow-sm transition-all outline-none relative overflow-hidden focus-within:ring-2 focus-within:ring-brand-500/50 hover:border-brand-300 dark:hover:border-brand-500/40 hover:shadow-md">
                                   <div className="space-y-4 relative z-10">
                                      <div className="flex items-start justify-between gap-3">
                                         <h4 className="font-semibold text-slate-900 dark:text-white leading-tight pr-4">
                                            {row.title ?? "—"}
                                         </h4>
                                         {row.assistance_level ? (
                                            <Badge className="bg-slate-100 text-slate-700 border-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold px-2.5 py-0.5 shadow-none whitespace-nowrap">
                                               {formatSnakeLabel(row.assistance_level)}
                                            </Badge>
                                         ) : null}
                                      </div>
                                      
                                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                         {row.description ?? "—"}
                                      </p>
                                      
                                      {row.frequency && (
                                         <div className="pt-2">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Frequency</span>
                                            <span className="text-sm font-mono bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded inline-block text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800">
                                               {row.frequency}
                                            </span>
                                         </div>
                                      )}

                                      {row.interventions?.length ? (
                                         <div className="pt-2">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Prescribed Interventions</span>
                                            <ul className="space-y-1.5 w-full">
                                               {row.interventions.filter(Boolean).map((iv) => (
                                                  <li key={iv} className="text-sm text-slate-700 dark:text-slate-300 flex items-start">
                                                     <span className="text-brand-500 mr-2 mt-0.5">•</span>
                                                     <span className="flex-1">{iv}</span>
                                                  </li>
                                               ))}
                                            </ul>
                                         </div>
                                      ) : null}

                                      {row.goal && (
                                         <div className="pt-2">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Outcome Goal</span>
                                            <p className="text-sm text-brand-700 dark:text-brand-400 font-medium">
                                               {row.goal}
                                            </p>
                                         </div>
                                      )}
                                      
                                      {row.special_instructions && (
                                         <div className="pt-4 mt-auto">
                                            <div className="rounded-[1rem] border border-amber-200/80 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-4">
                                               <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400 block mb-1.5 flex items-center gap-1.5">
                                                  <Brain className="w-3.5 h-3.5" /> High-Priority Protocol
                                               </span>
                                               <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                                                  {row.special_instructions}
                                               </p>
                                            </div>
                                         </div>
                                      )}
                                   </div>
                                </div>
                             </MotionItem>
                          ))}
                       </MotionList>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function pickCarePlan(plans: CarePlanRow[]): CarePlanRow | null {
  if (plans.length === 0) return null;
  return [...plans].sort((a, b) => {
    const ra = STATUS_RANK[a.status ?? ""] ?? 99;
    const rb = STATUS_RANK[b.status ?? ""] ?? 99;
    if (ra !== rb) return ra - rb;
    const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return tb - ta;
  })[0];
}

function groupByCategory(items: CarePlanItemRow[]): Map<string, CarePlanItemRow[]> {
  const map = new Map<string, CarePlanItemRow[]>();
  for (const item of items) {
    const key = item.category ?? "other";
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatSnakeLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function formatCategoryLabel(category: string): string {
  return formatSnakeLabel(category)
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getReviewBadgeState(isoDate: string): { label: string; className: string } {
  const due = new Date(`${isoDate}T23:59:59Z`);
  const now = new Date();
  if (Number.isNaN(due.getTime())) {
    return { label: formatDate(isoDate), className: "border-slate-300 dark:border-slate-600" };
  }
  if (due < now) {
    return {
      label: `${formatDate(isoDate)} (overdue)`,
      className: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
    };
  }
  const days = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 14) {
    return {
      label: `${formatDate(isoDate)} (${days}d)`,
      className: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
    };
  }
  return {
    label: formatDate(isoDate),
    className: "border-slate-300 dark:border-slate-600",
  };
}

function CarePlanStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 border-emerald-200 dark:border-emerald-500/20",
    draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700",
    under_review: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200 border-amber-200 dark:border-amber-500/20",
    archived: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-300 dark:border-slate-700",
  };
  return <Badge className={cn("font-mono text-[10px] uppercase font-bold tracking-widest px-3 border shadow-none", map[status] ?? "bg-slate-100 text-slate-700")}>{formatSnakeLabel(status)}</Badge>;
}
