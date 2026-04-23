"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  FileWarning,
  Shield,
  TrendingUp,
  Zap,
  Flame,
  BarChart3,
  Bell,
  X,
} from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { fetchComplianceDashboardSnapshot } from "@/lib/compliance-dashboard-snapshot";
import { getComplianceScore, getEmergencyChecklistPreview } from "@/lib/compliance-scan";
import {
  getPendingReminders,
  dismissReminder,
  type ComplianceReminder,
} from "@/lib/compliance-reminders";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { StatuteCitation } from "@/components/ui/StatuteCitation";

type DefRow = {
  id: string;
  tag_number: string;
  severity: string;
  status: string;
  submission_due_date: string | null;
};

type EmergencyItem = {
  id: string;
  title: string;
  next_due_date: string;
  overdue: boolean;
};

type DeficiencyListRow = Pick<DefRow, "id" | "tag_number" | "severity" | "status">;
type PlanOfCorrectionRow = {
  deficiency_id: string;
  submission_due_date: string | null;
  status: string;
};

type AdminCompliancePageClientProps = {
  initialSnapshot: Awaited<ReturnType<typeof fetchComplianceDashboardSnapshot>> | null;
  initialSnapError: string | null;
  initialFacilityId: string | null;
};

export function AdminCompliancePageClient({
  initialSnapshot,
  initialSnapError,
  initialFacilityId,
}: AdminCompliancePageClientProps) {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [snapLoading, setSnapLoading] = useState(initialSnapshot == null && initialSnapError == null);
  const [snapError, setSnapError] = useState<string | null>(initialSnapError);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof fetchComplianceDashboardSnapshot>> | null>(initialSnapshot);
  const [defRows, setDefRows] = useState<DefRow[]>([]);
  const [defLoading, setDefLoading] = useState(true);

  // Enhanced tier state
  const [complianceScore, setComplianceScore] = useState<{ percentage: number; passed: number; total: number } | null>(null);
  const [emergencyItems, setEmergencyItems] = useState<EmergencyItem[]>([]);
  const [reminders, setReminders] = useState<ComplianceReminder[]>([]);

  // Skip the first client-side snapshot fetch when the server already supplied
  // data for the current facility. Any later facility scope change falls
  // through to the normal load path.
  const skipNextSnapshotRef = useRef(initialSnapshot != null);

  const loadSnapshot = useCallback(async () => {
    if (skipNextSnapshotRef.current && selectedFacilityId === initialFacilityId) {
      skipNextSnapshotRef.current = false;
      return;
    }
    skipNextSnapshotRef.current = false;

    setSnapLoading(true);
    setSnapError(null);
    try {
      const data = await fetchComplianceDashboardSnapshot(selectedFacilityId);
      setSnapshot(data);
    } catch (e) {
      setSnapshot(null);
      setSnapError(e instanceof Error ? e.message : "Unable to load compliance metrics.");
    } finally {
      setSnapLoading(false);
    }
  }, [selectedFacilityId, initialFacilityId]);

  const loadDeficiencies = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setDefRows([]);
      setDefLoading(false);
      return;
    }
    setDefLoading(true);
    const { data, error } = await supabase
      .from("survey_deficiencies")
      .select("id, tag_number, severity, status")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", ["open", "poc_submitted", "poc_accepted", "recited"])
      .order("survey_date", { ascending: false })
      .limit(25);

    if (error || !data) {
      setDefRows([]);
      setDefLoading(false);
      return;
    }

    const deficiencies = data as DeficiencyListRow[];
    const ids = deficiencies.map((deficiency) => deficiency.id);
    if (ids.length === 0) {
      setDefRows([]);
      setDefLoading(false);
      return;
    }

    const { data: pocs } = await supabase
      .from("plans_of_correction")
      .select("deficiency_id, submission_due_date, status")
      .in("deficiency_id", ids)
      .is("deleted_at", null)
      .in("status", ["draft", "submitted", "accepted"]);

    const dueByDef = new Map<string, string>();
    for (const poc of (pocs ?? []) as PlanOfCorrectionRow[]) {
      if (poc.submission_due_date && !dueByDef.has(poc.deficiency_id)) {
        dueByDef.set(poc.deficiency_id, poc.submission_due_date);
      }
    }

    setDefRows(
      deficiencies.map((deficiency) => ({
        id: deficiency.id,
        tag_number: deficiency.tag_number,
        severity: deficiency.severity,
        status: deficiency.status,
        submission_due_date: dueByDef.get(deficiency.id) ?? null,
      })),
    );
    setDefLoading(false);
  }, [supabase, selectedFacilityId]);

  const loadReminders = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setReminders([]);
      return;
    }

    try {
      const data = await getPendingReminders(selectedFacilityId);
      setReminders(data);
    } catch (e) {
      console.error("Failed to load reminders:", e);
    }
  }, [selectedFacilityId]);

  const loadEnhancedData = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setComplianceScore(null);
      setEmergencyItems([]);
      return;
    }

    try {
      // Load compliance score
      const score = await getComplianceScore(selectedFacilityId);
      setComplianceScore(score);

      setEmergencyItems(await getEmergencyChecklistPreview(selectedFacilityId));
    } catch (e) {
      console.error("Failed to load enhanced data:", e);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    void loadDeficiencies();
  }, [loadDeficiencies]);

  useEffect(() => {
    void loadEnhancedData();
  }, [loadEnhancedData]);

  useEffect(() => {
    void loadReminders();
  }, [loadReminders]);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const daysUntilDue = (dueDate: string) => {
    const today = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <AmbientMatrix
        hasCriticals={
          (snapshot?.openDeficiencies ?? 0) > 0 ||
          (snapshot?.overdueAssessments ?? 0) > 0 ||
          emergencyItems.some((e) => e.overdue)
        }
        primaryClass="bg-indigo-500/10"
        secondaryClass="bg-red-500/5"
      />

      <div className="relative z-10 space-y-8 max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between py-6">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 08 / Quality & Risk</p>
            <h1 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Compliance {(emergencyItems.some((e) => e.overdue) || (complianceScore?.percentage ?? 100) < 75) && <PulseDot colorClass="bg-rose-500" />}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
              Incident reporting aligns with{" "}
              <StatuteCitation statuteCode="59A-36.018" className="font-medium text-indigo-700 dark:text-indigo-300">
                FAC 59A-36.018
              </StatuteCitation>{" "}
              (see statute tooltip).
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/compliance/audit-export" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-white/50 dark:bg-zinc-900/40 text-[10px] uppercase tracking-widest font-mono text-slate-700 dark:text-slate-300")}>
              Audit log export
            </Link>
            <Link href="/admin/compliance/policies" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-white/50 dark:bg-zinc-900/40 text-[10px] uppercase tracking-widest font-mono text-slate-700 dark:text-slate-300")}>
              Policy library
            </Link>
            <Link href="/admin/compliance/deficiencies/new" className={cn(buttonVariants({ size: "sm" }), "text-[10px] uppercase tracking-widest font-mono bg-indigo-600 hover:bg-indigo-700 text-white")}>
              Add deficiencies
            </Link>
            <Link href="/admin/certifications" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "text-[10px] uppercase tracking-widest font-mono glass-panel bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50")}>
              Certifications
            </Link>
            {/* Enhanced tier links */}
            <Link href="/admin/compliance/rules" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-indigo-50/30 dark:bg-indigo-900/20 text-[10px] uppercase tracking-widest font-mono text-indigo-700 dark:text-indigo-300")}>
              Compliance Rules
            </Link>
            <Link href="/admin/compliance/scan" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-indigo-50/30 dark:bg-indigo-900/20 text-[10px] uppercase tracking-widest font-mono text-indigo-700 dark:text-indigo-300")}>
              Run Scan
            </Link>
            <Link href="/admin/compliance/deficiencies/analysis" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-indigo-50/30 dark:bg-indigo-900/20 text-[10px] uppercase tracking-widest font-mono text-indigo-700 dark:text-indigo-300")}>
              Analysis
            </Link>
            <Link href="/admin/compliance/emergency-preparedness" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-orange-50/30 dark:bg-orange-950/20 text-[10px] uppercase tracking-widest font-mono text-orange-700 dark:text-orange-300")}>
              Emergency Prep
            </Link>
          </div>
        </div>

        {!facilityReady ? (
          <div className="rounded-[2rem] glass-panel bg-amber-50/40 dark:bg-amber-950/20 p-8 border border-amber-200/50 dark:border-amber-900/50 backdrop-blur-md">
            <h3 className="text-lg font-display font-semibold text-amber-900 dark:text-amber-300 mb-2">Select a facility</h3>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
              Choose a facility in header to load compliance metrics for that site.
            </p>
          </div>
        ) : null}

        {snapError ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {snapError}
          </p>
        ) : null}

        <KineticGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" staggerMs={60}>
          <div className="h-[140px]">
            <Tile
              title="Overdue assessments"
              value={snapLoading ? null : snapshot?.overdueAssessments ?? 0}
              href="/admin/assessments/overdue"
              hoverColor="red"
            />
          </div>
          <div className="h-[140px]">
            <Tile
              title="Overdue care plan reviews"
              value={snapLoading ? null : snapshot?.overdueCarePlanReviews ?? 0}
              href="/admin/care-plans/reviews-due"
              hoverColor="orange"
            />
          </div>
          <div className="h-[140px]">
            <Tile
              title="Incident follow-ups past due"
              value={snapLoading ? null : snapshot?.openIncidentFollowupsPastDue ?? 0}
              href="/admin/incidents"
              hoverColor="red"
            />
          </div>
          <div className="h-[140px]">
            <Tile
              title="Active infections"
              value={snapLoading ? null : snapshot?.activeInfections ?? 0}
              href="/admin/infection-control"
              hoverColor="red"
              badge={
                !snapLoading && snapshot && snapshot.activeOutbreaks > 0 ? (
                  <PulseDot colorClass="bg-rose-500" />
                ) : null
              }
            />
          </div>
          <div className="h-[140px]">
            <Tile
              title="Certs expiring (30d)"
              value={snapLoading ? null : snapshot?.expiringCertifications30d ?? 0}
              href="/admin/certifications"
              hoverColor="amber"
            />
          </div>
          <div className="h-[140px]">
            <Tile
              title="Open deficiencies"
              value={snapLoading ? null : snapshot?.openDeficiencies ?? 0}
              href="/admin/compliance/deficiencies/new"
              hoverColor="red"
            />
          </div>
        </KineticGrid>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <FileWarning className="h-6 w-6 text-indigo-500 drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
            <h2 className="text-xl font-display font-semibold tracking-tight text-slate-800 dark:text-slate-100">Open Deficiencies</h2>
          </div>
          <p className="text-sm font-mono text-slate-500 mb-6">Survey citations that still need correction or verification.</p>

          {!facilityReady ? (
            <p className="text-sm text-slate-500">Select a facility to list deficiencies.</p>
          ) : defLoading ? (
            <p className="text-sm font-mono text-slate-500">Loading…</p>
          ) : defRows.length === 0 ? (
            <div className="p-8 text-center text-slate-500 bg-white/30 dark:bg-black/20 rounded-2xl border border-white/20 dark:border-white/5 backdrop-blur-md max-w-xl mx-auto mt-8">
               <p className="font-medium">All Clear</p>
               <p className="text-sm opacity-80 mt-1">No open deficiencies for this facility.</p>
            </div>
          ) : (
            <MotionList className="space-y-3">
              {defRows.map((row) => (
                <MotionItem key={row.id} className="p-4 rounded-2xl glass-panel group transition-all duration-300 hover:scale-[1.01] hover:border-indigo-500/30 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer border border-white/40 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800/80 flex flex-col items-center justify-center border border-slate-200 dark:border-slate-700/50 flex-shrink-0">
                        <span className="text-[10px] uppercase font-mono tracking-widest text-slate-400">Tag</span>
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{row.tag_number}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-widest shadow-sm bg-white dark:bg-black/40">Severity {row.severity}</Badge>
                          <span className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">{row.status.replace(/_/g, " ")}</span>
                        </div>
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">POC Due: {row.submission_due_date ?? "—"}</span>
                      </div>
                    </div>

                    <Link
                      href={`/admin/compliance/deficiencies/${row.id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full sm:w-auto font-mono text-[10px] uppercase tracking-widest shadow-none bg-transparent border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 group-hover:border-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400")}
                    >
                      Manage Finding
                    </Link>
                  </div>
                </MotionItem>
              ))}
            </MotionList>
          )}
        </div>

        {/* Enhanced Tier: Compliance Score */}
        {complianceScore && (
          <div className="rounded-3xl glass-panel p-6 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/30">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-6 w-6 text-indigo-500" />
                <div>
                  <h2 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100">Compliance Score</h2>
                  <p className="text-sm text-slate-500">Based on latest rule-based scan</p>
                </div>
              </div>
              <Link href="/admin/compliance/scan" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-indigo-50/30 dark:bg-indigo-900/20 text-[10px] uppercase tracking-widest font-mono text-indigo-700 dark:text-indigo-300")}>
                Run New Scan
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/30 text-center">
                <p className="text-5xl font-bold text-slate-900 dark:text-slate-100">
                  {complianceScore.percentage}%
                </p>
                <p className="text-xs text-slate-500 mt-2 uppercase">Pass Rate</p>
              </div>
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/30 text-center">
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {complianceScore.passed}
                </p>
                <p className="text-xs text-slate-500 mt-2 uppercase">Rules Passing</p>
              </div>
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/30 text-center">
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {complianceScore.total}
                </p>
                <p className="text-xs text-slate-500 mt-2 uppercase">Total Rules</p>
              </div>
            </div>
            <Link href="/admin/compliance/rules" className="mt-4 inline-block text-center w-full">
              <Button variant="outline" className="w-full">
                <BarChart3 className="mr-2 h-4 w-4" />
                View All Rules & Details
              </Button>
            </Link>
          </div>
        )}

        {/* Enhanced Tier: Emergency Preparedness */}
        {emergencyItems.length > 0 && (
          <div className="rounded-3xl glass-panel p-6 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg ${
                  emergencyItems.some((e) => e.overdue)
                    ? "bg-rose-100"
                    : "bg-slate-100"
                }`}>
                  {emergencyItems.some((e) => e.overdue) ? (
                    <Flame className="h-6 w-6 text-rose-600" />
                  ) : (
                    <Zap className="h-6 w-6 text-slate-600" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100">Emergency Preparedness</h2>
                  <p className="text-sm text-slate-500">Next required drills and checks</p>
                </div>
              </div>
              <Link href="/admin/compliance/emergency-preparedness" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-orange-50/30 dark:bg-orange-950/20 text-[10px] uppercase tracking-widest font-mono text-orange-700 dark:text-orange-300")}>
                Manage Checklist
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {emergencyItems.map((item) => {
                const daysUntil = daysUntilDue(item.next_due_date);
                const isOverdue = daysUntil < 0;
                const isDueSoon = daysUntil >= 0 && daysUntil <= 7;
                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-xl border ${
                      isOverdue
                        ? "border-rose-500 bg-rose-50"
                        : isDueSoon
                          ? "border-amber-500 bg-amber-50"
                          : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-slate-500" />
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                          <p className={`text-xs ${
                            isOverdue
                              ? "text-rose-600 font-semibold"
                              : isDueSoon
                                ? "text-amber-600"
                                : "text-slate-500"
                          }`}>
                            {isOverdue
                              ? `Overdue by ${Math.abs(daysUntil)} days`
                              : isDueSoon
                                ? `Due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`
                                : `Due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Enhanced Tier: Compliance Reminders */}
        {reminders.length > 0 && (
          <div className="rounded-3xl glass-panel p-6 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg ${
                  reminders.some((r) => r.reminder_type === 'weekly_digest')
                    ? "bg-indigo-100"
                    : "bg-amber-100"
                }`}>
                  <Bell className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100">Pending Reminders</h2>
                  <p className="text-sm text-slate-500">Action items requiring attention</p>
                </div>
              </div>
              <Link href="/admin/compliance/deficiencies/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-indigo-50/30 dark:bg-indigo-900/20 text-[10px] uppercase tracking-widest font-mono text-indigo-700 dark:text-indigo-300")}>
                View All
              </Link>
            </div>
            <MotionList className="space-y-3">
              {reminders.slice(0, 5).map((reminder) => {
                const isWeekly = reminder.reminder_type === 'weekly_digest';
                const isUrgent = reminder.reminder_type === 'poc_due' || reminder.reminder_type === 'assessment_overdue';
                return (
                  <MotionItem key={reminder.id} className="p-4 rounded-xl glass-panel transition-all duration-300 hover:scale-[1.01] hover:border-indigo-500/30 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer border border-white/40 dark:border-white/5 bg-white/50 dark:bg-slate-900/30">
                    <div className="flex items-start justify-between gap-4 w-full">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          isWeekly ? 'bg-indigo-100' : isUrgent ? 'bg-rose-100' : 'bg-amber-100'
                        }`}>
                          {isWeekly ? (
                            <ClipboardList className="h-5 w-5 text-indigo-600" />
                          ) : isUrgent ? (
                            <AlertTriangle className="h-5 w-5 text-rose-600" />
                          ) : (
                            <Zap className="h-5 w-5 text-amber-600" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-slate-900 dark:text-slate-100">{reminder.title}</p>
                            {isUrgent && (
                              <Badge variant="destructive" className="text-[9px] uppercase tracking-widest">Urgent</Badge>
                            )}
                          </div>
                          {reminder.description && (
                            <p className="text-sm text-slate-600 dark:text-slate-400">{reminder.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {reminder.action_url && (
                          <Link href={reminder.action_url} className={buttonVariants({ variant: "outline", size: "sm" })}>
                            View
                          </Link>
                        )}
                        <button
                          onClick={() => dismissReminder(reminder.id, selectedFacilityId || "").then(() => setReminders(r => r.filter(x => x.id !== reminder.id)))}
                          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Dismiss reminder"
                        >
                          <X className="h-4 w-4 text-slate-400" />
                        </button>
                      </div>
                    </div>
                  </MotionItem>
                );
              })}
            </MotionList>
          </div>
        )}

        {/* Survey Mode and Quick Links */}
        <div className="grid gap-5 md:grid-cols-2 mt-8">
          <div className="rounded-3xl glass-panel p-6 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/30">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="h-6 w-6 text-indigo-500" />
              <div>
                <h3 className="text-lg font-display font-semibold text-slate-800 dark:text-slate-200">Survey visit mode</h3>
                <p className="text-xs font-medium text-slate-500 mb-4">Use bar below header to activate logging while a regulator is on site.</p>
                <div className="bg-white/60 dark:bg-black/30 p-4 rounded-xl border border-white/40 dark:border-white/5 font-mono text-sm text-slate-700 dark:text-slate-300">
                   {snapLoading ? "—" : snapshot?.surveyVisitActive ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">● Session active for this facility.</span> : "No active session."}
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-3xl glass-panel p-6 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/30">
            <div className="flex items-center gap-3 mb-4">
              <ClipboardList className="h-6 w-6 text-emerald-500" />
              <div>
                <h3 className="text-lg font-display font-semibold text-slate-800 dark:text-slate-200">Quick Links</h3>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Link href="/admin/compliance/policies" className="group flex items-center justify-between p-3 rounded-xl hover:bg-white/60 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-white/10">
                <span className="font-medium text-sm text-slate-700 dark:text-slate-300">Policy library</span>
                <span className="text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">→</span>
              </Link>
              <Link href="/admin/compliance/deficiencies/new" className="group flex items-center justify-between p-3 rounded-xl hover:bg-white/60 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-white/10">
                <span className="font-medium text-sm text-slate-700 dark:text-slate-300">Enter survey deficiencies</span>
                <span className="text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">→</span>
              </Link>
              <Link href="/admin/incidents" className="group flex items-center justify-between p-3 rounded-xl hover:bg-white/60 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-white/10">
                <span className="font-medium text-sm text-slate-700 dark:text-slate-300">Incidents & follow-ups</span>
                <span className="text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">→</span>
              </Link>
              {/* Enhanced tier links */}
              <Link href="/admin/compliance/deficiencies/analysis" className="group flex items-center justify-between p-3 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-colors border border-transparent hover:border-indigo-500 dark:hover:border-white/10">
                <span className="font-medium text-sm text-indigo-700 dark:text-indigo-300">Deficiency analysis</span>
                <span className="text-slate-400 group-hover:text-white dark:group-hover:text-white transition-colors">→</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="font-mono text-[11px] uppercase tracking-wider leading-relaxed">
            Tiles aggregate live operational data. Enhanced scoring and emergency preparedness features provide proactive compliance monitoring.
          </p>
        </div>
      </div>
    </div>
  );
}

function Tile({
  title,
  value,
  href,
  badge,
  hoverColor = "indigo",
}: {
  title: string;
  value: number | null;
  href: string;
  badge?: ReactNode;
  hoverColor?: "indigo" | "rose" | "emerald" | "amber" | "slate" | "red" | "orange";
}) {
  const isDanger = (value ?? 0) > 0 && (hoverColor === "red" || hoverColor === "amber" || hoverColor === "orange");

  return (
    <Link href={href} className="block h-full group focus-visible:outline-none">
      <V2Card
        hoverColor={hoverColor}
        className={cn("h-full flex flex-col justify-between", isDanger ? "border-red-500/20 shadow-[inset_0_0_15px_rgba(239,68,68,0.05)]" : "")}
      >
        <MonolithicWatermark value={value ?? 0} className={cn("opacity-50", isDanger ? "text-red-500/5" : "text-slate-500/5 dark:text-white/5")} />
        <div className="relative z-10 flex flex-col h-full justify-between">
          <div className="flex items-center justify-between">
             <h3 className={cn("text-[10px] font-mono tracking-widest uppercase", isDanger ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400")}>
               {title}
             </h3>
             <div className="flex items-center gap-2">
               {badge}
             </div>
          </div>
          <p className={cn("text-4xl font-mono tracking-tighter pb-1 transition-colors", isDanger ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-200 group-hover:text-amber-600 dark:group-hover:text-amber-400", hoverColor === "indigo" && !isDanger ? "group-hover:text-indigo-600 dark:group-hover:text-indigo-400" : "")}>
            {value === null ? "—" : value}
          </p>
        </div>
      </V2Card>
    </Link>
  );
}
