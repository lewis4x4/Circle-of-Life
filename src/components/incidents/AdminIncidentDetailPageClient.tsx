"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, GitBranch, Loader2, User } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";
import {
  fetchIncidentFollowupAssignees,
  type IncidentFollowupAssigneeOption,
} from "@/lib/incidents/followup-assignees";
import {
  followupEscalationLabel,
  isFollowupEscalated,
} from "@/lib/incidents/followup-escalation";
import {
  loadIncidentDetail,
  type IncidentCategoryUi,
  type IncidentDetailView,
  type IncidentSeverityUi,
  type IncidentStatusUi,
  type RcaInvestigationUi,
  type SupabaseIncidentDetail,
} from "@/lib/incidents/load-incident-detail";
import { buildIncidentOpenObligations } from "@/lib/incidents/workflow-obligations";

export type AdminIncidentDetailPageClientProps = {
  initialDetail?: IncidentDetailView | null;
  initialError?: string | null;
  initialFacilityId?: string | null;
};

export function AdminIncidentDetailPageClient({
  initialDetail = null,
  initialError = null,
  initialFacilityId,
}: AdminIncidentDetailPageClientProps) {
  const params = useParams();
  const rawId = params?.id;
  const incidentId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();
  const bootstrapped = initialFacilityId !== undefined;
  const skipNextLoadRef = useRef(bootstrapped && initialError == null);

  const [loading, setLoading] = useState(!bootstrapped);
  const [error, setError] = useState<string | null>(initialError);
  const [notFound, setNotFound] = useState(bootstrapped && !initialDetail && !initialError);
  const [detail, setDetail] = useState<IncidentDetailView | null>(initialDetail);
  const [followupActionLoading, setFollowupActionLoading] = useState<string | null>(null);
  const [followupActionError, setFollowupActionError] = useState<string | null>(null);
  const [followupActionMessage, setFollowupActionMessage] = useState<string | null>(null);
  const [incidentActionLoading, setIncidentActionLoading] = useState<string | null>(null);
  const [incidentActionError, setIncidentActionError] = useState<string | null>(null);
  const [incidentActionMessage, setIncidentActionMessage] = useState<string | null>(null);
  const [assigneeOptions, setAssigneeOptions] = useState<IncidentFollowupAssigneeOption[]>([]);
  const [followupAssigneeDrafts, setFollowupAssigneeDrafts] = useState<Record<string, string>>(() =>
    initialDetail
      ? Object.fromEntries(
          initialDetail.followups.map((followup) => [followup.id, followup.assignedToId ?? ""]),
        )
      : {},
  );

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

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
      const row = await loadIncidentDetail(incidentId, selectedFacilityId);
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
    } catch (err) {
      setError(
        formatLiveDataLoadError(
          err,
          "Incident record could not be loaded. Try again or return to the queue.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [incidentId, selectedFacilityId, initialFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!bootstrapped || !initialDetail || assigneeOptions.length > 0) return;
    void fetchIncidentFollowupAssignees(initialDetail.incident.facility_id)
      .then(setAssigneeOptions)
      .catch(() => setAssigneeOptions([]));
  }, [assigneeOptions.length, bootstrapped, initialDetail]);

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
  const watchInstances = detail.watchInstances;
  const assuranceEscalations = detail.assuranceEscalations;
  const openObligations = buildIncidentOpenObligations(incident);
  const workflowSummary = buildIncidentWorkflowSummary(incident, rcaInvestigation, followups, openObligations);

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

  async function updateIncidentWorkflow(
    patch: Partial<Pick<
      SupabaseIncidentDetail,
      | "nurse_notified"
      | "nurse_notified_at"
      | "administrator_notified"
      | "administrator_notified_at"
      | "owner_notified"
      | "owner_notified_at"
      | "physician_notified"
      | "physician_notified_at"
      | "family_notified"
      | "family_notified_at"
      | "ahca_reported"
      | "ahca_reported_at"
      | "insurance_reported"
      | "insurance_reported_at"
      | "care_plan_updated"
    >>,
    successMessage: string,
  ) {
    setIncidentActionLoading(successMessage);
    setIncidentActionError(null);
    setIncidentActionMessage(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("incidents")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq("id", incident.id);
      if (updateError) throw updateError;
      setIncidentActionMessage(successMessage);
      await load();
    } catch (actionError) {
      setIncidentActionError(actionError instanceof Error ? actionError.message : "Could not update incident workflow.");
    } finally {
      setIncidentActionLoading(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-[var(--motion-duration)]">
      <RecordDetailHeader
        title="Incident detail"
        subtitle={`${incident.incident_number} · ${formatCategoryRaw(incident.category)} · Updated ${formatTs(incident.updated_at)}`}
        statusChips={
          <>
            <CategoryBadge category={categoryUi} />
            <SeverityBadge severity={severityUi} />
            <StatusBadge status={statusUi} />
          </>
        }
        backLink={{ label: "Queue", href: "/admin/incidents" }}
        actions={
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-col items-end gap-1.5">
              <Link
                href={`/admin/incidents/${incident.id}/rca`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <GitBranch className="mr-2 h-3.5 w-3.5" />
                Root cause workspace
              </Link>
              {rcaInvestigation === "complete" ? (
                <Badge variant="outline" className="border-success/20 bg-success/10 text-success">
                  RCA investigation complete
                </Badge>
              ) : rcaInvestigation === "draft" ? (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  RCA in progress
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">No RCA record yet</span>
              )}
            </div>
            {incident.resident_id && residentName ? (
              <Link
                href={`/admin/residents/${incident.resident_id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <User className="mr-2 h-3.5 w-3.5" />
                Resident profile
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">No linked resident</span>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {followupActionError ? (
          <div className="lg:col-span-2 rounded-[8px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {followupActionError}
          </div>
        ) : null}
        {followupActionMessage ? (
          <div className="lg:col-span-2 rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
            {followupActionMessage}
          </div>
        ) : null}
        {incidentActionError ? (
          <div className="lg:col-span-2 rounded-[8px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {incidentActionError}
          </div>
        ) : null}
        {incidentActionMessage ? (
          <div className="lg:col-span-2 rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
            {incidentActionMessage}
          </div>
        ) : null}
        <RecordDetailSection
          className="lg:col-span-2"
          title="Workflow Summary"
          description={workflowSummary.summary}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                {workflowSummary.openFollowups} open follow-up{workflowSummary.openFollowups === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                {workflowSummary.overdueFollowups} overdue
              </Badge>
              <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">
                {workflowSummary.unassignedFollowups} unassigned
              </Badge>
              <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">
                {workflowSummary.escalatedFollowups} escalated
              </Badge>
              <Badge variant="outline" className="border-info/20 bg-info/10 text-info">
                RCA {workflowSummary.rcaLabel}
              </Badge>
              <Badge variant="outline" className="border-info/20 bg-info/10 text-info">
                {workflowSummary.openObligations} reporting / notification item{workflowSummary.openObligations === 1 ? "" : "s"}
              </Badge>
            </div>

            {workflowSummary.nextActions.length > 0 ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Next actions</p>
                <ul className="mt-2 list-inside list-disc text-sm text-foreground">
                  {workflowSummary.nextActions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-success">
                This incident is operationally clear. Follow-ups, reporting, RCA, and care-plan expectations are in a good state.
              </p>
            )}
          </div>
        </RecordDetailSection>

        {watchInstances.length > 0 ? (
          <RecordDetailSection
            className="lg:col-span-2"
            title="Smart rounding timeline"
            description="Watch activity automatically or manually linked to this incident."
          >
            <div className="space-y-4">
              {watchInstances.map((watch) => (
                <div
                  key={watch.id}
                  className="rounded-[8px] border border-cyan-500/20 bg-cyan-500/10 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-cyan-500/20 bg-cyan-500/10 text-cyan-700">
                          {watch.resident_watch_protocols?.name ?? "Watch protocol"}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          {watch.status.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          {watch.triggered_by_type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <DetailRow label="Started" value={formatTs(watch.starts_at)} />
                        <DetailRow label="Ends" value={watch.ends_at ? formatTs(watch.ends_at) : "Open-ended"} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href="/admin/rounding/watches" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Open watch center
                      </Link>
                      {(watch.taskSummary.overdue > 0 || watch.taskSummary.missed > 0) ? (
                        <Link href="/admin/rounding/escalations" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                          Review escalations
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      {watch.taskSummary.total} total task{watch.taskSummary.total === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      {watch.taskSummary.open} open
                    </Badge>
                    <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">
                      {watch.taskSummary.overdue} overdue
                    </Badge>
                    <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                      {watch.taskSummary.missed} missed
                    </Badge>
                  </div>

                  {watch.events.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Watch events</p>
                      <ul className="space-y-2 text-sm text-foreground">
                        {watch.events.map((event) => (
                          <li key={event.id} className="rounded-[8px] border border-border bg-card px-3 py-2">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <span className="font-medium">{event.event_type.replace(/_/g, " ")}</span>
                              <span className="text-xs tabular-nums text-muted-foreground">{formatTs(event.occurred_at)}</span>
                            </div>
                            {event.note ? <p className="mt-1 text-xs text-muted-foreground">{event.note}</p> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </RecordDetailSection>
        ) : null}

        {assuranceEscalations.length > 0 ? (
          <RecordDetailSection
            className="lg:col-span-2"
            title="Active Smart rounding escalations"
            description="Open supervision work triggered by observation tasks linked to this incident."
          >
            <div className="space-y-3">
              {assuranceEscalations.map((escalation) => (
                <div
                  key={escalation.id}
                  className="rounded-[8px] border border-destructive/20 bg-destructive/10 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                          Level {escalation.escalation_level}
                        </Badge>
                        <Badge variant="outline">{escalation.escalation_type.replace(/_/g, " ")}</Badge>
                        <Badge variant="outline">{escalation.status.replace(/_/g, " ")}</Badge>
                        <Badge variant="outline">{escalation.task_status.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-sm tabular-nums text-foreground">
                        Triggered {formatTs(escalation.triggered_at)} · Task due {formatTs(escalation.task_due_at)}
                      </p>
                      {escalation.resolution_note ? (
                        <p className="text-sm text-muted-foreground">{escalation.resolution_note}</p>
                      ) : null}
                    </div>
                    <Link href="/admin/rounding/escalations" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Open escalation queue
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </RecordDetailSection>
        ) : null}
        <RecordDetailSection title="Context" description="When, where, and how the event was surfaced">
          <div className="space-y-3 text-sm">
            <DetailRow label="Occurred" value={formatTs(incident.occurred_at)} />
            <DetailRow label="Discovered" value={formatTs(incident.discovered_at)} />
            <DetailRow label="Shift" value={formatShift(incident.shift)} />
            <DetailRow label="Location" value={incident.location_description} />
            {incident.location_type ? (
              <DetailRow label="Location type" value={formatSnake(incident.location_type)} />
            ) : null}
            <DetailRow label="Reported by" value={reporterName} />
          </div>
        </RecordDetailSection>

        <RecordDetailSection title="Resident">
          <div className="space-y-2 text-sm">
            {incident.resident_id && residentName ? (
              <>
                <DetailRow label="Name" value={residentName} />
                <DetailRow
                  label="Record"
                  value={
                    <Link
                      href={`/admin/residents/${incident.resident_id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      Open profile
                    </Link>
                  }
                />
              </>
            ) : (
              <p className="text-muted-foreground">Environmental or unassigned resident context.</p>
            )}
          </div>
        </RecordDetailSection>

        <RecordDetailSection className="lg:col-span-2" title="Narrative" description="Structured capture from the reporting workflow">
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Description</p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{incident.description}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Immediate actions</p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">
                {incident.immediate_actions}
              </p>
            </div>
            {incident.contributing_factors?.length ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Contributing factors</p>
                <ul className="mt-1 list-inside list-disc text-foreground">
                  {incident.contributing_factors.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </RecordDetailSection>

        {incident.injury_occurred ? (
          <RecordDetailSection className="lg:col-span-2" title="Injury">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow label="Description" value={incident.injury_description ?? "—"} />
              <DetailRow label="Severity" value={incident.injury_severity ? formatSnake(incident.injury_severity) : "—"} />
              <DetailRow label="Body location" value={incident.injury_body_location ?? "—"} />
            </div>
          </RecordDetailSection>
        ) : null}

        {categoryUi === "fall" ? (
          <RecordDetailSection className="lg:col-span-2" title="Fall specifics">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <DetailRow
                label="Witnessed"
                value={incident.fall_witnessed == null ? "—" : incident.fall_witnessed ? "Yes" : "No"}
              />
              <DetailRow label="Fall type" value={incident.fall_type ? formatSnake(incident.fall_type) : "—"} />
              <DetailRow label="Activity" value={incident.fall_activity ? formatSnake(incident.fall_activity) : "—"} />
            </div>
          </RecordDetailSection>
        ) : null}

        <RecordDetailSection className="lg:col-span-2" title="Notifications &amp; regulatory">
          <div className="space-y-4">
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
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Open obligations</p>
                <ul className="mt-2 list-inside list-disc text-sm text-foreground">
                  {openObligations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-success">All expected notification and reporting steps are complete for the current incident state.</p>
            )}

            <div className="rounded-[8px] border border-border bg-muted/50 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Workflow actions</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!incident.nurse_notified ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          nurse_notified: true,
                          nurse_notified_at: new Date().toISOString(),
                        },
                        "Nurse notification recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "Nurse notification recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark nurse notified"}
                  </Button>
                ) : null}
                {!incident.administrator_notified ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          administrator_notified: true,
                          administrator_notified_at: new Date().toISOString(),
                        },
                        "Administrator notification recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "Administrator notification recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark administrator notified"}
                  </Button>
                ) : null}
                {!incident.owner_notified ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          owner_notified: true,
                          owner_notified_at: new Date().toISOString(),
                        },
                        "Owner notification recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "Owner notification recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark owner notified"}
                  </Button>
                ) : null}
                {!incident.physician_notified ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          physician_notified: true,
                          physician_notified_at: new Date().toISOString(),
                        },
                        "Physician notification recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "Physician notification recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark physician notified"}
                  </Button>
                ) : null}
                {!incident.family_notified ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          family_notified: true,
                          family_notified_at: new Date().toISOString(),
                        },
                        "Family notification recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "Family notification recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark family notified"}
                  </Button>
                ) : null}
                {incident.ahca_reportable && !incident.ahca_reported ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          ahca_reported: true,
                          ahca_reported_at: new Date().toISOString(),
                        },
                        "AHCA reporting recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "AHCA reporting recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark AHCA reported"}
                  </Button>
                ) : null}
                {incident.insurance_reportable && !incident.insurance_reported ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          insurance_reported: true,
                          insurance_reported_at: new Date().toISOString(),
                        },
                        "Insurance reporting recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "Insurance reporting recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark insurance reported"}
                  </Button>
                ) : null}
                {!incident.care_plan_updated ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={incidentActionLoading !== null}
                    onClick={() =>
                      void updateIncidentWorkflow(
                        {
                          care_plan_updated: true,
                        },
                        "Care plan update recorded.",
                      )
                    }
                  >
                    {incidentActionLoading === "Care plan update recorded." ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark care plan updated"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </RecordDetailSection>

        {(incident.resolved_at || incident.resolution_notes) && (
          <RecordDetailSection className="lg:col-span-2" title="Resolution">
            <div className="space-y-2 text-sm">
              {incident.resolved_at ? <DetailRow label="Resolved" value={formatTs(incident.resolved_at)} /> : null}
              {incident.resolution_notes ? (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Notes</p>
                  <p className="mt-1 text-foreground">{incident.resolution_notes}</p>
                </div>
              ) : null}
              {incident.care_plan_update_notes ? (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Care plan notes</p>
                  <p className="mt-1 text-foreground">{incident.care_plan_update_notes}</p>
                </div>
              ) : null}
            </div>
          </RecordDetailSection>
        )}

        <RecordDetailSection
          className="lg:col-span-2"
          title="Follow-ups"
          description="Open and completed tasks tied to this incident"
        >
          <div className="space-y-3">
            {followups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No follow-up rows on file.</p>
            ) : (
              <ul className="space-y-3">
                {followups.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-[8px] border border-border bg-muted/50 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {f.taskType}
                      </span>
                      <Badge variant="outline" className="font-normal">
                        {f.statusLabel}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-foreground">{f.description}</p>
                    <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                      Due {f.dueLabel}
                      {f.assignee ? ` · ${f.assignee}` : " · Unassigned"}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {f.isOverdue && !f.isCompleted ? (
                        <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                          {followupEscalationLabel(f.escalationLevel, f.hoursOverdue)}
                        </Badge>
                      ) : null}
                      {isFollowupEscalated(f.escalationLevel) && !f.isCompleted ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "border-warning/20 bg-warning/10 text-warning",
                            f.escalationLevel === "critical"
                              ? "border-destructive/20 bg-destructive/10 text-destructive"
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
                                className="h-9 min-w-[12rem] rounded-[8px] border border-input bg-card px-3 text-sm text-foreground"
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
                        <Badge variant="outline" className="border-success/20 bg-success/10 text-success">
                          Completed
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </RecordDetailSection>
      </div>
    </div>
  );
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

function buildIncidentWorkflowSummary(
  incident: SupabaseIncidentDetail,
  rcaInvestigation: RcaInvestigationUi,
  followups: IncidentDetailView["followups"],
  openObligations: string[],
) {
  const openFollowups = followups.filter((item) => !item.isCompleted);
  const overdueFollowups = openFollowups.filter((item) => item.isOverdue).length;
  const unassignedFollowups = openFollowups.filter((item) => !item.assignedToId).length;
  const escalatedFollowups = openFollowups.filter((item) => isFollowupEscalated(item.escalationLevel)).length;
  const rootCauseExpected =
    incident.severity === "level_3" ||
    incident.severity === "level_4" ||
    followups.some((item) => item.taskType === "root_cause_analysis");
  const carePlanPending =
    Boolean(incident.resolved_at) &&
    !incident.care_plan_updated &&
    (incident.severity === "level_3" || incident.severity === "level_4" || openFollowups.length > 0);

  const nextActions: string[] = [];
  if (openObligations.length > 0) {
    nextActions.push(...openObligations);
  }
  if (escalatedFollowups > 0) {
    nextActions.push("Work the escalated follow-ups before closure or sign-off.");
  } else if (overdueFollowups > 0) {
    nextActions.push("Clear overdue follow-ups before the incident can move cleanly toward closure.");
  }
  if (unassignedFollowups > 0) {
    nextActions.push("Assign the remaining unassigned follow-up work.");
  }
  if (rootCauseExpected && rcaInvestigation !== "complete") {
    nextActions.push("Complete the root cause investigation for this incident.");
  }
  if (carePlanPending) {
    nextActions.push("Document the care-plan update before closing the incident loop.");
  }

  let summary = "No outstanding workflow pressure.";
  let tone: "clear" | "warning" = "clear";
  if (openObligations.length > 0) {
    summary = "Notifications or regulatory reporting are still incomplete.";
    tone = "warning";
  } else if (escalatedFollowups > 0) {
    summary = "Chronically overdue follow-up work is driving the current incident risk.";
    tone = "warning";
  } else if (overdueFollowups > 0 || unassignedFollowups > 0) {
    summary = "Follow-up execution still needs operator attention.";
    tone = "warning";
  } else if (rootCauseExpected && rcaInvestigation !== "complete") {
    summary = "Root cause analysis is the main remaining incident workflow step.";
    tone = "warning";
  } else if (carePlanPending) {
    summary = "Care-plan closure is the last operational step still pending.";
    tone = "warning";
  }

  return {
    summary,
    tone,
    openFollowups: openFollowups.length,
    overdueFollowups,
    unassignedFollowups,
    escalatedFollowups,
    openObligations: openObligations.length,
    rcaLabel: rcaInvestigation === "complete" ? "complete" : rcaInvestigation === "draft" ? "draft" : "not started",
    nextActions,
  };
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-[8rem] text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="text-foreground">{value}</div>
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
            ? "border-warning/20 bg-warning/10 text-warning"
            : "border-success/20 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {label}
      {active ? " · Yes" : " · No"}
    </span>
  );
}

function CategoryBadge({ category }: { category: IncidentCategoryUi }) {
  const map: Record<IncidentCategoryUi, { label: string; className: string }> = {
    fall: { label: "Fall", className: "border-warning/20 bg-warning/10 text-warning" },
    medication_error: { label: "Medication", className: "border-info/20 bg-info/10 text-info" },
    behavioral: { label: "Behavioral", className: "border-info/20 bg-info/10 text-info" },
    elopement: { label: "Elopement", className: "border-destructive/20 bg-destructive/10 text-destructive" },
    other: { label: "Other", className: "bg-muted text-muted-foreground" },
  };
  return <Badge variant="outline" className={map[category].className}>{map[category].label}</Badge>;
}

function SeverityBadge({ severity }: { severity: IncidentSeverityUi }) {
  const map: Record<IncidentSeverityUi, { label: string; className: string }> = {
    level_1: { label: "L1", className: "bg-muted text-muted-foreground" },
    level_2: { label: "L2", className: "border-warning/20 bg-warning/10 text-warning" },
    level_3: { label: "L3", className: "border-warning/20 bg-warning/10 text-warning" },
    level_4: { label: "L4", className: "border-destructive/20 bg-destructive/10 text-destructive" },
  };
  return <Badge variant="outline" className={map[severity].className}>{map[severity].label}</Badge>;
}

function StatusBadge({ status }: { status: IncidentStatusUi }) {
  const map: Record<IncidentStatusUi, { label: string; className: string }> = {
    open: { label: "Open", className: "border-destructive/20 bg-destructive/10 text-destructive" },
    in_review: { label: "In Review", className: "border-warning/20 bg-warning/10 text-warning" },
    closed: { label: "Closed", className: "border-success/20 bg-success/10 text-success" },
  };
  return <Badge variant="outline" className={map[status].className}>{map[status].label}</Badge>;
}
