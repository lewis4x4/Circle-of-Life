"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ClipboardList,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/demo-mode";
import { cn } from "@/lib/utils";

type PlanRow = {
  id: string;
  status: string;
  source_type: string;
  effective_from: string;
  rationale: string | null;
  residents?: { first_name: string | null; last_name: string | null; preferred_name: string | null; room_number?: string | null } | null;
  resident_observation_plan_rules?: { id: string }[];
};

function displayName(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null].filter(Boolean).join(" ");
}

const DEMO_PLANS: PlanRow[] = [
  { id: "p1", status: "active", source_type: "clinical_order", effective_from: new Date(Date.now() - 7 * 86400000).toISOString(), rationale: "Fall risk protocol — Q2H checks during day shift, Q4H overnight", residents: { first_name: "Dorothy", last_name: "Henderson", preferred_name: "Dot", room_number: "112A" }, resident_observation_plan_rules: [{ id: "r1" }, { id: "r2" }] },
  { id: "p2", status: "active", source_type: "admission_default", effective_from: new Date(Date.now() - 14 * 86400000).toISOString(), rationale: "Standard new admission monitoring — first 72 hours", residents: { first_name: "Robert", last_name: "Chen", preferred_name: "Bob", room_number: "204B" }, resident_observation_plan_rules: [{ id: "r3" }] },
  { id: "p3", status: "active", source_type: "clinical_order", effective_from: new Date(Date.now() - 3 * 86400000).toISOString(), rationale: "Post-medication change monitoring — blood pressure checks Q4H", residents: { first_name: "Eleanor", last_name: "Vasquez", preferred_name: null, room_number: "118" }, resident_observation_plan_rules: [{ id: "r4" }, { id: "r5" }, { id: "r6" }] },
  { id: "p4", status: "active", source_type: "family_request", effective_from: new Date(Date.now() - 30 * 86400000).toISOString(), rationale: "Family requested additional night checks — wandering concern", residents: { first_name: "Harold", last_name: "Mitchell", preferred_name: "Harry", room_number: "301A" }, resident_observation_plan_rules: [{ id: "r7" }] },
  { id: "p5", status: "paused", source_type: "clinical_order", effective_from: new Date(Date.now() - 21 * 86400000).toISOString(), rationale: "Behavioral observation — currently paused per MD review", residents: { first_name: "Margaret", last_name: "Thompson", preferred_name: "Peggy", room_number: "215" }, resident_observation_plan_rules: [{ id: "r8" }, { id: "r9" }] },
  { id: "p6", status: "active", source_type: "survey_visit", effective_from: new Date(Date.now() - 1 * 86400000).toISOString(), rationale: "Survey visit active — enhanced monitoring per state protocol", residents: { first_name: "William", last_name: "O'Brien", preferred_name: "Bill", room_number: "102" }, resident_observation_plan_rules: [{ id: "r10" }] },
];

