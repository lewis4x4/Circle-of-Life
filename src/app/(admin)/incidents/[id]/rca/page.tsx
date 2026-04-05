"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, GitBranch, Save } from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STORAGE_PREFIX = "haven-rca-draft-v1:";

type FactorGroup = {
  title: string;
  description: string;
  options: { id: string; label: string }[];
};

const FACTOR_GROUPS: FactorGroup[] = [
  {
    title: "Contributing factors",
    description: "Aligns with incident contributing_factors vocabulary (spec 07).",
    options: [
      { id: "medication_change", label: "Medication change" },
      { id: "new_footwear", label: "New footwear" },
      { id: "wet_floor", label: "Wet floor" },
      { id: "lighting", label: "Lighting" },
      { id: "unfamiliar_environment", label: "Unfamiliar environment" },
      { id: "cognitive_decline", label: "Cognitive decline" },
      { id: "rushing", label: "Rushing" },
      { id: "staffing", label: "Staffing" },
    ],
  },
  {
    title: "Environmental",
    description: "Physical environment and equipment signals.",
    options: [
      { id: "env_clutter", label: "Clutter / obstacles" },
      { id: "env_equipment", label: "Equipment malfunction" },
      { id: "env_alarm", label: "Alarm / call system" },
      { id: "env_furniture", label: "Furniture layout" },
    ],
  },
  {
    title: "Human factors",
    description: "Communication, training, handoff.",
    options: [
      { id: "hf_handoff", label: "Shift handoff gap" },
      { id: "hf_training", label: "Training / competency" },
      { id: "hf_supervision", label: "Supervision" },
      { id: "hf_communication", label: "Communication breakdown" },
    ],
  },
];

