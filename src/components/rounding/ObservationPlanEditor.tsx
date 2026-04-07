"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import type { ObservationPlanInput, PlanRuleInput } from "@/lib/rounding/types";
import type { Database } from "@/types/database";

type ResidentOption = Pick<
  Database["public"]["Tables"]["residents"]["Row"],
  "id" | "first_name" | "last_name" | "preferred_name" | "status"
>;

type ExistingPlan = {
  id: string;
  resident_id: string;
  status: ObservationPlanInput["status"];
  source_type: ObservationPlanInput["sourceType"];
  effective_from: string;
  effective_to: string | null;
  rationale: string | null;
  resident_observation_plan_rules?: Array<{
    id: string;
    interval_type: PlanRuleInput["intervalType"];
    interval_minutes: number | null;
    shift: PlanRuleInput["shift"];
    daypart_start: string | null;
    daypart_end: string | null;
    days_of_week: number[] | null;
    grace_minutes: number;
    escalation_policy_key: string | null;
    active: boolean;
    sort_order: number;
  }>;
};

function blankRule(): PlanRuleInput {
  return {
    intervalType: "fixed_minutes",
    intervalMinutes: 60,
    daypartStart: "07:00",
    daypartEnd: "19:00",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: 15,
    active: true,
    sortOrder: 0,
  };
}

function residentName(resident: ResidentOption) {
  return [resident.preferred_name ?? resident.first_name, resident.last_name].filter(Boolean).join(" ");
}