export default function AdminRoundingPlansPage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = useMemo(() => createClient(), []);
  const demo = isDemoMode();
  const emptyPlansFallback = useMemo<PlanRow[]>(() => [], []);
  const fallbackPlans = demo ? DEMO_PLANS : emptyPlansFallback;
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [plans, setPlans] = useState<PlanRow[]>(() => (isDemoMode() ? DEMO_PLANS : []));

  const load = useCallback(async () => {
    setLoading(true);

    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setPlans(fallbackPlans);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("resident_observation_plans")
        .select("id, status, source_type, effective_from, rationale, residents ( first_name, last_name, preferred_name, room_number ), resident_observation_plan_rules ( id )")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("effective_from", { ascending: false });

      if (error) throw error;
      const rows = (data ?? []) as unknown as PlanRow[];
      setPlans(rows.length > 0 ? rows : fallbackPlans);
    } catch {
      setPlans(fallbackPlans);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId, supabase, fallbackPlans]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generateTasks() {
    if (!selectedFacilityId) return;
    setGenerating(true);
    try {
      const now = new Date();
      const response = await fetch("/api/rounding/generate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: selectedFacilityId,
          windowStart: now.toISOString(),
          windowEnd: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
        }),
      });
      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        throw new Error(json.error ?? "Could not generate rounding tasks");
      }
      await load();
    } catch {
      // silently handled — user can retry
    } finally {
      setGenerating(false);
    }
  }

  const activeCount = plans.filter((p) => p.status === "active").length;
  const totalRules = plans.reduce((sum, p) => sum + (p.resident_observation_plan_rules?.length ?? 0), 0);

  const sourceTypeLabel: Record<string, string> = {
    clinical_order: "Clinical Order",
    admission_default: "Admission Default",
    family_request: "Family Request",
    survey_visit: "Survey Visit",
    manual: "Manual",
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix primaryClass="bg-indigo-700/10" secondaryClass="bg-cyan-900/10" />

      <div className="relative z-10 space-y-6">
        <header className="mb-6 mt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6 mb-4">
            <div>
              <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Care Plans</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Observation Plans
              </h2>
              <p className="text-sm text-slate-500 mt-1 dark:text-slate-400">
                Manage resident cadence, active rules, and shift-ready task generation
              </p>
            </div>
            <div className="hidden md:block">
              <RoundingHubNav />
            </div>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 gap-4 sm:grid-cols-3" staggerMs={50}>
          <div className="h-[90px]">
            <V2Card hoverColor="indigo" className="border-indigo-500/20">
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-indigo-400">Active Plans</h3>
                <p className="text-2xl font-mono tracking-tighter text-indigo-400 pb-1">{activeCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[90px]">
            <V2Card hoverColor="cyan" className="border-cyan-500/20">
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-cyan-400">Total Rules</h3>
                <p className="text-2xl font-mono tracking-tighter text-cyan-400 pb-1">{totalRules}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[90px]">
            <V2Card hoverColor="emerald" className="border-emerald-500/20">
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-400">Total Plans</h3>
                <p className="text-2xl font-mono tracking-tighter text-emerald-400 pb-1">{plans.length}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void load()}
            disabled={loading}
            variant="outline"
            className="border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => void generateTasks()}
            disabled={!selectedFacilityId || generating}
            className="border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40"
          >
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Generate next 8 hours
          </Button>
          <Link
            href="/admin/rounding/plans/new"
            className={cn(buttonVariants({ variant: "outline" }), "border-indigo-700/50 bg-indigo-950/30 text-indigo-200 hover:bg-indigo-900/40")}
          >
            <Plus className="mr-2 h-4 w-4" />
            New plan
          </Link>
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 gap-4" staggerMs={40} baseDelayMs={150}>
          {plans.map((plan) => (
            <Link key={plan.id} href={`/admin/rounding/plans/${plan.id}`} className="block group">
              <div className={cn(
                "relative overflow-hidden rounded-[14px] border p-5 transition-all duration-300 h-full",
                "bg-white/5 backdrop-blur-md dark:bg-[#0A0A0A]/50",
                "dark:border-slate-800/80 dark:hover:border-slate-600/80",
                plan.status === "active" ? "border-indigo-500/20" : "border-slate-700/30 opacity-70",
              )}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ClipboardList aria-hidden className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span className="font-medium text-slate-100 truncate">
                      {displayName(plan.residents) || "Resident"}
                    </span>
                    {(plan.residents as PlanRow["residents"] & { room_number?: string | null })?.room_number && (
                      <span className="text-[10px] font-mono tracking-wider text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded shrink-0">
                        RM {(plan.residents as PlanRow["residents"] & { room_number?: string | null })?.room_number}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={plan.status === "active" ? "default" : "outline"} className="text-[10px]">
                      {plan.status === "active" && <PulseDot colorClass="bg-emerald-400" className="mr-1" />}
                      {plan.status}
                    </Badge>
                  </div>
                </div>

                {plan.rationale && (
                  <p className="text-xs text-slate-400 leading-relaxed mb-3 line-clamp-2">{plan.rationale}</p>
                )}

                <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1">
                    <Settings2 aria-hidden className="h-3 w-3" />
                    {sourceTypeLabel[plan.source_type] ?? plan.source_type}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays aria-hidden className="h-3 w-3" />
                    {new Date(plan.effective_from).toLocaleDateString()}
                  </span>
                  <span>{plan.resident_observation_plan_rules?.length ?? 0} rules</span>
                </div>
              </div>
            </Link>
          ))}

          {plans.length === 0 && (
            <div className="col-span-full rounded-[14px] border border-slate-800/50 bg-slate-900/30 p-12 text-center">
              <ClipboardList aria-hidden className="mx-auto h-8 w-8 text-slate-600 mb-3" />
              <p className="text-sm text-slate-400">No observation plans found.</p>
              <p className="text-xs text-slate-600 mt-1">Create a plan to start generating rounding tasks.</p>
            </div>
          )}
        </KineticGrid>

        <div className="block md:hidden pt-2">
          <RoundingHubNav />
        </div>
      </div>
    </div>
  );
}
