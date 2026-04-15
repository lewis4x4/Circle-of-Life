"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardList, GitBranch, Loader2, MapPin, ShieldAlert, User } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  fetchIncidentFollowupAssignees,
  type IncidentFollowupAssigneeOption,
} from "@/lib/incidents/followup-assignees";
import {
  classifyFollowupEscalation,
  followupEscalationLabel,
  isFollowupEscalated,
  type FollowupEscalationLevel,
} from "@/lib/incidents/followup-escalation";

type IncidentSeverityUi = "level_1" | "level_2" | "level_3" | "level_4";
type IncidentStatusUi = "open" | "in_review" | "closed";
type IncidentCategoryUi = "fall" | "medication_error" | "behavioral" | "elopement" | "other";

type SupabaseIncident = {
  id: string;
  facility_id: string;
  resident_id: string | null;
  incident_number: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
  discovered_at: string;
  shift: string;
  location_description: string;
  location_type: string | null;
  description: string;
  immediate_actions: string;
  contributing_factors: string[] | null;
  injury_occurred: boolean;
  injury_description: string | null;
  injury_severity: string | null;
  injury_body_location: string | null;
  fall_witnessed: boolean | null;
  fall_type: string | null;
  fall_activity: string | null;
  reported_by: string;
  witness_names: string[] | null;
  nurse_notified: boolean;
  nurse_notified_at: string | null;
  administrator_notified: boolean;
  administrator_notified_at: string | null;
  owner_notified: boolean;
  owner_notified_at: string | null;
  physician_notified: boolean;
  physician_notified_at: string | null;
  family_notified: boolean;
  family_notified_at: string | null;
  ahca_reportable: boolean;
  ahca_reported: boolean;
  ahca_reported_at: string | null;
  insurance_reportable: boolean;
  insurance_reported: boolean;
  insurance_reported_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  care_plan_updated: boolean;
  care_plan_update_notes: string | null;
  updated_at: string | null;
};

