"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, CalendarClock, UserSquare2, ShieldAlert } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  fetchCarePlanReviewsDueFromSupabase,
  fetchClinicalDeskScope,
  fetchOverdueAssessmentsFromSupabase,
  type ClinicalDeskScope,
  type CarePlanReviewDueRow,
  type OverdueAssessmentRow,
} from "@/lib/assessments/load-overdue-assessments";
import { clinicalDeskEmptyCopy, clinicalDeskQueueState } from "@/lib/assessments/overdue-assessments-display-copy";
import { clinicalQueueCount, formatQueueChip } from "@/lib/clinical/clinical-queue-state";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { CarePlanDiffModal } from "@/components/care-plans/care-plan-diff-modal";
import { enumLabel } from "@/lib/display/enum-label";

// Types
type AssessmentRow = OverdueAssessmentRow;
type CarePlanRow = CarePlanReviewDueRow;

function formatType(t: string): string {
  return enumLabel(t);
}

type AdminOverdueAssessmentsPageClientProps = {
  initialAssessments: AssessmentRow[];
  initialCarePlans: CarePlanRow[];
  initialError: string | null;
  initialFacilityId: string | null;
  initialScope: ClinicalDeskScope | null;
};

export function AdminOverdueAssessmentsPageClient({
  initialAssessments,
  initialCarePlans,
  initialError,
  initialFacilityId,
  initialScope,
}: AdminOverdueAssessmentsPageClientProps) {
  const { selectedFacilityId } = useFacilityStore();
  // No cross-facility queue exists; under All facilities the desk is gated (COL-651).
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);
  const skipNextLoadRef = useRef(initialError == null);
  const [assessments, setAssessments] = useState<AssessmentRow[]>(initialAssessments);
  const [carePlans, setCarePlans] = useState<CarePlanRow[]>(initialCarePlans);
  const [scope, setScope] = useState<ClinicalDeskScope | null>(initialScope);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [diffCarePlanId, setDiffCarePlanId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setIsLoading(true);
    setError(null);
    try {
      if (!isValidFacilityIdForQuery(selectedFacilityId)) {
        setAssessments([]);
        setCarePlans([]);
        setScope(null);
        return;
      }

      const [liveAssessments, liveCarePlans, liveScope] = await Promise.all([
        fetchOverdueAssessmentsFromSupabase(selectedFacilityId),
        fetchCarePlanReviewsDueFromSupabase(selectedFacilityId),
        fetchClinicalDeskScope(selectedFacilityId),
      ]);

      setAssessments(liveAssessments);
      setCarePlans(liveCarePlans);
      setScope(liveScope);
    } catch (err) {
      setAssessments([]);
      setCarePlans([]);
      setScope(null);
      setError(err instanceof Error ? err.message : "Failed to load Clinical Desk");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeReady = isValidFacilityIdForQuery(selectedFacilityId);
  const assessmentQueue = clinicalDeskQueueState({
    scopeReady,
    error,
    scopeSize: scope?.assessmentsOnFile,
    itemCount: assessments.length,
  });
  const carePlanQueue = clinicalDeskQueueState({
    scopeReady,
    error,
    scopeSize: scope?.activeCarePlans,
    itemCount: carePlans.length,
  });
  const overdueChip = formatQueueChip(
    clinicalQueueCount(assessmentQueue, assessments.length, "No assessments on file"),
    "overdue",
  );
  const plansDueChip = formatQueueChip(
    clinicalQueueCount(carePlanQueue, carePlans.length, "No active care plans"),
    "needed",
  );
  const hasCriticals = assessments.some(a => a.riskLevel === "Critical" || a.riskLevel === "High") || carePlans.some(p => p.daysOverdue > 0);

  if (isLoading) {
    return (
      <div className="space-y-6 pt-2">
        <Skeleton className="h-[120px] w-full mb-6 rounded-lg" />
        <div className="grid lg:grid-cols-12 gap-6">
          <Skeleton className="h-[600px] lg:col-span-4 rounded-lg" />
          <Skeleton className="h-[600px] lg:col-span-8 rounded-lg" />
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
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4 shrink-0">
         <div className="space-y-2">
           
           <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Clinical Desk
              {hasCriticals && <></>}
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             Unified exception queue for Assessments and Care Plan drafts.
           </p>
         </div>
         {facilityReady ? (
         <div className="flex flex-wrap gap-3">
           <div className="inline-flex items-center px-4 py-2 rounded-full border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 shadow-sm text-sm font-bold tracking-wide">
             <ClipboardCheck className="mr-2 h-4 w-4 text-rose-500" />
             {overdueChip}
           </div>
           <div className="inline-flex items-center px-4 py-2 rounded-full border border-primary/20 bg-primary/5 text-primary shadow-sm text-sm font-bold tracking-wide">
             <CalendarClock className="mr-2 h-4 w-4 text-primary" />
             {plansDueChip}
           </div>
         </div>
         ) : null}
      </div>

      {!facilityReady ? (
        <FacilityGateNotice reason="Assessments and care-plan reviews come due per building; the desk does not add them up across facilities." />
      ) : (
      <div className="grid lg:grid-cols-12 gap-6 flex-1 min-h-[400px]">
        {/* Left Drawer: Overdue Assessments */}
        <div className="lg:col-span-4 flex flex-col h-full overflow-hidden">
          <div className="border-slate-200/60 dark:border-white/5 rounded-lg bg-slate-100/40 shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-4 pl-2">
              Action Required: Assessments
            </h3>
            <ScrollArea className="flex-1 -mx-2 px-2">
              {assessmentQueue !== "items" ? (
                <div
                  data-queue-state={assessmentQueue}
                  className="p-12 text-center text-slate-500 dark:text-zinc-500 bg-white/50 rounded-lg border border-dashed border-slate-200 dark:border-white/10 mx-2"
                >
                  <ClipboardCheck className="w-12 h-12 text-slate-300 dark:text-zinc-600 mx-auto mb-3" />
                  <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">
                    {clinicalDeskEmptyCopy("assessments", assessmentQueue).title}
                  </p>
                  <p className="text-sm mt-1">{clinicalDeskEmptyCopy("assessments", assessmentQueue).body}</p>
                </div>
              ) : (
                <MotionList className="space-y-4">
                  {assessments.map((a) => (
                    <MotionItem key={a.id}>
                      <div className="p-5 rounded-lg border border-slate-200/80 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm tap-responsive group hover:border-rose-300 dark:hover:border-rose-500/30 hover:shadow-lg transition-all duration-300 cursor-pointer">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-black/50 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                              <UserSquare2 className="w-4 h-4 text-slate-500" />
                            </div>
                            <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">{a.residentName}</span>
                          </div>
                          <Badge variant="destructive" className={cn(
                            "h-5 px-2 text-[10px] font-bold uppercase tracking-wider rounded border-0",
                            a.daysOverdue === 0
                              ? "bg-primary/10 text-primary dark:bg-primary/10 dark:text-primary"
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
          <div className="border-slate-200/60 dark:border-white/5 rounded-lg bg-card dark:bg-white/[0.015] shadow-sm p-6 flex flex-col h-full">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-4 pl-2 flex items-center gap-2">
              <></>
              Generated Care Plan Drafts
            </h3>
            <ScrollArea className="flex-1 -mx-2 px-2">
              {carePlanQueue !== "items" ? (
                <div
                  data-queue-state={carePlanQueue}
                  className="p-20 text-center text-slate-500 dark:text-zinc-500 bg-white/50 rounded-lg border border-dashed border-slate-200 dark:border-white/10 mx-2"
                >
                  <CalendarClock className="w-16 h-16 text-slate-300 dark:text-zinc-600 mx-auto mb-4" />
                  <p className="font-semibold text-xl text-slate-900 dark:text-slate-100">
                    {clinicalDeskEmptyCopy("carePlans", carePlanQueue).title}
                  </p>
                  <p className="text-base mt-2">{clinicalDeskEmptyCopy("carePlans", carePlanQueue).body}</p>
                </div>
              ) : (
                <MotionList className="grid gap-4">
                  {carePlans.map((p) => (
                    <MotionItem key={p.id}>
                      <div className="relative flex flex-col md:flex-row md:items-center gap-4 p-6 rounded-lg border border-slate-200/60 dark:border-white/5 hover:border-primary/30 hover:shadow-lg transition-all duration-300 group bg-white shadow-sm">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors">
                              {p.residentName}
                            </span>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Due: {p.reviewDueDate}</span>
                          </div>
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-4">
                            Care Plan v{p.version} Update (Triggered by MDS)
                          </p>
                          <div className="flex items-center gap-3">
                            <Link href={`/admin/residents/${p.residentId}/care-plan`} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-10 rounded-full px-6 font-bold uppercase tracking-wider text-[10px] shadow-md tap-responsive")}>
                              Review & Sign
                            </Link>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDiffCarePlanId(p.id)}
                              className="h-10 rounded-full px-6 font-bold uppercase tracking-wider text-[10px] shadow-sm tap-responsive border-slate-200 dark:border-white/10 dark:text-zinc-300"
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
      )}

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