export function ObservationPlanEditor({
  planId,
  title,
}: {
  planId?: string;
  title: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [residentId, setResidentId] = useState("");
  const [status, setStatus] = useState<ObservationPlanInput["status"]>("active");
  const [sourceType, setSourceType] = useState<ObservationPlanInput["sourceType"]>("manual");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [rationale, setRationale] = useState("");
  const [rules, setRules] = useState<PlanRuleInput[]>([blankRule()]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    if (!selectedFacilityId) {
      setLoading(false);
      return;
    }

    try {
      const { data: residentRows, error: residentError } = await supabase
        .from("residents")
        .select("id, first_name, last_name, preferred_name, status")
        .eq("facility_id", selectedFacilityId)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("last_name");

      if (residentError) throw residentError;
      setResidents((residentRows ?? []) as ResidentOption[]);

      if (planId) {
        const response = await fetch(
          `/api/rounding/plans?planId=${encodeURIComponent(planId)}&facilityId=${encodeURIComponent(selectedFacilityId)}`,
          { cache: "no-store" },
        );
        const json = (await response.json()) as { error?: string; plans?: ExistingPlan[] };
        if (!response.ok) {
          throw new Error(json.error ?? "Could not load observation plan");
        }
        const plan = json.plans?.[0];
        if (!plan) {
          throw new Error("Observation plan not found");
        }
        setResidentId(plan.resident_id);
        setStatus(plan.status ?? "active");
        setSourceType(plan.source_type ?? "manual");
        setEffectiveFrom(plan.effective_from.slice(0, 16));
        setEffectiveTo(plan.effective_to ? plan.effective_to.slice(0, 16) : "");
        setRationale(plan.rationale ?? "");
        setRules(
          (plan.resident_observation_plan_rules ?? [])
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((rule, index) => ({
              id: rule.id,
              intervalType: rule.interval_type,
              intervalMinutes: rule.interval_minutes,
              shift: rule.shift,
              daypartStart: rule.daypart_start,
              daypartEnd: rule.daypart_end,
              daysOfWeek: rule.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
              graceMinutes: rule.grace_minutes,
              escalationPolicyKey: rule.escalation_policy_key,
              active: rule.active,
              sortOrder: index,
            })),
        );
      } else {
        setEffectiveFrom(new Date().toISOString().slice(0, 16));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load observation plan form.");
    } finally {
      setLoading(false);
    }
  }, [planId, selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePlan() {
    if (!selectedFacilityId || !residentId) {
      setError("Select a facility and resident first.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      const payload: ObservationPlanInput = {
        id: planId,
        facilityId: selectedFacilityId,
        residentId,
        status,
        sourceType,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null,
        rationale: rationale.trim() || null,
        rules: rules.map((rule, index) => ({
          ...rule,
          sortOrder: index,
          daysOfWeek: rule.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
        })),
      };

      const response = await fetch("/api/rounding/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { error?: string; planId?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not save observation plan");
      }

      setStatusMessage("Observation plan saved.");
      router.replace(`/admin/rounding/plans/${json.planId ?? planId ?? ""}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save observation plan.");
    } finally {
      setSaving(false);
    }
  }

  if (!selectedFacilityId) {
    return (
      <Card className="border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/30">
        <CardContent className="py-6 text-sm text-amber-950 dark:text-amber-100">
          Select a facility in the header before creating or editing a rounding plan.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500 dark:text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading plan editor…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Set resident cadence, daypart windows, and grace times for facility-scoped rounding tasks.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {statusMessage ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{statusMessage}</p> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Resident">
              <select value={residentId} onChange={(event) => setResidentId(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <option value="">Select resident</option>
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {residentName(resident)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value as ObservationPlanInput["status"])} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>

            <Field label="Source type">
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as ObservationPlanInput["sourceType"])} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <option value="manual">Manual</option>
                <option value="care_plan">Care plan</option>
                <option value="policy">Policy</option>
                <option value="order">Order</option>
                <option value="triggered">Triggered</option>
              </select>
            </Field>

            <Field label="Effective from">
              <input type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
            </Field>

            <Field label="Effective to">
              <input type="datetime-local" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
            </Field>
          </div>

          <Field label="Rationale">
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} className="min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950" placeholder="Why does this resident need this cadence?" />
          </Field>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">Plan rules</h2>
          <Button variant="outline" size="sm" onClick={() => setRules((current) => [...current, { ...blankRule(), sortOrder: current.length }])}>
            <Plus className="mr-1 h-4 w-4" />
            Add rule
          </Button>
        </div>

        {rules.map((rule, index) => (
          <Card key={rule.id ?? `rule-${index}`} className="border-slate-200/80 shadow-soft dark:border-slate-800">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Rule {index + 1}</CardTitle>
                <CardDescription>Configure interval, daypart, and grace.</CardDescription>
              </div>
              {rules.length > 1 ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Delete rule ${index + 1}`} onClick={() => setRules((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                  <Trash2 aria-hidden className="h-4 w-4" />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Interval type">
                <select value={rule.intervalType} onChange={(event) => updateRule(index, { intervalType: event.target.value as PlanRuleInput["intervalType"] })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                  <option value="fixed_minutes">Fixed minutes</option>
                  <option value="per_shift">Per shift</option>
                  <option value="daypart">Daypart</option>
                  <option value="continuous">Continuous</option>
                </select>
              </Field>

              <Field label="Interval minutes">
                <input type="number" min={15} step={15} value={rule.intervalMinutes ?? 60} onChange={(event) => updateRule(index, { intervalMinutes: Number(event.target.value) })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
              </Field>

              <Field label="Daypart start">
                <input type="time" value={rule.daypartStart ?? "07:00"} onChange={(event) => updateRule(index, { daypartStart: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
              </Field>

              <Field label="Daypart end">
                <input type="time" value={rule.daypartEnd ?? "19:00"} onChange={(event) => updateRule(index, { daypartEnd: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
              </Field>

              <Field label="Grace minutes">
                <input type="number" min={0} step={5} value={rule.graceMinutes ?? 15} onChange={(event) => updateRule(index, { graceMinutes: Number(event.target.value) })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950" />
              </Field>

              <Field label="Shift lock (optional)">
                <select value={rule.shift ?? ""} onChange={(event) => updateRule(index, { shift: (event.target.value || null) as PlanRuleInput["shift"] })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                  <option value="">None</option>
                  <option value="day">Day</option>
                  <option value="evening">Evening</option>
                  <option value="night">Night</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button size="lg" className="min-h-11" disabled={saving} onClick={() => void savePlan()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save plan
        </Button>
        <Button variant="outline" size="lg" className="min-h-11" onClick={() => router.push("/admin/rounding/plans")}>
          Back to plans
        </Button>
      </div>
    </div>
  );

  function updateRule(index: number, updates: Partial<PlanRuleInput>) {
    setRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...updates } : rule)));
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}
