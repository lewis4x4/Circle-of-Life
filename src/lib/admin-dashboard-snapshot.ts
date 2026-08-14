import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type DashboardCensusRow = {
  id: string;
  name: string;
  initials: string;
  dobDisplay: string;
  room: string;
  acuity: 1 | 2 | 3;
  statusLabel: string;
  statusTone: "active" | "away";
  updatedRelative: string;
};

export type DashboardActivityItem = {
  id: string;
  timeLabel: string;
  actor: string;
  message: string;
  tone: "critical" | "warning" | "normal";
  href: string;
  ctaLabel: string;
};

export type WorkflowInboxItem = {
  id: string;
  label: string;
  message: string;
  tone: "critical" | "warning" | "normal";
  href: string;
  ctaLabel: string;
};

export type AdminDashboardSnapshot = {
  headlineName: string;
  timezoneLabel: string;
  shiftSummary: string;
  residentCount: number;
  awayResidentCount: number;
  licensedBeds: number | null;
  activeStaffCount: number;
  openIncidentAlerts: number;
  staffingGapSnapshots24h: number;
  medicationErrorsUnreviewed: number;
  expiringCertifications30d: number;
  workflowQueues: {
    doctrinePendingReview: number;
    doctrineBlockedReview: number;
    doctrineReadyToPublish: number;
    doctrineDueSoon: number;
    doctrineOverdue: number;
    incidentOverdueFollowups: number;
    incidentUnassignedFollowups: number;
    incidentEscalatedFollowups: number;
    incidentOpenObligations: number;
    incidentRootCausePending: number;
    incidentCarePlanPending: number;
    admissionsBlocked: number;
    admissionsMoveInReady: number;
    admissionsOnboardingPending: number;
    referralsInAdmissions: number;
    referralsBlockedHandoffs: number;
    referralsReadyHandoffs: number;
    referralsOnboardingHandoffs: number;
    dischargePlanning: number;
    dischargePharmacistReview: number;
    dischargeReadyToComplete: number;
    familyTriagePending: number;
    familyConferencesUpcoming: number;
  };
  residentAssurance: {
    activeWatches: number;
    pendingWatchApprovals: number;
    openEscalations: number;
    openIntegrityFlags: number;
    criticalSafetyResidents: number;
    highOrCriticalSafetyResidents: number;
  };
  workflowInbox: WorkflowInboxItem[];
  censusPreview: DashboardCensusRow[];
  acuityWatchlist: DashboardCensusRow[];
  activity: DashboardActivityItem[];
};

type ProjectionResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string;
  status: string | null;
  acuity_level: string | null;
  updated_at: string | null;
  date_of_birth: string | null;
  bed_label: string | null;
  room_number: string | null;
};

type ProjectionActivityRow = {
  id: string;
  occurred_at: string;
  category: string;
  severity: string;
  status: string;
  resident_id: string | null;
  resident_first_name: string | null;
  resident_last_name: string | null;
};

type ProjectionPayload = {
  headlineName?: string;
  timezoneLabel?: string;
  licensedBeds?: number | null;
  counts?: Record<string, unknown>;
  workflowQueues?: Record<string, unknown>;
  residentAssurance?: Record<string, unknown>;
  censusPreview?: ProjectionResidentRow[];
  acuityWatchlist?: ProjectionResidentRow[];
  activity?: ProjectionActivityRow[];
};

function mapAcuity(value: string | null): 1 | 2 | 3 {
  if (value === "level_3") return 3;
  if (value === "level_2") return 2;
  return 1;
}
function residencyUiLabel(status: string | null): { label: string; tone: "active" | "away" } {
  if (status === "hospital_hold") return { label: "Hospital", tone: "away" };
  if (status === "loa") return { label: "LOA", tone: "away" };
  return { label: "In facility", tone: "active" };
}

function formatDob(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "2-digit", day: "2-digit", year: "numeric" }).format(dt);
}