type DraftShape = {
  selected: string[];
  rootCauseNarrative: string;
  correctiveActions: string;
  preventativeActions: string;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

type IncidentMini = {
  id: string;
  facility_id: string;
  organization_id: string;
  incident_number: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
  description: string;
  contributing_factors: string[] | null;
};

export default function AdminIncidentRcaPage() {
  const params = useParams();
  const rawId = params?.id;
  const incidentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incident, setIncident] = useState<IncidentMini | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rootCauseNarrative, setRootCauseNarrative] = useState("");
  const [correctiveActions, setCorrectiveActions] = useState("");
  const [preventativeActions, setPreventativeActions] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);

  const storageKey = `${STORAGE_PREFIX}${incidentId}`;

  const loadIncident = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setIncident(null);

    if (!incidentId || !UUID_RE.test(incidentId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const res = (await supabase
        .from("incidents" as never)
        .select(
          "id, facility_id, organization_id, incident_number, category, severity, status, occurred_at, description, contributing_factors",
        )
        .eq("id", incidentId)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<IncidentMini>;

      if (res.error) throw res.error;
      const row = res.data;
      if (!row) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (isValidFacilityIdForQuery(selectedFacilityId) && row.facility_id !== selectedFacilityId) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setIncident(row);

      const rcaRes = (await supabase
        .from("incident_rca" as never)
        .select(
          "contributing_factor_tags, root_cause_narrative, corrective_actions, preventative_actions",
        )
        .eq("incident_id", row.id)
        .maybeSingle()) as unknown as QueryResult<{
        contributing_factor_tags: string[] | null;
        root_cause_narrative: string | null;
        corrective_actions: string | null;
        preventative_actions: string | null;
      }>;

      if (rcaRes.error) throw rcaRes.error;
      const rca = rcaRes.data;

      let initialSelected = new Set<string>(row.contributing_factors ?? []);
      let narrative = "";
      let corrective = "";
      let preventative = "";

      if (rca) {
        initialSelected = new Set(rca.contributing_factor_tags ?? []);
        narrative = rca.root_cause_narrative ?? "";
        corrective = rca.corrective_actions ?? "";
        preventative = rca.preventative_actions ?? "";
      } else if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as DraftShape;
            if (Array.isArray(parsed.selected)) {
              initialSelected = new Set([...initialSelected, ...parsed.selected]);
            }
            if (typeof parsed.rootCauseNarrative === "string") narrative = parsed.rootCauseNarrative;
            if (typeof parsed.correctiveActions === "string") corrective = parsed.correctiveActions;
            if (typeof parsed.preventativeActions === "string") preventative = parsed.preventativeActions;
          }
        } catch {
          /* ignore corrupt draft */
        }
      }

      setSelected(initialSelected);
      setRootCauseNarrative(narrative);
      setCorrectiveActions(corrective);
      setPreventativeActions(preventative);
    } catch {
      setError("Could not load this incident for RCA.");
    } finally {
      setLoading(false);
    }
  }, [incidentId, selectedFacilityId, storageKey]);

  useEffect(() => {
    void loadIncident();
  }, [loadIncident]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveRca = useCallback(async () => {
    if (!incident) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to save RCA.");
        return;
      }

      const payload = {
        incident_id: incident.id,
        organization_id: incident.organization_id,
        facility_id: incident.facility_id,
        contributing_factor_tags: [...selected],
        root_cause_narrative: rootCauseNarrative,
        corrective_actions: correctiveActions,
        preventative_actions: preventativeActions,
        updated_by: user.id,
      };

      const existing = (await supabase
        .from("incident_rca" as never)
        .select("id")
        .eq("incident_id", incident.id)
        .maybeSingle()) as unknown as QueryResult<{ id: string }>;

      if (existing.error) throw existing.error;

      if (existing.data?.id) {
        const up = (await supabase
          .from("incident_rca" as never)
          .update({
            contributing_factor_tags: payload.contributing_factor_tags,
            root_cause_narrative: payload.root_cause_narrative,
            corrective_actions: payload.corrective_actions,
            preventative_actions: payload.preventative_actions,
            updated_by: user.id,
          } as never)
          .eq("id", existing.data.id)) as unknown as QueryResult<unknown>;
        if (up.error) throw up.error;
      } else {
        const ins = (await supabase.from("incident_rca" as never).insert({
          ...payload,
          created_by: user.id,
        } as never)) as unknown as QueryResult<unknown>;
        if (ins.error) throw ins.error;
      }

      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save RCA.");
    } finally {
      setSaving(false);
    }
  }, [
    incident,
    selected,
    rootCauseNarrative,
    correctiveActions,
    preventativeActions,
    storageKey,
  ]);

  const textareaClass = cn(
    "min-h-[120px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-colors",
    "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
  );

  const allOptionIds = useMemo(
    () => new Set(FACTOR_GROUPS.flatMap((g) => g.options.map((o) => o.id))),
    [],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <Link
          href={`/admin/incidents/${incidentId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Incident detail
        </Link>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Link href="/admin/incidents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Incident queue
        </Link>
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadIncident()} />
      </div>
    );
  }

  if (notFound || !incident) {
    return (
      <div className="space-y-6">
        <Link href="/admin/incidents" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}>
          <ArrowLeft className="h-4 w-4" />
          Incident queue
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>RCA unavailable</CardTitle>
            <CardDescription>Incident not found or outside your facility filter.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Link
            href={`/admin/incidents/${incident.id}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 px-0")}
          >
            <ArrowLeft className="h-4 w-4" />
            {incident.incident_number}
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 dark:border-violet-900/50 dark:bg-violet-950/40">
              <GitBranch className="h-5 w-5 text-violet-700 dark:text-violet-300" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Root cause workspace
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Structured RCA per spec 07 — saved to the incident record (audit trail on save).
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {incident.incident_number}
          </Badge>
          <Button
            type="button"
            size="sm"
            onClick={() => void saveRca()}
            disabled={saving}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {savedFlash ? "Saved" : saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Incident snapshot</CardTitle>
          <CardDescription>Read-only context from the master record</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
          <p>
            <span className="text-slate-500 dark:text-slate-400">Occurred:</span>{" "}
            {new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(incident.occurred_at))}
          </p>
          <p>
            <span className="text-slate-500 dark:text-slate-400">Category:</span>{" "}
            {incident.category.replace(/_/g, " ")}
          </p>
          <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-400">{incident.description}</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {FACTOR_GROUPS.map((group) => (
          <Card key={group.title} className="border-slate-200/70 dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-base">{group.title}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {group.options.map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 p-2.5 text-sm dark:border-slate-800 dark:bg-slate-900/40"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    checked={selected.has(opt.id)}
                    onChange={() => toggle(opt.id)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200/70 dark:border-slate-800 lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-display text-lg">Analysis &amp; actions</CardTitle>
          <CardDescription>Stored with the incident; visible to authorized staff across devices.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Root cause narrative
            </label>
            <textarea
              className={cn(textareaClass, "mt-1.5 min-h-[100px]")}
              value={rootCauseNarrative}
              onChange={(e) => setRootCauseNarrative(e.target.value)}
              placeholder="Summarize the most likely root cause chain…"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Corrective actions (immediate)
            </label>
            <textarea
              className={cn(textareaClass, "mt-1.5")}
              value={correctiveActions}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              placeholder="What will be done now to stabilize risk…"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Preventative actions (systemic)
            </label>
            <textarea
              className={cn(textareaClass, "mt-1.5")}
              value={preventativeActions}
              onChange={(e) => setPreventativeActions(e.target.value)}
              placeholder="Policy, training, environment, or monitoring changes…"
            />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Factors from the incident record that are not in the checklist above remain in the database; selected IDs
        here may include both checklist keys and legacy values ({[...selected].filter((id) => !allOptionIds.has(id)).length}{" "}
        extra).
      </p>
    </div>
  );
}
