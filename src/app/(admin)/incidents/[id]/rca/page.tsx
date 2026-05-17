"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, RotateCcw, Save } from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

const STORAGE_PREFIX = "haven-rca-draft-v1:";

/** Minimum content before attesting investigation complete (UAT / audit bar). */
const MIN_ROOT_LEN = 40;
const MIN_CORRECTIVE_LEN = 30;
const MIN_PREVENTATIVE_LEN = 30;

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
  resident_id: string | null;
  incident_number: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
  description: string;
  contributing_factors: string[] | null;
};

function validateRcaCompletion(d: {
  selectedCount: number;
  rootCauseNarrative: string;
  correctiveActions: string;
  preventativeActions: string;
}): string[] {
  const errors: string[] = [];
  if (d.selectedCount < 1) {
    errors.push("Select at least one contributing factor.");
  }
  if (d.rootCauseNarrative.trim().length < MIN_ROOT_LEN) {
    errors.push(`Root cause narrative must be at least ${MIN_ROOT_LEN} characters.`);
  }
  if (d.correctiveActions.trim().length < MIN_CORRECTIVE_LEN) {
    errors.push(`Corrective actions must be at least ${MIN_CORRECTIVE_LEN} characters.`);
  }
  if (d.preventativeActions.trim().length < MIN_PREVENTATIVE_LEN) {
    errors.push(`Preventative actions must be at least ${MIN_PREVENTATIVE_LEN} characters.`);
  }
  return errors;
}

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
  const [investigationStatus, setInvestigationStatus] = useState<"none" | "draft" | "complete">("none");
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [completerName, setCompleterName] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [completionErrors, setCompletionErrors] = useState<string[]>([]);
  const [followupActionLoading, setFollowupActionLoading] = useState<"corrective" | "preventative" | null>(null);
  const [followupActionMessage, setFollowupActionMessage] = useState<string | null>(null);

  const storageKey = `${STORAGE_PREFIX}${incidentId}`;
  const locked = investigationStatus === "complete";

  const loadIncident = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setIncident(null);
    setInvestigationStatus("none");
    setCompletedAt(null);
    setCompleterName(null);
    setCompletionErrors([]);

    if (!incidentId || !UUID_STRING_RE.test(incidentId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const res = (await supabase
        .from("incidents" as never)
        .select(
          "id, facility_id, organization_id, resident_id, incident_number, category, severity, status, occurred_at, description, contributing_factors",
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
          "contributing_factor_tags, root_cause_narrative, corrective_actions, preventative_actions, investigation_status, completed_at, completed_by",
        )
        .eq("incident_id", row.id)
        .maybeSingle()) as unknown as QueryResult<{
        contributing_factor_tags: string[] | null;
        root_cause_narrative: string | null;
        corrective_actions: string | null;
        preventative_actions: string | null;
        investigation_status: string | null;
        completed_at: string | null;
        completed_by: string | null;
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

      if (rca) {
        const inv = rca.investigation_status === "complete" ? "complete" : "draft";
        setInvestigationStatus(inv);
        setCompletedAt(rca.completed_at);
        if (rca.completed_by) {
          const prof = (await supabase
            .from("user_profiles" as never)
            .select("full_name")
            .eq("id", rca.completed_by)
            .maybeSingle()) as unknown as QueryResult<{ full_name: string | null }>;
          if (prof.error) throw prof.error;
          setCompleterName(prof.data?.full_name?.trim() || "Staff");
        } else {
          setCompleterName(null);
        }
      } else {
        setInvestigationStatus("none");
        setCompletedAt(null);
        setCompleterName(null);
      }
      setCompletionErrors([]);
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
    if (!incident || locked) return;
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
          investigation_status: "draft",
          created_by: user.id,
        } as never)) as unknown as QueryResult<unknown>;
        if (ins.error) throw ins.error;
      }

      setInvestigationStatus("draft");

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
    locked,
    selected,
    rootCauseNarrative,
    correctiveActions,
    preventativeActions,
    storageKey,
  ]);

  const completeInvestigation = useCallback(async () => {
    if (!incident || locked) return;
    const errs = validateRcaCompletion({
      selectedCount: selected.size,
      rootCauseNarrative,
      correctiveActions,
      preventativeActions,
    });
    if (errs.length) {
      setCompletionErrors(errs);
      return;
    }
    setCompletionErrors([]);
    setCompleting(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to complete the investigation.");
        return;
      }

      const now = new Date().toISOString();
      const content = {
        contributing_factor_tags: [...selected],
        root_cause_narrative: rootCauseNarrative,
        corrective_actions: correctiveActions,
        preventative_actions: preventativeActions,
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
            ...content,
            investigation_status: "complete",
            completed_at: now,
            completed_by: user.id,
            updated_by: user.id,
          } as never)
          .eq("id", existing.data.id)) as unknown as QueryResult<unknown>;
        if (up.error) throw up.error;
      } else {
        const ins = (await supabase.from("incident_rca" as never).insert({
          incident_id: incident.id,
          organization_id: incident.organization_id,
          facility_id: incident.facility_id,
          ...content,
          investigation_status: "complete",
          completed_at: now,
          completed_by: user.id,
          created_by: user.id,
          updated_by: user.id,
        } as never)) as unknown as QueryResult<unknown>;
        if (ins.error) throw ins.error;
      }

      setInvestigationStatus("complete");
      setCompletedAt(now);
      const prof = (await supabase
        .from("user_profiles" as never)
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle()) as unknown as QueryResult<{ full_name: string | null }>;
      setCompleterName(prof.data?.full_name?.trim() || "Staff");

      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete investigation.");
    } finally {
      setCompleting(false);
    }
  }, [
    incident,
    locked,
    selected,
    rootCauseNarrative,
    correctiveActions,
    preventativeActions,
    storageKey,
  ]);

  const reopenInvestigation = useCallback(async () => {
    if (!incident || investigationStatus !== "complete") return;
    setReopening(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to reopen the investigation.");
        return;
      }

      const up = (await supabase
        .from("incident_rca" as never)
        .update({
          investigation_status: "draft",
          completed_at: null,
          completed_by: null,
          updated_by: user.id,
        } as never)
        .eq("incident_id", incident.id)) as unknown as QueryResult<unknown>;
      if (up.error) throw up.error;

      setInvestigationStatus("draft");
      setCompletedAt(null);
      setCompleterName(null);
      setCompletionErrors([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen investigation.");
    } finally {
      setReopening(false);
    }
  }, [incident, investigationStatus]);

  const textareaClass = cn(
    "min-h-[120px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-colors",
    "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
  );

  const allOptionIds = useMemo(
    () => new Set(FACTOR_GROUPS.flatMap((g) => g.options.map((o) => o.id))),
    [],
  );

  const createRcaFollowup = useCallback(async (kind: "corrective" | "preventative") => {
    if (!incident || locked) return;
    const description = kind === "corrective" ? correctiveActions.trim() : preventativeActions.trim();
    if (!description) {
      setError(`Add ${kind} actions before creating a follow-up task.`);
      return;
    }
    setFollowupActionLoading(kind);
    setError(null);
    setFollowupActionMessage(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to create follow-up tasks.");
        return;
      }

      const taskType = kind === "corrective" ? "root_cause_corrective_action" : "root_cause_preventative_action";
      const dueAt = new Date();
      if (kind === "corrective") {
        dueAt.setDate(dueAt.getDate() + 1);
      } else {
        dueAt.setDate(dueAt.getDate() + 7);
      }

      const existing = (await supabase
        .from("incident_followups" as never)
        .select("id")
        .eq("incident_id", incident.id)
        .eq("task_type", taskType)
        .eq("description", description)
        .is("deleted_at", null)
        .is("completed_at", null)
        .maybeSingle()) as unknown as QueryResult<{ id: string }>;
      if (existing.error) throw existing.error;
      if (existing.data?.id) {
        setFollowupActionMessage(`${kind === "corrective" ? "Corrective" : "Preventative"} follow-up already exists.`);
        return;
      }

      const insert = (await supabase
        .from("incident_followups" as never)
        .insert({
          incident_id: incident.id,
          resident_id: incident.resident_id,
          facility_id: incident.facility_id,
          organization_id: incident.organization_id,
          task_type: taskType,
          description,
          due_at: dueAt.toISOString(),
        } as never)) as unknown as QueryResult<unknown>;
      if (insert.error) throw insert.error;
      setFollowupActionMessage(`${kind === "corrective" ? "Corrective" : "Preventative"} follow-up queued.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create RCA follow-up.");
    } finally {
      setFollowupActionLoading(null);
    }
  }, [incident, locked, correctiveActions, preventativeActions]);

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
        <RecordDetailSection title="RCA unavailable" description="Incident not found or outside your facility filter.">
          <span />
        </RecordDetailSection>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
      <RecordDetailHeader
        title="Root cause workspace"
        subtitle="Structured RCA per spec 07 — persisted on save; marking complete records operator attestation (not a regulatory sign-off)."
        statusChips={
          <>
            <Badge variant="outline" className="tabular-nums text-xs">
              {incident.incident_number}
            </Badge>
            {investigationStatus === "complete" ? (
              <Badge variant="outline" className="border-success/20 bg-success/10 text-success">
                Investigation complete
              </Badge>
            ) : investigationStatus === "draft" ? (
              <Badge variant="outline" className="font-normal">
                Draft
              </Badge>
            ) : (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Not saved
              </Badge>
            )}
          </>
        }
        backLink={{ label: incident.incident_number, href: `/admin/incidents/${incident.id}` }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!locked ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => void saveRca()} disabled={saving} className="gap-1.5">
                  <Save className="h-3.5 w-3.5" />
                  {savedFlash ? "Saved" : saving ? "Saving…" : "Save draft"}
                </Button>
                <Button type="button" size="sm" onClick={() => void completeInvestigation()} disabled={completing} className="gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {completing ? "Completing…" : "Mark investigation complete"}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => void reopenInvestigation()} disabled={reopening} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                {reopening ? "Reopening…" : "Reopen for edits"}
              </Button>
            )}
          </div>
        }
      />

      {locked && completedAt ? (
        <div className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-4 text-sm text-success">
          <p className="font-medium">This investigation is marked complete.</p>
          <p className="mt-1 tabular-nums">
            {new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(completedAt))}
            {completerName ? ` · ${completerName}` : ""}
          </p>
          <p className="mt-2 text-xs opacity-80">
            Reopen only if corrections are required; changes after completion should be rare and documented in
            follow-up tasks when applicable.
          </p>
        </div>
      ) : null}

      {completionErrors.length > 0 ? (
        <div className="rounded-[8px] border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium">Before you can mark complete:</p>
          <ul className="mt-2 list-inside list-disc space-y-1 opacity-90">
            {completionErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {followupActionMessage ? (
        <div className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          {followupActionMessage}
        </div>
      ) : null}

      {!locked ? (
        <RecordDetailSection
          title="Completion checklist"
          description="All items must pass to attest investigation complete (UAT / audit bar)."
        >
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>At least one contributing factor selected ({selected.size} selected)</li>
            <li>Root cause narrative ≥ {MIN_ROOT_LEN} characters (currently {rootCauseNarrative.trim().length})</li>
            <li>Corrective actions ≥ {MIN_CORRECTIVE_LEN} characters (currently {correctiveActions.trim().length})</li>
            <li>Preventative actions ≥ {MIN_PREVENTATIVE_LEN} characters (currently{" "}
            {preventativeActions.trim().length})</li>
          </ul>
        </RecordDetailSection>
      ) : null}

      <RecordDetailSection title="Incident snapshot" description="Read-only context from the master record">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="text-muted-foreground">Occurred:</span>{" "}
            <span className="tabular-nums text-foreground">{new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(incident.occurred_at))}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Category:</span>{" "}
            <span className="text-foreground">{incident.category.replace(/_/g, " ")}</span>
          </p>
          <p className="whitespace-pre-wrap">{incident.description}</p>
        </div>
      </RecordDetailSection>

      <div className="grid gap-6 lg:grid-cols-2">
        {FACTOR_GROUPS.map((group) => (
          <RecordDetailSection key={group.title} title={group.title} description={group.description}>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.options.map((opt) => (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-start gap-2 rounded-[8px] border border-border bg-muted/50 p-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 rounded border-border text-primary focus:ring-ring"
                    checked={selected.has(opt.id)}
                    disabled={locked}
                    onChange={() => toggle(opt.id)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </RecordDetailSection>
        ))}
      </div>

      <RecordDetailSection
        title="Analysis &amp; actions"
        description="Stored with the incident; visible to authorized staff across devices."
      >
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Root cause narrative
            </label>
            <textarea
              className={cn(textareaClass, "mt-1.5 min-h-[100px]")}
              value={rootCauseNarrative}
              disabled={locked}
              onChange={(e) => setRootCauseNarrative(e.target.value)}
              placeholder="Summarize the most likely root cause chain…"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Corrective actions (immediate)
            </label>
            <textarea
              className={cn(textareaClass, "mt-1.5")}
              value={correctiveActions}
              disabled={locked}
              onChange={(e) => setCorrectiveActions(e.target.value)}
              placeholder="What will be done now to stabilize risk…"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Preventative actions (systemic)
            </label>
            <textarea
              className={cn(textareaClass, "mt-1.5")}
              value={preventativeActions}
              disabled={locked}
              onChange={(e) => setPreventativeActions(e.target.value)}
              placeholder="Policy, training, environment, or monitoring changes…"
            />
          </div>
          {!locked ? (
            <div className="rounded-[8px] border border-info/20 bg-info/10 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-info">
                Operationalize RCA
              </p>
              <p className="mt-1 text-sm text-foreground">
                Turn corrective or preventative action text into follow-up tasks on the incident workspace.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={followupActionLoading !== null || correctiveActions.trim().length < MIN_CORRECTIVE_LEN}
                  onClick={() => void createRcaFollowup("corrective")}
                >
                  {followupActionLoading === "corrective" ? "Queueing…" : "Queue corrective follow-up"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={followupActionLoading !== null || preventativeActions.trim().length < MIN_PREVENTATIVE_LEN}
                  onClick={() => void createRcaFollowup("preventative")}
                >
                  {followupActionLoading === "preventative" ? "Queueing…" : "Queue preventative follow-up"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </RecordDetailSection>

      <p className="text-xs text-muted-foreground">
        Factors from the incident record that are not in the checklist above remain in the database; selected IDs
        here may include both checklist keys and legacy values ({[...selected].filter((id) => !allOptionIds.has(id)).length}{" "}
        extra).
      </p>
    </div>
  );
}
