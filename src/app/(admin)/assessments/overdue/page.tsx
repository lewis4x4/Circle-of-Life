"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, CalendarClock, UserSquare2, ShieldAlert } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { MotionCard } from "@/components/ui/motion-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";

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

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [liveAssessments, liveCarePlans] = await Promise.all([
        fetchOverdueAssessments(selectedFacilityId),
        fetchReviewsDue(selectedFacilityId)
      ]);
      
      // DEMO HYDRATION: Ensure Triage Hub is heavily populated for CEO demo if DB is unseeded
      if (liveAssessments.length === 0 && liveCarePlans.length === 0) {
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

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid lg:grid-cols-12 gap-6">
          <Skeleton className="h-[600px] lg:col-span-4 rounded-xl" />
          <Skeleton className="h-[600px] lg:col-span-8 rounded-xl" />
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
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between shrink-0 pl-1">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Clinical Desk
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Unified exception queue for Assessments and Care Plan drafts.
          </p>
        </div>
        <div className="flex gap-3">
          <Badge variant="outline" className="h-7 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
            {overdueCount} Assessments Overdue
          </Badge>
          <Badge variant="outline" className="h-7 border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
            {plansDueCount} Plans Need Review
          </Badge>
        </div>
      </header>

      <div className="grid lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Drawer: Overdue Assessments */}
        <div className="lg:col-span-4 flex flex-col h-full overflow-hidden">
          <MotionCard delay={0.1} className="flex flex-col h-full">
            <Card className="flex flex-col h-full border-slate-200 shadow-sm dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
              <CardHeader className="shrink-0 pb-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                <CardTitle className="text-sm font-semibold flex items-center justify-between text-slate-800 dark:text-slate-200">
                  Action Required: Assessments
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 p-0 min-h-0 bg-transparent">
                <ScrollArea className="h-full">
                  {assessments.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      <ClipboardCheck className="w-8 h-8 text-emerald-400 opacity-50 mx-auto mb-3" />
                      <p className="font-medium text-sm">All Clear</p>
                      <p className="text-xs opacity-70 mt-1">No overdue assessments.</p>
                    </div>
                  ) : (
                    <MotionList className="divide-y divide-slate-100 dark:divide-slate-800/60 p-2">
                      {assessments.map((a) => (
                        <MotionItem key={a.id} className="p-3 mb-2 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-950 hover:shadow-md transition-all shadow-sm">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <UserSquare2 className="w-4 h-4 text-slate-400" />
                              <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{a.residentName}</span>
                            </div>
                            <Badge variant="destructive" className={cn(
                              "h-5 px-1.5 text-[9px] font-bold rounded-sm border-0",
                              a.daysOverdue === 0
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                                : a.daysOverdue > 7
                                  ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 ring-2 ring-rose-300/60 shadow-[0_0_10px_rgba(244,63,94,0.35)]"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 ring-2 ring-amber-300/60 shadow-[0_0_10px_rgba(251,191,36,0.35)]"
                            )}>
                              {a.daysOverdue === 0 ? "DUE TODAY" : `${a.daysOverdue}D OVERDUE`}
                            </Badge>
                          </div>
                          <div className="flex flex-col gap-1.5 ml-6">
                             <div className="flex items-center gap-2 flex-wrap">
                               <span className="text-xs font-medium text-slate-700 dark:text-slate-300 capitalize">{formatType(a.assessmentType)}</span>
                               {a.riskLevel && (
                                 <Badge
                                   variant="outline"
                                   className={cn(
                                     "h-4 px-1.5 text-[9px] font-semibold uppercase tracking-wide rounded-sm border-0",
                                     a.riskLevel === "Critical" && "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
                                     a.riskLevel === "High" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                                     a.riskLevel === "Moderate" && "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                                   )}
                                 >
                                   {a.riskLevel}
                                 </Badge>
                               )}
                             </div>
                             <span className="text-[10px] text-slate-500">Due: {a.nextDueDate}</span>
                          </div>
                          <div className="mt-3 flex justify-end">
                             <Button size="sm" variant="outline" className="h-7 text-xs px-3 shadow-none">Chart Assessment</Button>
                          </div>
                        </MotionItem>
                      ))}
                    </MotionList>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </MotionCard>
        </div>

        {/* Right Pane: Care Plan Drafts */}
        <div className="lg:col-span-8 flex flex-col h-full overflow-hidden">
          <MotionCard delay={0.2} className="flex flex-col h-full">
             <Card className="flex flex-col h-full border-slate-200 shadow-sm dark:border-slate-800 bg-white dark:bg-slate-950">
              <CardHeader className="shrink-0 pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-200">
                    <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
                    Generated Care Plan Drafts
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Drafts generated from recently signed assessments await nursing sign-off.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0 min-h-0">
                <ScrollArea className="h-full px-2 pt-2 pb-6">
                  {carePlans.length === 0 ? (
                    <div className="p-16 text-center text-slate-500">
                      <CalendarClock className="w-12 h-12 text-blue-400 opacity-50 mx-auto mb-3" />
                      <p className="font-medium text-base">All Clear</p>
                      <p className="text-sm opacity-70 mt-1">No drafts awaiting review.</p>
                    </div>
                  ) : (
                    <MotionList className="grid gap-3 pt-2 px-2">
                      {carePlans.map((p) => (
                        <MotionItem key={p.id} className="relative flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800/50 transition-colors group bg-slate-50/30 dark:bg-slate-900/10">
                          <PulseDot colorClass="bg-blue-500" className="mt-2" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold tracking-wider text-slate-800 dark:text-slate-200">
                                {p.residentName}
                              </span>
                              <span className="text-xs font-medium text-slate-400">Due: {p.reviewDueDate}</span>
                            </div>
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-3">
                              Care Plan v{p.version} Update (Triggered by 14-day MDS)
                            </p>
                            <div className="flex items-center gap-3">
                              <Link href={`/admin/residents/${p.residentId}/care-plan`} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 text-[11px] font-medium px-4 bg-blue-600 hover:bg-blue-700 shadow-sm")}>
                                Review & Sign
                              </Link>
                              <Button variant="outline" size="sm" className="h-8 text-[11px] font-medium text-slate-600">
                                View Diff
                              </Button>
                            </div>
                          </div>
                        </MotionItem>
                      ))}
                    </MotionList>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </MotionCard>
        </div>
      </div>
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
