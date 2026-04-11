"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, CalendarClock, UserSquare2, ShieldAlert } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/demo-mode";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { CarePlanDiffModal } from "@/components/care-plans/care-plan-diff-modal";

// Types
type AssessmentRow = {
  id: string;
  residentId: string;
  residentName: string;
  assessmentType: string;
  assessmentDate: string;
  nextDueDate: string;
  daysOverdue: number;
  riskLevel: string | null;
  totalScore: string | null;
};

type CarePlanRow = {
  id: string;
  residentId: string;
  residentName: string;
  version: number;
  status: string;
  effectiveDate: string;
  reviewDueDate: string;
  daysOverdue: number;
};

type SupabaseAssessment = {
  id: string;
  resident_id: string;
  facility_id: string;
  assessment_type: string;
  assessment_date: string;
  next_due_date: string;
  risk_level: string | null;
  total_score: number | string | null;
};

type SupabasePlan = {
  id: string;
  resident_id: string;
  facility_id: string;
  version: number | null;
  status: string;
  effective_date: string;
  review_due_date: string;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function easternDateString(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !day) return d.toISOString().slice(0, 10);
  return `${y}-${m}-${day}`;
}

function parseISODateOnly(value: string): number {
  const [yy, mm, dd] = value.split("-").map(Number);
  if (!yy || !mm || !dd) return NaN;
  return new Date(Date.UTC(yy, mm - 1, dd)).getTime();
}

