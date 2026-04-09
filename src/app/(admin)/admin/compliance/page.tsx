"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, FileWarning, Shield } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { fetchComplianceDashboardSnapshot } from "@/lib/compliance-dashboard-snapshot";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

type DefRow = {
  id: string;
  tag_number: string;
  severity: string;
  status: string;
  submission_due_date: string | null;
};

export default function AdminCompliancePage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [snapLoading, setSnapLoading] = useState(true);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof fetchComplianceDashboardSnapshot>> | null>(null);
  const [defRows, setDefRows] = useState<DefRow[]>([]);
  const [defLoading, setDefLoading] = useState(true);

  const loadSnapshot = useCallback(async () => {
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
  }, [selectedFacilityId]);

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

    const ids = data.map((d) => d.id);
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
    for (const p of pocs ?? []) {
      if (p.submission_due_date && !dueByDef.has(p.deficiency_id)) {
        dueByDef.set(p.deficiency_id, p.submission_due_date);
      }
    }

    setDefRows(
      data.map((d) => ({
        id: d.id,
        tag_number: d.tag_number,
        severity: d.severity,
        status: d.status,
        submission_due_date: dueByDef.get(d.id) ?? null,
      })),
    );
    setDefLoading(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    void loadDeficiencies();
  }, [loadDeficiencies]);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full pb-12">
      <AmbientMatrix hasCriticals={(snapshot?.openDeficiencies ?? 0) > 0 || (snapshot?.overdueAssessments ?? 0) > 0} 
        primaryClass="bg-indigo-500/10" 
        secondaryClass="bg-red-500/5"
      />

      <div className="relative z-10 space-y-8 max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between py-6">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 08 / Quality & Risk</p>
            <h1 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              Compliance {((snapshot?.openDeficiencies ?? 0) > 0) && <PulseDot colorClass="bg-amber-500" />}
            </h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/compliance/audit-export"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "glass-panel bg-white/50 dark:bg-zinc-900/40 text-[10px] uppercase tracking-widest font-mono text-slate-700 dark:text-slate-300")}
            >
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
          </div>
        </div>

        {!facilityReady ? (
          <div className="rounded-[2rem] glass-panel bg-amber-50/40 dark:bg-amber-950/20 p-8 border border-amber-200/50 dark:border-amber-900/50 backdrop-blur-md">
            <h3 className="text-lg font-display font-semibold text-amber-900 dark:text-amber-300 mb-2">Select a facility</h3>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
              Choose a facility in the header to load compliance metrics for that site.
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

      <div className="grid gap-5 md:grid-cols-2 mt-8">
        <div className="rounded-3xl glass-panel p-6 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
              <Shield className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-display font-semibold text-slate-800 dark:text-slate-200">Survey visit mode</h3>
          </div>
          <p className="text-xs font-medium text-slate-500 mb-4">Use the bar below the header to activate logging while a regulator is on site.</p>
          <div className="bg-white/60 dark:bg-black/30 p-4 rounded-xl border border-white/40 dark:border-white/5 font-mono text-sm text-slate-700 dark:text-slate-300">
             {snapLoading ? "—" : snapshot?.surveyVisitActive ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">● Session active for this facility.</span> : "No active session."}
          </div>
        </div>

        <div className="rounded-3xl glass-panel p-6 border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
              <ClipboardList className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-display font-semibold text-slate-800 dark:text-slate-200">Quick Links</h3>
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
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p className="font-mono text-[11px] uppercase tracking-wider leading-relaxed">
          Tiles aggregate live operational data. Trends and enhanced scoring are out of scope for Core — focus on
          accurate counts and traceable deficiency workflows.
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