function formatRelativeShort(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffMin = Math.round((Date.now() - t) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr} hr ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

function shiftSummaryForTimezone(timeZone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const safeHour = Number.isNaN(hour) ? 12 : hour;
  if (safeHour >= 7 && safeHour < 15) return `Day shift · local (${timeZone})`;
  if (safeHour >= 15 && safeHour < 23) return `Evening shift · local (${timeZone})`;
  return `Night shift · local (${timeZone})`;
}

function formatIncidentCategory(raw: string): string {
  return raw.replace(/_/g, " ");
}

function buildWorkflowInbox(input: {
  doctrineBlockedReview: number;
  doctrinePendingReview: number;
  doctrineReadyToPublish: number;
  doctrineDueSoon: number;
  doctrineOverdue: number;
  incidentOverdueFollowups: number;
  incidentUnassignedFollowups: number;
  incidentEscalatedFollowups: number;
  incidentOpenObligations: number;
  incidentRootCausePending: number;
  incidentCarePlanPending: number;
  admissionsBlocked: number;
  admissionsMoveInReady: number;
  admissionsOnboardingPending: number;
  referralsInAdmissions: number;
  referralsBlockedHandoffs: number;
  referralsReadyHandoffs: number;
  referralsOnboardingHandoffs: number;
  dischargePlanning: number;
  dischargePharmacistReview: number;
  dischargeReadyToComplete: number;
  familyTriagePending: number;
  familyConferencesUpcoming: number;
}): WorkflowInboxItem[] {
  const items: WorkflowInboxItem[] = [];
  const incidentLifecycleBlockers =
    input.incidentOpenObligations + input.incidentRootCausePending + input.incidentCarePlanPending;
  const incidentFollowupBlockers =
    input.incidentEscalatedFollowups + input.incidentOverdueFollowups + input.incidentUnassignedFollowups;
  const incidentFollowupHref =
    input.incidentEscalatedFollowups > 0
      ? "/admin/incidents/followups?filter=escalated"
      : input.incidentOverdueFollowups > 0
        ? "/admin/incidents/overdue-followups"
        : input.incidentUnassignedFollowups > 0
          ? "/admin/incidents/followups?filter=unassigned"
          : "/admin/incidents/followups";

  if (input.doctrineBlockedReview > 0) {
    items.push({
      id: "doctrine-blocked",
      label: "Doctrine Review",
      message: `${input.doctrineBlockedReview} document${input.doctrineBlockedReview === 1 ? "" : "s"} are blocked in review out of ${input.doctrinePendingReview} pending.`,
      tone: "warning",
      href: "/admin/knowledge/admin#doctrine-blocked-review",
      ctaLabel: "Open blocked queue",
    });
  }

  if (input.doctrineReadyToPublish > 0) {
    items.push({
      id: "doctrine-ready",
      label: "Doctrine Review",
      message: `${input.doctrineReadyToPublish} document${input.doctrineReadyToPublish === 1 ? "" : "s"} cleared review prerequisites and are ready for publication.`,
      tone: "normal",
      href: "/admin/knowledge/admin#doctrine-ready-to-publish",
      ctaLabel: "Open ready queue",
    });
  }

  if (input.doctrineOverdue > 0 || input.doctrineDueSoon > 0) {
    const parts: string[] = [];
    if (input.doctrineOverdue > 0) parts.push(`${input.doctrineOverdue} overdue`);
    if (input.doctrineDueSoon > 0) parts.push(`${input.doctrineDueSoon} due soon`);
    items.push({
      id: "doctrine-sla",
      label: "Doctrine SLA",
      message: `${parts.join(" · ")} review${input.doctrineOverdue + input.doctrineDueSoon === 1 ? "" : "s"} need attention in the doctrine lane.`,
      tone: input.doctrineOverdue > 0 ? "warning" : "normal",
      href: "/admin/knowledge/admin#doctrine-review-sla",
      ctaLabel: "Open SLA queue",
    });
  }

  if (
    input.incidentOverdueFollowups > 0 ||
    input.incidentUnassignedFollowups > 0 ||
    input.incidentEscalatedFollowups > 0 ||
    input.incidentOpenObligations > 0 ||
    input.incidentRootCausePending > 0 ||
    input.incidentCarePlanPending > 0
  ) {
    const parts: string[] = [];
    if (input.incidentEscalatedFollowups > 0) parts.push(`${input.incidentEscalatedFollowups} escalated`);
    if (input.incidentOverdueFollowups > 0) parts.push(`${input.incidentOverdueFollowups} overdue`);
    if (input.incidentUnassignedFollowups > 0) parts.push(`${input.incidentUnassignedFollowups} unassigned`);
    if (input.incidentOpenObligations > 0) parts.push(`${input.incidentOpenObligations} reporting open`);
    if (input.incidentRootCausePending > 0) parts.push(`${input.incidentRootCausePending} RCA pending`);
    if (input.incidentCarePlanPending > 0) parts.push(`${input.incidentCarePlanPending} care plan pending`);
    items.push({
      id: "incident-followups",
      label: incidentLifecycleBlockers > 0 ? "Incident Lifecycle" : "Incident Follow-Ups",
      message:
        incidentLifecycleBlockers > 0
          ? `${parts.join(" · ")} incident workflow blocker${incidentLifecycleBlockers === 1 ? "" : "s"} need action.`
          : `${parts.join(" · ")} follow-up task${incidentFollowupBlockers === 1 ? "" : "s"} need action.`,
      tone: input.incidentEscalatedFollowups > 0 || input.incidentOpenObligations > 0 ? "critical" : "warning",
      href:
        incidentLifecycleBlockers > 0
          ? "/admin/incidents/obligations"
          : incidentFollowupHref,
      ctaLabel: incidentLifecycleBlockers > 0 ? "Work lifecycle queue" : "Work follow-ups",
    });
  }

  if (input.admissionsBlocked > 0) {
    items.push({
      id: "admissions-blocked",
      label: "Admissions",
      message: `${input.admissionsBlocked} admission case${input.admissionsBlocked === 1 ? "" : "s"} are blocked on move-in readiness.`,
      tone: "warning",
      href: "/admin/admissions/blocked",
      ctaLabel: "Clear blockers",
    });
  }

  if (input.admissionsOnboardingPending > 0) {
    items.push({
      id: "admissions-onboarding",
      label: "Onboarding",
      message: `${input.admissionsOnboardingPending} move-in case${input.admissionsOnboardingPending === 1 ? "" : "s"} still need downstream onboarding work.`,
      tone: "normal",
      href: "/admin/admissions/onboarding",
      ctaLabel: "Finish onboarding",
    });
  } else if (input.admissionsMoveInReady > 0) {
    items.push({
      id: "admissions-ready",
      label: "Admissions",
      message: `${input.admissionsMoveInReady} case${input.admissionsMoveInReady === 1 ? "" : "s"} are move-in ready and waiting for the next operational handoff.`,
      tone: "normal",
      href: "/admin/admissions/move-in-ready",
      ctaLabel: "Review ready cases",
    });
  }

  if (input.referralsBlockedHandoffs > 0) {
    items.push({
      id: "referral-handoff-blocked",
      label: "Referral Handoff",
      message: `${input.referralsBlockedHandoffs} lead${input.referralsBlockedHandoffs === 1 ? "" : "s"} crossed into admissions but are blocked before move-in readiness is complete.`,
      tone: "warning",
      href: "/admin/referrals/in-admissions?phase=blocked",
      ctaLabel: "Clear handoff blockers",
    });
  } else if (input.referralsOnboardingHandoffs > 0) {
    items.push({
      id: "referral-handoff-onboarding",
      label: "Referral Handoff",
      message: `${input.referralsOnboardingHandoffs} lead${input.referralsOnboardingHandoffs === 1 ? "" : "s"} are through move-in and now depend on downstream onboarding work.`,
      tone: "normal",
      href: "/admin/referrals/in-admissions?phase=onboarding",
      ctaLabel: "Open onboarding handoffs",
    });
  } else if (input.referralsReadyHandoffs > 0 || input.referralsInAdmissions > 0) {
    items.push({
      id: "referral-handoff",
      label: "Referral Handoff",
      message: `${input.referralsReadyHandoffs} lead${input.referralsReadyHandoffs === 1 ? "" : "s"} are move-in ready inside the admissions bridge out of ${input.referralsInAdmissions} active handoff${input.referralsInAdmissions === 1 ? "" : "s"}.`,
      tone: "normal",
      href: "/admin/referrals/in-admissions?phase=ready",
      ctaLabel: "Open ready handoffs",
    });
  }

  if (input.dischargePlanning > 0 || input.dischargePharmacistReview > 0 || input.dischargeReadyToComplete > 0) {
    const parts: string[] = [];
    if (input.dischargePlanning > 0) parts.push(`${input.dischargePlanning} planning`);
    if (input.dischargePharmacistReview > 0) parts.push(`${input.dischargePharmacistReview} pharmacist`);
    if (input.dischargeReadyToComplete > 0) parts.push(`${input.dischargeReadyToComplete} ready to complete`);
    const dischargeHref =
      input.dischargePlanning > 0
        ? "/admin/discharge?phase=planning"
        : input.dischargePharmacistReview > 0
          ? "/admin/discharge?phase=pharmacist_review"
          : "/admin/discharge?phase=ready_to_complete";
    const dischargeLabel =
      input.dischargePlanning > 0
        ? "Discharge Planning"
        : input.dischargePharmacistReview > 0
          ? "Pharmacist Review"
          : "Ready To Complete";
    items.push({
      id: "discharge-workflow",
      label: dischargeLabel,
      message: `${parts.join(" · ")} reconciliation${input.dischargePlanning + input.dischargePharmacistReview + input.dischargeReadyToComplete === 1 ? "" : "s"} need transition attention.`,
      tone: input.dischargePlanning > 0 ? "warning" : "normal",
      href: dischargeHref,
      ctaLabel: input.dischargePlanning > 0 ? "Open planning queue" : input.dischargePharmacistReview > 0 ? "Open pharmacist queue" : "Open ready queue",
    });
  }

  if (input.familyTriagePending > 0 || input.familyConferencesUpcoming > 0) {
    const parts: string[] = [];
    if (input.familyTriagePending > 0) parts.push(`${input.familyTriagePending} triage alert`);
    if (input.familyConferencesUpcoming > 0) parts.push(`${input.familyConferencesUpcoming} conference`);
    items.push({
      id: "family-workflow",
      label: input.familyTriagePending > 0 ? "Family Triage" : "Care Conferences",
      message: `${parts.join(" · ")}${input.familyTriagePending + input.familyConferencesUpcoming === 1 ? "" : "s"} need follow-through in the family lane.`,
      tone: input.familyTriagePending > 0 ? "warning" : "normal",
      href: input.familyTriagePending > 0
        ? "/admin/family-messages?filter=triage"
        : "/admin/family-portal?conference=upcoming#care-conferences",
      ctaLabel: input.familyTriagePending > 0 ? "Review messages" : "Work conference queue",
    });
  }

  return items;
}

function numericField(source: Record<string, unknown> | undefined, key: string): number {
  const value = source?.[key];
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapProjectionResident(row: ProjectionResidentRow): DashboardCensusRow {
  const firstName = row.first_name ?? "";
  const lastName = row.last_name ?? "";
  const name = `${firstName} ${lastName}`.trim() || "Unknown resident";
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";
  const room = row.room_number
    ? `${row.room_number}${row.bed_label ? `-${row.bed_label}` : ""}`
    : "Unassigned";
  const status = residencyUiLabel(row.status);

  return {
    id: row.id,
    name,
    initials,
    dobDisplay: formatDob(row.date_of_birth),
    room,
    acuity: mapAcuity(row.acuity_level),
    statusLabel: status.label,
    statusTone: status.tone,
    updatedRelative: formatRelativeShort(row.updated_at),
  };
}

function mapProjectionActivity(row: ProjectionActivityRow): DashboardActivityItem {
  const residentName =
    `${row.resident_first_name ?? ""} ${row.resident_last_name ?? ""}`.trim() ||
    "Resident";
  const tone: DashboardActivityItem["tone"] =
    row.severity === "level_4" || row.severity === "level_3"
      ? "critical"
      : row.severity === "level_2"
        ? "warning"
        : "normal";

  return {
    id: row.id,
    timeLabel: formatRelativeShort(row.occurred_at),
    actor: "Incident",
    message: `${residentName} · ${formatIncidentCategory(row.category)} (${row.status})`,
    tone,
    href: `/admin/incidents/${row.id}`,
    ctaLabel: tone === "critical" ? "Open critical incident" : "Open incident",
  };
}

/**
 * Fetches the complete Command Center read model in one PostgREST request.
 *
 * The RPC is SECURITY INVOKER and performs its own role/facility checks; RLS
 * continues to apply to every source table inside the projection.
 */
export async function fetchAdminDashboardSnapshot(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<AdminDashboardSnapshot> {
  const { data, error } = await supabase.rpc("admin_command_center_projection", {
    p_facility_id: isValidFacilityIdForQuery(selectedFacilityId)
      ? selectedFacilityId
      : null,
  });

  if (error) {
    throw new Error(error.message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Command Center projection returned an invalid payload.");
  }

  const projection = data as ProjectionPayload;
  const counts = projection.counts;
  const workflowSource = projection.workflowQueues;
  const assuranceSource = projection.residentAssurance;

  const workflowQueues: AdminDashboardSnapshot["workflowQueues"] = {
    doctrinePendingReview: numericField(workflowSource, "doctrinePendingReview"),
    doctrineBlockedReview: numericField(workflowSource, "doctrineBlockedReview"),
    doctrineReadyToPublish: numericField(workflowSource, "doctrineReadyToPublish"),
    doctrineDueSoon: numericField(workflowSource, "doctrineDueSoon"),
    doctrineOverdue: numericField(workflowSource, "doctrineOverdue"),
    incidentOverdueFollowups: numericField(workflowSource, "incidentOverdueFollowups"),
    incidentUnassignedFollowups: numericField(workflowSource, "incidentUnassignedFollowups"),
    incidentEscalatedFollowups: numericField(workflowSource, "incidentEscalatedFollowups"),
    incidentOpenObligations: numericField(workflowSource, "incidentOpenObligations"),
    incidentRootCausePending: numericField(workflowSource, "incidentRootCausePending"),
    incidentCarePlanPending: numericField(workflowSource, "incidentCarePlanPending"),
    admissionsBlocked: numericField(workflowSource, "admissionsBlocked"),
    admissionsMoveInReady: numericField(workflowSource, "admissionsMoveInReady"),
    admissionsOnboardingPending: numericField(workflowSource, "admissionsOnboardingPending"),
    referralsInAdmissions: numericField(workflowSource, "referralsInAdmissions"),
    referralsBlockedHandoffs: numericField(workflowSource, "referralsBlockedHandoffs"),
    referralsReadyHandoffs: numericField(workflowSource, "referralsReadyHandoffs"),
    referralsOnboardingHandoffs: numericField(workflowSource, "referralsOnboardingHandoffs"),
    dischargePlanning: numericField(workflowSource, "dischargePlanning"),
    dischargePharmacistReview: numericField(workflowSource, "dischargePharmacistReview"),
    dischargeReadyToComplete: numericField(workflowSource, "dischargeReadyToComplete"),
    familyTriagePending: numericField(workflowSource, "familyTriagePending"),
    familyConferencesUpcoming: numericField(workflowSource, "familyConferencesUpcoming"),
  };

  const timezoneLabel = projection.timezoneLabel?.trim() || "America/New_York";
  const licensedBeds =
    projection.licensedBeds == null
      ? null
      : numericField({ value: projection.licensedBeds }, "value");

  return {
    headlineName: projection.headlineName?.trim() || "All facilities",
    timezoneLabel,
    shiftSummary: shiftSummaryForTimezone(timezoneLabel),
    residentCount: numericField(counts, "residentCount"),
    awayResidentCount: numericField(counts, "awayResidentCount"),
    licensedBeds,
    activeStaffCount: numericField(counts, "activeStaffCount"),
    openIncidentAlerts: numericField(counts, "openIncidentAlerts"),
    staffingGapSnapshots24h: numericField(counts, "staffingGapSnapshots24h"),
    medicationErrorsUnreviewed: numericField(counts, "medicationErrorsUnreviewed"),
    expiringCertifications30d: numericField(counts, "expiringCertifications30d"),
    workflowQueues,
    residentAssurance: {
      activeWatches: numericField(assuranceSource, "activeWatches"),
      pendingWatchApprovals: numericField(assuranceSource, "pendingWatchApprovals"),
      openEscalations: numericField(assuranceSource, "openEscalations"),
      openIntegrityFlags: numericField(assuranceSource, "openIntegrityFlags"),
      criticalSafetyResidents: numericField(assuranceSource, "criticalSafetyResidents"),
      highOrCriticalSafetyResidents: numericField(
        assuranceSource,
        "highOrCriticalSafetyResidents",
      ),
    },
    workflowInbox: buildWorkflowInbox(workflowQueues),
    censusPreview: (projection.censusPreview ?? []).map(mapProjectionResident),
    acuityWatchlist: (projection.acuityWatchlist ?? []).map(mapProjectionResident),
    activity: (projection.activity ?? []).map(mapProjectionActivity),
  };
}