type SupabaseFollowup = {
  id: string;
  task_type: string;
  description: string;
  due_at: string;
  completed_at: string | null;
  assigned_to: string | null;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type SupabaseProfileMini = {
  id: string;
  full_name: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

type RcaInvestigationUi = "none" | "draft" | "complete";

type DetailView = {
  incident: SupabaseIncident;
  residentName: string | null;
  reporterName: string;
  categoryUi: IncidentCategoryUi;
  severityUi: IncidentSeverityUi;
  statusUi: IncidentStatusUi;
  rcaInvestigation: RcaInvestigationUi;
  followups: Array<{
    id: string;
    taskType: string;
    description: string;
    dueLabel: string;
    statusLabel: string;
    assignedToId: string | null;
    assignee: string;
    isCompleted: boolean;
    isOverdue: boolean;
    hoursOverdue: number;
    escalationLevel: FollowupEscalationLevel;
  }>;
};

export default function AdminIncidentDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const incidentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [followupActionLoading, setFollowupActionLoading] = useState<string | null>(null);
  const [followupActionError, setFollowupActionError] = useState<string | null>(null);
  const [followupActionMessage, setFollowupActionMessage] = useState<string | null>(null);
  const [assigneeOptions, setAssigneeOptions] = useState<IncidentFollowupAssigneeOption[]>([]);
  const [followupAssigneeDrafts, setFollowupAssigneeDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setDetail(null);

    if (!incidentId || !UUID_STRING_RE.test(incidentId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const row = await fetchIncidentDetail(incidentId, selectedFacilityId);
      if (!row) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setDetail(row);
      setFollowupAssigneeDrafts(
        Object.fromEntries(row.followups.map((followup) => [followup.id, followup.assignedToId ?? ""])),
      );
      try {
        const options = await fetchIncidentFollowupAssignees(row.incident.facility_id);
        setAssigneeOptions(options);
      } catch {
        setAssigneeOptions([]);
      }
    } catch {
      setError("Incident record could not be loaded. Try again or return to the queue.");
    } finally {
      setLoading(false);
    }
  }, [incidentId, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href="/admin/incidents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Incident queue
        </Link>
        <AdminTableLoadingState />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href="/admin/incidents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to queue
        </Link>
        <AdminEmptyState
          title="Incident not found"
          description="The record may be outside your facility filter, archived, or the link may be invalid."
        />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Link
          href="/admin/incidents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to queue
        </Link>
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}
      </div>
    );
  }

  const { incident, residentName, reporterName, categoryUi, severityUi, statusUi, rcaInvestigation, followups } =
    detail;
  const openObligations = buildIncidentOpenObligations(incident);

  async function assignFollowupToMe(followupId: string) {
    if (!user) return;
    setFollowupActionLoading(followupId);
    setFollowupActionError(null);
    setFollowupActionMessage(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({
          assigned_to: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", followupId);
      if (updateError) throw updateError;
      setFollowupActionMessage("Follow-up assigned to you.");
      await load();
    } catch (actionError) {
      setFollowupActionError(actionError instanceof Error ? actionError.message : "Could not assign follow-up.");
    } finally {
      setFollowupActionLoading(null);
    }
  }

  async function saveFollowupAssignee(followupId: string) {
    setFollowupActionLoading(followupId);
    setFollowupActionError(null);
    setFollowupActionMessage(null);
    try {
      const supabase = createClient();
      const assigneeId = followupAssigneeDrafts[followupId] || null;
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({
          assigned_to: assigneeId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", followupId);
      if (updateError) throw updateError;
      setFollowupActionMessage(assigneeId ? "Follow-up assignee saved." : "Follow-up assignee cleared.");
      await load();
    } catch (actionError) {
      setFollowupActionError(actionError instanceof Error ? actionError.message : "Could not save assignee.");
    } finally {
      setFollowupActionLoading(null);
    }
  }

  async function completeFollowup(followupId: string) {
    if (!user) return;
    setFollowupActionLoading(followupId);
    setFollowupActionError(null);
    setFollowupActionMessage(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("incident_followups")
        .update({
          completed_at: new Date().toISOString(),
          completed_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", followupId);
      if (updateError) throw updateError;
      setFollowupActionMessage("Follow-up marked complete.");
      await load();
    } catch (actionError) {
      setFollowupActionError(actionError instanceof Error ? actionError.message : "Could not complete follow-up.");
    } finally {
      setFollowupActionLoading(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <Link
            href="/admin/incidents"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "inline-flex w-fit gap-1 px-0 sm:px-3",
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Queue
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-200/50 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30">
              <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {incident.incident_number}
              </p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
                Incident detail
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {formatCategoryRaw(incident.category)} · Updated {formatTs(incident.updated_at)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <CategoryBadge category={categoryUi} />
            <SeverityBadge severity={severityUi} />
            <StatusBadge status={statusUi} />
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-col items-end gap-1.5">
            <Link
              href={`/admin/incidents/${incident.id}/rca`}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "border-violet-200 bg-violet-50/50 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-100",
              )}
            >
              <GitBranch className="mr-2 h-3.5 w-3.5" />
              Root cause workspace
            </Link>
            {rcaInvestigation === "complete" ? (
              <Badge
                variant="outline"
                className="border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                RCA investigation complete
              </Badge>
            ) : rcaInvestigation === "draft" ? (
              <Badge variant="outline" className="font-normal text-slate-600 dark:text-slate-400">
                RCA in progress
              </Badge>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">No RCA record yet</span>
            )}
          </div>
          {incident.resident_id && residentName ? (
            <Link
              href={`/admin/residents/${incident.resident_id}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "border-slate-200 dark:border-slate-700",
              )}
            >
              <User className="mr-2 h-3.5 w-3.5" />
              Resident profile
            </Link>
          ) : (
            <span className="text-sm text-slate-500 dark:text-slate-400">No linked resident</span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {followupActionError ? (
          <div className="lg:col-span-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {followupActionError}
          </div>
        ) : null}
        {followupActionMessage ? (
          <div className="lg:col-span-2 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            {followupActionMessage}
          </div>
        ) : null}
        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <MapPin className="h-4 w-4 text-brand-600" />
              Context
            </CardTitle>
            <CardDescription>When, where, and how the event was surfaced</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Occurred" value={formatTs(incident.occurred_at)} />
            <DetailRow label="Discovered" value={formatTs(incident.discovered_at)} />
            <DetailRow label="Shift" value={formatShift(incident.shift)} />
            <DetailRow label="Location" value={incident.location_description} />
            {incident.location_type ? (
              <DetailRow label="Location type" value={formatSnake(incident.location_type)} />
            ) : null}
            <DetailRow label="Reported by" value={reporterName} />
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800">
          <CardHeader>
            <CardTitle className="font-display text-lg">Resident</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {incident.resident_id && residentName ? (
              <>
                <DetailRow label="Name" value={residentName} />
                <DetailRow
                  label="Record"
                  value={
                    <Link
                      href={`/admin/residents/${incident.resident_id}`}
                      className="text-brand-700 underline-offset-4 hover:underline dark:text-teal-400"
                    >
                      Open profile
                    </Link>
                  }
                />
              </>
            ) : (
              <p className="text-slate-500 dark:text-slate-400">Environmental or unassigned resident context.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Narrative</CardTitle>
            <CardDescription>Structured capture from the reporting workflow</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Description</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200">{incident.description}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Immediate actions</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                {incident.immediate_actions}
              </p>
            </div>
            {incident.contributing_factors?.length ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Contributing factors</p>
                <ul className="mt-1 list-inside list-disc text-slate-700 dark:text-slate-300">
                  {incident.contributing_factors.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {incident.injury_occurred ? (
          <Card className="border-red-200/60 shadow-soft dark:border-red-900/40 lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-lg text-red-800 dark:text-red-200">Injury</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow label="Description" value={incident.injury_description ?? "—"} />
              <DetailRow label="Severity" value={incident.injury_severity ? formatSnake(incident.injury_severity) : "—"} />
              <DetailRow label="Body location" value={incident.injury_body_location ?? "—"} />
            </CardContent>
          </Card>
        ) : null}

        {categoryUi === "fall" ? (
          <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-lg">Fall specifics</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow
                label="Witnessed"
                value={incident.fall_witnessed == null ? "—" : incident.fall_witnessed ? "Yes" : "No"}
              />
              <DetailRow label="Fall type" value={incident.fall_type ? formatSnake(incident.fall_type) : "—"} />
              <DetailRow label="Activity" value={incident.fall_activity ? formatSnake(incident.fall_activity) : "—"} />
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Notifications &amp; regulatory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <NotifyPill active={incident.nurse_notified} label="Nurse" />
              <NotifyPill active={incident.administrator_notified} label="Administrator" />
              <NotifyPill active={incident.family_notified} label="Family" />
              <NotifyPill active={incident.ahca_reportable} label="AHCA reportable" warn />
              <NotifyPill active={incident.ahca_reported} label="AHCA reported" />
              <NotifyPill active={incident.insurance_reportable} label="Insurance reportable" warn />
              <NotifyPill active={incident.insurance_reported} label="Insurance reported" />
              <NotifyPill active={incident.care_plan_updated} label="Care plan updated" />
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow label="Nurse notified" value={incident.nurse_notified_at ? formatTs(incident.nurse_notified_at) : incident.nurse_notified ? "Yes" : "Pending"} />
              <DetailRow label="Administrator notified" value={incident.administrator_notified_at ? formatTs(incident.administrator_notified_at) : incident.administrator_notified ? "Yes" : "Pending"} />
              <DetailRow label="Owner notified" value={incident.owner_notified_at ? formatTs(incident.owner_notified_at) : incident.owner_notified ? "Yes" : "Not required / not done"} />
              <DetailRow label="Physician notified" value={incident.physician_notified_at ? formatTs(incident.physician_notified_at) : incident.physician_notified ? "Yes" : "Not required / not done"} />
              <DetailRow label="Family notified" value={incident.family_notified_at ? formatTs(incident.family_notified_at) : incident.family_notified ? "Yes" : "Pending"} />
              <DetailRow label="AHCA reported" value={incident.ahca_reported_at ? formatTs(incident.ahca_reported_at) : incident.ahca_reported ? "Yes" : incident.ahca_reportable ? "Pending" : "Not reportable"} />
              <DetailRow label="Insurance reported" value={incident.insurance_reported_at ? formatTs(incident.insurance_reported_at) : incident.insurance_reported ? "Yes" : incident.insurance_reportable ? "Pending" : "Not reportable"} />
            </div>

            {openObligations.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Open obligations</p>
                <ul className="mt-2 list-inside list-disc text-sm text-slate-700 dark:text-slate-300">
                  {openObligations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">All expected notification and reporting steps are complete for the current incident state.</p>
            )}
          </CardContent>
        </Card>

        {(incident.resolved_at || incident.resolution_notes) && (
          <Card className="border-emerald-200/50 shadow-soft dark:border-emerald-900/30 lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-lg">Resolution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {incident.resolved_at ? <DetailRow label="Resolved" value={formatTs(incident.resolved_at)} /> : null}
              {incident.resolution_notes ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Notes</p>
                  <p className="mt-1 text-slate-800 dark:text-slate-200">{incident.resolution_notes}</p>
                </div>
              ) : null}
              {incident.care_plan_update_notes ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Care plan notes</p>
                  <p className="mt-1 text-slate-800 dark:text-slate-200">{incident.care_plan_update_notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        <Card className="border-slate-200/70 shadow-soft dark:border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <ClipboardList className="h-4 w-4 text-brand-600" />
              Follow-ups
            </CardTitle>
            <CardDescription>Open and completed tasks tied to this incident</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {followups.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No follow-up rows on file.</p>
            ) : (
              <ul className="space-y-3">
                {followups.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {f.taskType}
                      </span>
                      <Badge variant="outline" className="font-normal">
                        {f.statusLabel}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{f.description}</p>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Due {f.dueLabel}
                      {f.assignee ? ` · ${f.assignee}` : " · Unassigned"}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {f.isOverdue && !f.isCompleted ? (
                        <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                          {followupEscalationLabel(f.escalationLevel, f.hoursOverdue)}
                        </Badge>
                      ) : null}
                      {isFollowupEscalated(f.escalationLevel) && !f.isCompleted ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
                            f.escalationLevel === "critical"
                              ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                              : "",
                          )}
                        >
                          {f.escalationLevel === "critical" ? "Critical escalation" : "Escalation risk"}
                        </Badge>
                      ) : null}
                      {!f.isCompleted ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={followupActionLoading === f.id}
                            onClick={() => void assignFollowupToMe(f.id)}
                          >
                            {followupActionLoading === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Assign to me"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={followupActionLoading === f.id}
                            onClick={() => void completeFollowup(f.id)}
                          >
                            {followupActionLoading === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark complete"}
                          </Button>
                          {assigneeOptions.length > 0 ? (
                            <>
                              <select
                                value={followupAssigneeDrafts[f.id] ?? ""}
                                onChange={(event) =>
                                  setFollowupAssigneeDrafts((current) => ({
                                    ...current,
                                    [f.id]: event.target.value,
                                  }))
                                }
                                className="h-9 min-w-[12rem] rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                              >
                                <option value="">Unassigned</option>
                                {assigneeOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={
                                  followupActionLoading === f.id ||
                                  (followupAssigneeDrafts[f.id] ?? "") === (f.assignedToId ?? "")
                                }
                                onClick={() => void saveFollowupAssignee(f.id)}
                              >
                                {followupActionLoading === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save assignee"}
                              </Button>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                          Completed
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function fetchIncidentDetail(
  incidentId: string,
  selectedFacilityId: string | null,
): Promise<DetailView | null> {
  const supabase = createClient();
  const incResult = (await supabase
    .from("incidents" as never)
    .select(
      [
        "id",
        "facility_id",
        "resident_id",
        "incident_number",
        "category",
        "severity",
        "status",
        "occurred_at",
        "discovered_at",
        "shift",
        "location_description",
        "location_type",
        "description",
        "immediate_actions",
        "contributing_factors",
        "injury_occurred",
        "injury_description",
        "injury_severity",
        "injury_body_location",
        "fall_witnessed",
        "fall_type",
        "fall_activity",
        "reported_by",
        "witness_names",
        "nurse_notified",
        "nurse_notified_at",
        "administrator_notified",
        "administrator_notified_at",
        "owner_notified",
        "owner_notified_at",
        "physician_notified",
        "physician_notified_at",
        "family_notified",
        "family_notified_at",
        "ahca_reportable",
        "ahca_reported",
        "ahca_reported_at",
        "insurance_reportable",
        "insurance_reported",
        "insurance_reported_at",
        "resolved_at",
        "resolution_notes",
        "care_plan_updated",
        "care_plan_update_notes",
        "updated_at",
      ].join(", "),
    )
    .eq("id", incidentId)
    .is("deleted_at", null)
    .maybeSingle()) as unknown as QueryResult<SupabaseIncident>;

  if (incResult.error) throw incResult.error;
  const incident = incResult.data;
  if (!incident) return null;

  if (isValidFacilityIdForQuery(selectedFacilityId) && incident.facility_id !== selectedFacilityId) {
    return null;
  }

  let residentName: string | null = null;
  if (incident.resident_id) {
    const resResult = (await supabase
      .from("residents" as never)
      .select("id, first_name, last_name")
      .eq("id", incident.resident_id)
      .is("deleted_at", null)
      .maybeSingle()) as unknown as QueryResult<SupabaseResidentMini>;
    if (resResult.error) throw resResult.error;
    const r = resResult.data;
    if (r) {
      residentName = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || null;
    }
  }

  const repResult = (await supabase
    .from("user_profiles" as never)
    .select("id, full_name")
    .eq("id", incident.reported_by)
    .maybeSingle()) as unknown as QueryResult<SupabaseProfileMini>;
  if (repResult.error) throw repResult.error;
  const reporterName = repResult.data?.full_name?.trim() || "Staff";

  const fuResult = (await supabase
    .from("incident_followups" as never)
    .select("id, task_type, description, due_at, completed_at, assigned_to")
    .eq("incident_id", incidentId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true })) as unknown as QueryListResult<SupabaseFollowup>;
  if (fuResult.error) throw fuResult.error;
  const rawFollowups = fuResult.data ?? [];

  const assigneeIds = [
    ...new Set(rawFollowups.map((f) => f.assigned_to).filter((id): id is string => Boolean(id))),
  ];
  const assigneeResult = assigneeIds.length
    ? ((await supabase
        .from("user_profiles" as never)
        .select("id, full_name")
        .in("id", assigneeIds)) as unknown as QueryListResult<SupabaseProfileMini>)
    : ({ data: [], error: null } as QueryListResult<SupabaseProfileMini>);
  if (assigneeResult.error) throw assigneeResult.error;
  const assigneeById = new Map((assigneeResult.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Staff"]));

  const followups = rawFollowups.map((f) => ({
    id: f.id,
    taskType: f.task_type,
    description: f.description,
    dueLabel: formatTs(f.due_at),
    statusLabel: f.completed_at ? "Completed" : "Open",
    assignedToId: f.assigned_to,
    assignee: f.assigned_to ? assigneeById.get(f.assigned_to) ?? "Assigned" : "",
    isCompleted: Boolean(f.completed_at),
    isOverdue: !f.completed_at && new Date(f.due_at).getTime() < Date.now(),
    hoursOverdue: !f.completed_at ? Math.max(0, Math.ceil((Date.now() - new Date(f.due_at).getTime()) / 3_600_000)) : 0,
    escalationLevel: !f.completed_at
      ? classifyFollowupEscalation(Math.max(0, Math.ceil((Date.now() - new Date(f.due_at).getTime()) / 3_600_000)))
      : "none",
  }));

  const rcaResult = (await supabase
    .from("incident_rca" as never)
    .select("investigation_status")
    .eq("incident_id", incidentId)
    .maybeSingle()) as unknown as QueryResult<{ investigation_status: string }>;

  if (rcaResult.error) throw rcaResult.error;
  let rcaInvestigation: RcaInvestigationUi = "none";
  if (rcaResult.data) {
    rcaInvestigation = rcaResult.data.investigation_status === "complete" ? "complete" : "draft";
  }

  return {
    incident,
    residentName,
    reporterName,
    categoryUi: mapDbCategoryToUi(incident.category),
    severityUi: mapDbSeverityToUi(incident.severity),
    statusUi: mapDbStatusToUi(incident.status),
    rcaInvestigation,
    followups,
  };
}

function mapDbStatusToUi(value: string): IncidentStatusUi {
  if (value === "investigating") return "in_review";
  if (value === "resolved" || value === "closed") return "closed";
  return "open";
}

function mapDbSeverityToUi(value: string): IncidentSeverityUi {
  if (value === "level_2" || value === "level_3" || value === "level_4") return value;
  return "level_1";
}

function mapDbCategoryToUi(value: string): IncidentCategoryUi {
  if (value.startsWith("fall_")) return "fall";
  if (value === "elopement" || value === "wandering") return "elopement";
  if (value.startsWith("medication_")) return "medication_error";
  if (
    value.startsWith("behavioral_") ||
    value === "abuse_allegation" ||
    value === "neglect_allegation"
  ) {
    return "behavioral";
  }
  return "other";
}

function formatTs(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatShift(value: string): string {
  return formatSnake(value);
}

function formatSnake(value: string): string {
  return value.replace(/_/g, " ");
}

function formatCategoryRaw(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildIncidentOpenObligations(incident: SupabaseIncident): string[] {
  const items: string[] = [];
  if (!incident.nurse_notified) items.push("Notify the nurse.");
  if (!incident.administrator_notified) items.push("Notify the administrator.");
  if (incident.severity === "level_3" || incident.severity === "level_4") {
    if (!incident.owner_notified) items.push("Notify the owner.");
    if (!incident.physician_notified) items.push("Notify the physician.");
    if (!incident.family_notified) items.push("Notify the family.");
  }
  if (incident.ahca_reportable && !incident.ahca_reported) items.push("Complete AHCA reporting.");
  if (incident.insurance_reportable && !incident.insurance_reported) items.push("Report to the insurance carrier.");
  return items;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-[8rem] text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <div className="text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  );
}

function NotifyPill({ active, label, warn }: { active: boolean; label: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? warn
            ? "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "border-slate-200/80 bg-slate-100/80 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400",
      )}
    >
      {label}
      {active ? " · Yes" : " · No"}
    </span>
  );
}

function CategoryBadge({ category }: { category: IncidentCategoryUi }) {
  const map: Record<IncidentCategoryUi, { label: string; className: string }> = {
    fall: { label: "Fall", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    medication_error: {
      label: "Medication",
      className: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    },
    behavioral: {
      label: "Behavioral",
      className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    },
    elopement: {
      label: "Elopement",
      className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    },
    other: { label: "Other", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  };
  return <Badge className={map[category].className}>{map[category].label}</Badge>;
}

function SeverityBadge({ severity }: { severity: IncidentSeverityUi }) {
  const map: Record<IncidentSeverityUi, { label: string; className: string }> = {
    level_1: { label: "L1", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    level_2: { label: "L2", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    level_3: { label: "L3", className: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" },
    level_4: { label: "L4", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  };
  return <Badge className={map[severity].className}>{map[severity].label}</Badge>;
}

function StatusBadge({ status }: { status: IncidentStatusUi }) {
  const map: Record<IncidentStatusUi, { label: string; className: string }> = {
    open: { label: "Open", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
    in_review: {
      label: "In Review",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    closed: { label: "Closed", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}