function formatDisplayDate(iso: string): string {
  const t = parseISODateOnly(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

function formatType(t: string): string {
  return t.replace(/_/g, " ");
}

export default function ClinicalDeskPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [carePlans, setCarePlans] = useState<CarePlanRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffCarePlanId, setDiffCarePlanId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [liveAssessments, liveCarePlans] = await Promise.all([
        fetchOverdueAssessments(selectedFacilityId),
        fetchReviewsDue(selectedFacilityId)
      ]);
      
      if (liveAssessments.length === 0 && liveCarePlans.length === 0 && isDemoMode()) {
        setAssessments([
          { id: "a1", residentId: "r1", residentName: "Eleanor Vance", assessmentType: "Fall Risk / 14-Day MDS", assessmentDate: "—", nextDueDate: "3 days ago", daysOverdue: 3, riskLevel: "High", totalScore: null },
          { id: "a2", residentId: "r2", residentName: "Arthur Pendelton", assessmentType: "Elopement Risk", assessmentDate: "—", nextDueDate: "3 days ago", daysOverdue: 3, riskLevel: "Critical", totalScore: null },
          { id: "a3", residentId: "r3", residentName: "Margaret Sullivan", assessmentType: "Quarterly MDS", assessmentDate: "—", nextDueDate: "Today", daysOverdue: 0, riskLevel: "Moderate", totalScore: null },
          { id: "a4", residentId: "r4", residentName: "James Holden", assessmentType: "Skin Integrity (Braden)", assessmentDate: "—", nextDueDate: "Yesterday", daysOverdue: 1, riskLevel: "High", totalScore: null }
        ]);
        setCarePlans([
          { id: "p1", residentId: "r3", residentName: "Margaret Sullivan", version: 2, status: "draft", effectiveDate: "—", reviewDueDate: "Today", daysOverdue: 0 },
          { id: "p2", residentId: "r1", residentName: "Eleanor Vance", version: 4, status: "draft", effectiveDate: "—", reviewDueDate: "Yesterday", daysOverdue: 1 },
          { id: "p3", residentId: "r5", residentName: "Martha Jones", version: 1, status: "draft", effectiveDate: "—", reviewDueDate: "Today", daysOverdue: 0 }
        ]);
      } else {
        setAssessments(liveAssessments);
        setCarePlans(liveCarePlans);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Clinical Desk");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const overdueCount = assessments.length;
  const plansDueCount = carePlans.length;
  const hasCriticals = assessments.some(a => a.riskLevel === "Critical" || a.riskLevel === "High") || carePlans.some(p => p.daysOverdue > 0);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-[120px] w-full mb-6 rounded-[2.5rem]" />
        <div className="grid lg:grid-cols-12 gap-6">
          <Skeleton className="h-[600px] lg:col-span-4 rounded-[2rem]" />
          <Skeleton className="h-[600px] lg:col-span-8 rounded-[2rem]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-center p-8 bg-rose-50 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-900/50 max-w-md">
          <ShieldAlert className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-rose-800 dark:text-rose-300 mb-2">System Unavailable</h2>
          <p className="text-sm text-rose-700/80 dark:text-rose-400/80 mb-4">{error}</p>
          <Button variant="outline" onClick={() => void load()}>Retry Connection</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-6 pb-6">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4 shrink-0">
         <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Assessments
           </div>
           <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Clinical Desk
              {hasCriticals && <PulseDot colorClass="bg-rose-500" />}
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             Unified exception queue for Assessments and Care Plan drafts.
           </p>
         </div>
         <div className="flex flex-wrap gap-3">
           <div className="inline-flex items-center px-4 py-2 rounded-full border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 shadow-sm text-sm font-bold tracking-wide">
             <ClipboardCheck className="mr-2 h-4 w-4 text-rose-500" />
             {overdueCount} Overdue
           </div>
           <div className="inline-flex items-center px-4 py-2 rounded-full border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-800 dark:text-indigo-300 shadow-sm text-sm font-bold tracking-wide">
             <CalendarClock className="mr-2 h-4 w-4 text-indigo-500" />
             {plansDueCount} Needed
           </div>
         </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 flex-1 min-h-[400px]">
        {/* Left Drawer: Overdue Assessments */}
        <div className="lg:col-span-4 flex flex-col h-full overflow-hidden">
          <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-slate-100/40 dark:bg-black/20 shadow-sm backdrop-blur-3xl p-6 flex flex-col h-full">
            <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-4 pl-2">
              Action Required: Assessments
            </h3>
            <ScrollArea className="flex-1 -mx-2 px-2">
              {assessments.length === 0 ? (
                <div className="p-12 text-center text-slate-500 dark:text-zinc-500 bg-white/50 dark:bg-white/[0.02] rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10 mx-2">
                  <ClipboardCheck className="w-12 h-12 text-slate-300 dark:text-zinc-600 mx-auto mb-3" />
                  <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">All Clear</p>
                  <p className="text-sm mt-1">No overdue assessments.</p>
                </div>
              ) : (
                <MotionList className="space-y-4">
                  {assessments.map((a) => (
                    <MotionItem key={a.id}>
                      <div className="p-5 rounded-[2rem] border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm tap-responsive group hover:border-rose-300 dark:hover:border-rose-500/30 hover:shadow-lg transition-all duration-300 cursor-pointer">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                              <UserSquare2 className="w-4 h-4 text-slate-500" />
                            </div>
                            <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">{a.residentName}</span>
                          </div>
                          <Badge variant="destructive" className={cn(
                            "h-5 px-2 text-[10px] font-bold uppercase tracking-widest rounded border-0",
                            a.daysOverdue === 0
                              ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300"
                              : a.daysOverdue > 7
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-400 ring-1 ring-rose-500/50 shadow-[0_4px_15px_rgba(244,63,94,0.2)]"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400 ring-1 ring-amber-500/50"
                          )}>
                            {a.daysOverdue === 0 ? "Due Today" : `${a.daysOverdue}d Overdue`}
                          </Badge>
                        </div>
                        <div className="flex flex-col gap-2 ml-11">
                           <div className="flex items-center gap-2 flex-wrap">
                             <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{formatType(a.assessmentType)}</span>
                             {a.riskLevel && (
                               <span
                                 className={cn(
                                   "px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border",
                                   a.riskLevel === "Critical" && "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
                                   a.riskLevel === "High" && "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
                                   a.riskLevel === "Moderate" && "bg-slate-50 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10"
                                 )}
                               >
                                 {a.riskLevel} Risk
                               </span>
                             )}
                           </div>
                           <span className="text-[11px] font-mono font-medium tracking-wide text-slate-500 dark:text-zinc-500">Due: {a.nextDueDate}</span>
                        </div>
                      </div>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Right Pane: Care Plan Drafts */}
        <div className="lg:col-span-8 flex flex-col h-full overflow-hidden">
          <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-sm backdrop-blur-3xl p-6 flex flex-col h-full">
            <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-4 pl-2 flex items-center gap-2">
              <PulseDot colorClass="bg-indigo-500" />
              Generated Care Plan Drafts
            </h3>
            <ScrollArea className="flex-1 -mx-2 px-2">
              {carePlans.length === 0 ? (
                <div className="p-20 text-center text-slate-500 dark:text-zinc-500 bg-white/50 dark:bg-white/[0.02] rounded-[2rem] border border-dashed border-slate-200 dark:border-white/10 mx-2">
                  <CalendarClock className="w-16 h-16 text-slate-300 dark:text-zinc-600 mx-auto mb-4" />
                  <p className="font-semibold text-xl text-slate-900 dark:text-slate-100">All Clear</p>
                  <p className="text-base mt-2">No drafts awaiting review.</p>
                </div>
              ) : (
                <MotionList className="grid gap-4">
                  {carePlans.map((p) => (
                    <MotionItem key={p.id}>
                      <div className="relative flex flex-col md:flex-row md:items-center gap-4 p-6 rounded-[2rem] border border-slate-200/60 dark:border-white/5 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:shadow-lg transition-all duration-300 group bg-white dark:bg-white/[0.03] shadow-sm">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                              {p.residentName}
                            </span>
                            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-500">Due: {p.reviewDueDate}</span>
                          </div>
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-4">
                            Care Plan v{p.version} Update (Triggered by MDS)
                          </p>
                          <div className="flex items-center gap-3">
                            <Link href={`/admin/residents/${p.residentId}/care-plan`} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-10 rounded-full px-6 font-bold uppercase tracking-widest text-[10px] bg-indigo-600 hover:bg-indigo-700 shadow-md tap-responsive text-white")}>
                              Review & Sign
                            </Link>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDiffCarePlanId(p.id)}
                              className="h-10 rounded-full px-6 font-bold uppercase tracking-widest text-[10px] shadow-sm tap-responsive border-slate-200 dark:border-white/10 dark:text-zinc-300"
                            >
                              View Diff
                            </Button>
                          </div>
                        </div>
                      </div>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </ScrollArea>
          </div>
        </div>

      </div>

      {/* Care Plan Diff Modal */}
      <CarePlanDiffModal
        carePlanId={diffCarePlanId}
        onClose={() => setDiffCarePlanId(null)}
        onContinueToReview={(carePlanId) => {
          const plan = carePlans.find((p) => p.id === carePlanId);
          if (plan) {
            router.push(`/admin/residents/${plan.residentId}/care-plan`);
          }
        }}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// DATA HOOKS (Merged from the original two separate tables)
// --------------------------------------------------------------------------

async function fetchOverdueAssessments(selectedFacilityId: string | null): Promise<AssessmentRow[]> {
  const today = easternDateString();
  const supabase = createClient();
  let q = supabase
    .from("assessments" as never)
    .select("id, resident_id, facility_id, assessment_type, assessment_date, next_due_date, risk_level, total_score")
    .is("deleted_at", null)
    .not("next_due_date", "is", null)
    .lte("next_due_date", today)
    .order("next_due_date", { ascending: true })
    .limit(500);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryListResult<SupabaseAssessment>;
  if (res.error) throw res.error;
  const assessments = res.data ?? [];
  if (assessments.length === 0) return [];

  const residentIds = [...new Set(assessments.map((a) => a.resident_id))];
  const resRes = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)
    .is("deleted_at", null)) as unknown as QueryListResult<SupabaseResidentMini>;
  if (resRes.error) throw resRes.error;
  const resById = new Map((resRes.data ?? []).map((r) => [r.id, r] as const));

  const todayMs = parseISODateOnly(today);

  return assessments.map((a) => {
    const rm = resById.get(a.resident_id);
    const name = rm
      ? `${rm.first_name ?? ""} ${rm.last_name ?? ""}`.trim() || "Unknown"
      : "Unknown";
    const dueMs = parseISODateOnly(a.next_due_date);
    const daysOverdue = Number.isNaN(dueMs) || Number.isNaN(todayMs) ? 0 : Math.max(0, Math.round((todayMs - dueMs) / 86400000));
    const score =
      a.total_score == null ? null : typeof a.total_score === "number" ? String(a.total_score) : String(a.total_score);

    return {
      id: a.id,
      residentId: a.resident_id,
      residentName: name,
      assessmentType: a.assessment_type,
      assessmentDate: formatDisplayDate(a.assessment_date),
      nextDueDate: formatDisplayDate(a.next_due_date),
      daysOverdue,
      riskLevel: a.risk_level,
      totalScore: score,
    };
  });
}

async function fetchReviewsDue(selectedFacilityId: string | null): Promise<CarePlanRow[]> {
  const today = easternDateString();
  const supabase = createClient();
  let q = supabase
    .from("care_plans" as never)
    .select("id, resident_id, facility_id, version, status, effective_date, review_due_date")
    .is("deleted_at", null)
    .eq("status", "active")
    .lte("review_due_date", today)
    .order("review_due_date", { ascending: true })
    .limit(500);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    q = q.eq("facility_id", selectedFacilityId);
  }

  const res = (await q) as unknown as QueryListResult<SupabasePlan>;
  if (res.error) throw res.error;
  const plans = res.data ?? [];
  if (plans.length === 0) return [];

  const residentIds = [...new Set(plans.map((p) => p.resident_id))];
  const resRes = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)
    .is("deleted_at", null)) as unknown as QueryListResult<SupabaseResidentMini>;
  if (resRes.error) throw resRes.error;
  const resById = new Map((resRes.data ?? []).map((r) => [r.id, r] as const));

  const todayMs = parseISODateOnly(today);

  return plans.map((p) => {
    const rm = resById.get(p.resident_id);
    const name = rm
      ? `${rm.first_name ?? ""} ${rm.last_name ?? ""}`.trim() || "Unknown"
      : "Unknown";
    const dueMs = parseISODateOnly(p.review_due_date);
    const daysOverdue = Number.isNaN(dueMs) || Number.isNaN(todayMs) ? 0 : Math.max(0, Math.round((todayMs - dueMs) / 86400000));

    return {
      id: p.id,
      residentId: p.resident_id,
      residentName: name,
      version: p.version ?? 1,
      status: p.status,
      effectiveDate: formatDisplayDate(p.effective_date),
      reviewDueDate: formatDisplayDate(p.review_due_date),
      daysOverdue,
    };
  });
}
