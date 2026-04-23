import type { SupabaseClient } from "@supabase/supabase-js";

import { buildIncidentOpenObligations } from "@/lib/incidents/workflow-obligations";
import { fetchResidentAssuranceCommandBrief } from "@/lib/resident-assurance/command-center-brief";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

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

type SupabaseResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string;
  status: string | null;
  acuity_level: string | null;
  updated_at: string | null;
  date_of_birth: string;
  deleted_at: string | null;
};

type SupabaseBedRow = {
  id: string;
  room_id: string | null;
  bed_label: string;
  current_resident_id: string | null;
};

type SupabaseFacilityRow = {
  id: string;
  name: string;
  total_licensed_beds: number;
  timezone: string;
  deleted_at: string | null;
};

type SupabaseIncidentFeedRow = {
  id: string;
  occurred_at: string;
  category: string;
  severity: string;
  status: string;
  resident_id: string | null;
};

type SupabaseDoctrineDocMini = {
  id: string;
  review_owner: string | null;
  review_due_at: string | null;
};

type SupabaseIncidentMini = {
  id: string;
  severity: string;
  nurse_notified: boolean;
  administrator_notified: boolean;
  owner_notified: boolean;
  physician_notified: boolean;
  family_notified: boolean;
  ahca_reportable: boolean;
  ahca_reported: boolean;
  insurance_reportable: boolean;
  insurance_reported: boolean;
  care_plan_updated: boolean;
  resolved_at: string | null;
};

type SupabaseIncidentRcaMini = {
  incident_id: string;
  investigation_status: string;
};

type SupabaseAdmissionMini = {
  id: string;
  resident_id: string;
  referral_lead_id: string | null;
  status: string;
  target_move_in_date: string | null;
  financial_clearance_at: string | null;
  physician_orders_received_at: string | null;
  bed_id: string | null;
};

type SupabaseDischargeMini = {
  id: string;
  status: string;
  nurse_reconciliation_notes: string | null;
  pharmacist_npi: string | null;
  pharmacist_notes: string | null;
  residents: {
    discharge_target_date: string | null;
    hospice_status: string;
  } | null;
};

type SupabaseFamilyConferenceMini = {
  id: string;
  scheduled_start: string;
};

type SupabaseResidentMini = { id: string; first_name: string | null; last_name: string | null };

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

function isDueSoon(value: string | null, today: Date): boolean {
  if (!value) return false;
  const due = new Date(value);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays <= 3;
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

export async function fetchAdminDashboardSnapshot(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<AdminDashboardSnapshot> {
  const residentAssuranceBriefPromise = fetchResidentAssuranceCommandBrief(selectedFacilityId, supabase);

  let facilitiesQuery = supabase
    .from("facilities" as never)
    .select("id, name, total_licensed_beds, timezone, deleted_at")
    .is("deleted_at", null);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    facilitiesQuery = facilitiesQuery.eq("id", selectedFacilityId);
  }

  let residentsCountQuery = supabase
    .from("residents" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"]);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    residentsCountQuery = residentsCountQuery.eq("facility_id", selectedFacilityId);
  }

  let staffCountQuery = supabase
    .from("staff" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("employment_status", "active");

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    staffCountQuery = staffCountQuery.eq("facility_id", selectedFacilityId);
  }

  let incidentsCountQuery = supabase
    .from("incidents" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["open", "investigating"]);

  let staffingGapSnapshotsQuery = supabase
    .from("staffing_ratio_snapshots" as never)
    .select("id", { count: "exact", head: true })
    .eq("is_compliant", false)
    .gte("snapshot_at", new Date(Date.now() - 24 * 3_600_000).toISOString());

  let medicationErrorsQuery = supabase
    .from("medication_errors" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("reviewed_at", null);

  const todayDate = new Date();
  const todayIso = todayDate.toISOString().slice(0, 10);
  const in30Date = new Date(todayDate);
  in30Date.setUTCDate(in30Date.getUTCDate() + 30);
  const in30Iso = in30Date.toISOString().slice(0, 10);
  let expiringCertificationsQuery = supabase
    .from("staff_certifications" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "active")
    .not("expiration_date", "is", null)
    .gte("expiration_date", todayIso)
    .lte("expiration_date", in30Iso);

  let awayResidentsCountQuery = supabase
    .from("residents" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["hospital_hold", "loa"]);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    incidentsCountQuery = incidentsCountQuery.eq("facility_id", selectedFacilityId);
    staffingGapSnapshotsQuery = staffingGapSnapshotsQuery.eq("facility_id", selectedFacilityId);
    medicationErrorsQuery = medicationErrorsQuery.eq("facility_id", selectedFacilityId);
    expiringCertificationsQuery = expiringCertificationsQuery.eq("facility_id", selectedFacilityId);
    awayResidentsCountQuery = awayResidentsCountQuery.eq("facility_id", selectedFacilityId);
  }

  let residentsPreviewQuery = supabase
    .from("residents" as never)
    .select(
      "id, first_name, last_name, facility_id, status, acuity_level, updated_at, date_of_birth, deleted_at",
    )
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .order("updated_at", { ascending: false })
    .limit(8);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    residentsPreviewQuery = residentsPreviewQuery.eq("facility_id", selectedFacilityId);
  }

  let acuityWatchlistQuery = supabase
    .from("residents" as never)
    .select(
      "id, first_name, last_name, facility_id, status, acuity_level, updated_at, date_of_birth, deleted_at",
    )
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .in("acuity_level", ["level_2", "level_3"])
    .order("acuity_level", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(4);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    acuityWatchlistQuery = acuityWatchlistQuery.eq("facility_id", selectedFacilityId);
  }

  let incidentsFeedQuery = supabase
    .from("incidents" as never)
    .select("id, occurred_at, category, severity, status, resident_id, deleted_at")
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(6);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    incidentsFeedQuery = incidentsFeedQuery.eq("facility_id", selectedFacilityId);
  }

  let doctrinePendingQuery = supabase
    .from("documents" as never)
    .select("id, review_owner, review_due_at", { count: "exact" })
    .eq("status", "pending_review")
    .is("deleted_at", null);

  let incidentOverdueFollowupsQuery = supabase
    .from("incident_followups" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("completed_at", null)
    .lt("due_at", new Date().toISOString());

  let incidentUnassignedFollowupsQuery = supabase
    .from("incident_followups" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("completed_at", null)
    .is("assigned_to", null);

  let incidentEscalatedFollowupsQuery = supabase
    .from("incident_followups" as never)
    .select("id, due_at", { count: "exact" })
    .is("deleted_at", null)
    .is("completed_at", null)
    .lt("due_at", new Date(Date.now() - 48 * 3_600_000).toISOString());

  let incidentWorkflowQuery = supabase
    .from("incidents" as never)
    .select("id, severity, nurse_notified, administrator_notified, owner_notified, physician_notified, family_notified, ahca_reportable, ahca_reported, insurance_reportable, insurance_reported, care_plan_updated, resolved_at")
    .is("deleted_at", null)
    .in("status", ["open", "investigating", "resolved"]);

  let incidentRcaQuery = supabase
    .from("incident_rca" as never)
    .select("incident_id, investigation_status");

  let admissionsQueueQuery = supabase
    .from("admission_cases" as never)
    .select("id, resident_id, referral_lead_id, status, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id")
    .is("deleted_at", null)
    .not("status", "eq", "cancelled");

  let dischargeQueueQuery = supabase
    .from("discharge_med_reconciliation" as never)
    .select("id, status, nurse_reconciliation_notes, pharmacist_npi, pharmacist_notes, residents(discharge_target_date, hospice_status)")
    .is("deleted_at", null);

  let familyTriageQuery = supabase
    .from("family_message_triage_items" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("triage_status", ["pending_review", "in_review"]);

  let familyConferenceQuery = supabase
    .from("family_care_conference_sessions" as never)
    .select("id, scheduled_start", { count: "exact" })
    .is("deleted_at", null)
    .gte("scheduled_start", new Date().toISOString());

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    doctrinePendingQuery = doctrinePendingQuery.eq("facility_id", selectedFacilityId);
    incidentOverdueFollowupsQuery = incidentOverdueFollowupsQuery.eq("facility_id", selectedFacilityId);
    incidentUnassignedFollowupsQuery = incidentUnassignedFollowupsQuery.eq("facility_id", selectedFacilityId);
    incidentEscalatedFollowupsQuery = incidentEscalatedFollowupsQuery.eq("facility_id", selectedFacilityId);
    incidentWorkflowQuery = incidentWorkflowQuery.eq("facility_id", selectedFacilityId);
    incidentRcaQuery = incidentRcaQuery.eq("facility_id", selectedFacilityId);
    admissionsQueueQuery = admissionsQueueQuery.eq("facility_id", selectedFacilityId);
    dischargeQueueQuery = dischargeQueueQuery.eq("facility_id", selectedFacilityId);
    familyTriageQuery = familyTriageQuery.eq("facility_id", selectedFacilityId);
    familyConferenceQuery = familyConferenceQuery.eq("facility_id", selectedFacilityId);
  }

  const [
    facilitiesResult,
    residentsCountRes,
    staffCountRes,
    incidentsCountRes,
    staffingGapSnapshotsRes,
    medicationErrorsRes,
    expiringCertificationsRes,
    awayResidentsCountRes,
    residentsPreviewResult,
    acuityWatchlistResult,
    incidentsFeedResult,
    doctrinePendingResult,
    incidentOverdueFollowupsRes,
    incidentUnassignedFollowupsRes,
    incidentEscalatedFollowupsRes,
    incidentWorkflowRes,
    incidentRcaRes,
    admissionsQueueRes,
    dischargeQueueRes,
    familyTriageRes,
    familyConferenceRes,
    residentAssuranceBrief,
  ] = await Promise.all([
    facilitiesQuery as unknown as Promise<QueryResult<SupabaseFacilityRow[]>>,
    residentsCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    staffCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentsCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    staffingGapSnapshotsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    medicationErrorsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    expiringCertificationsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    awayResidentsCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    residentsPreviewQuery as unknown as Promise<QueryResult<SupabaseResidentRow[]>>,
    acuityWatchlistQuery as unknown as Promise<QueryResult<SupabaseResidentRow[]>>,
    incidentsFeedQuery as unknown as Promise<QueryResult<SupabaseIncidentFeedRow[]>>,
    doctrinePendingQuery as unknown as Promise<QueryResult<SupabaseDoctrineDocMini[]>>,
    incidentOverdueFollowupsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentUnassignedFollowupsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentEscalatedFollowupsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentWorkflowQuery as unknown as Promise<QueryResult<SupabaseIncidentMini[]>>,
    incidentRcaQuery as unknown as Promise<QueryResult<SupabaseIncidentRcaMini[]>>,
    admissionsQueueQuery as unknown as Promise<QueryResult<SupabaseAdmissionMini[]>>,
    dischargeQueueQuery as unknown as Promise<QueryResult<SupabaseDischargeMini[]>>,
    familyTriageQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    familyConferenceQuery as unknown as Promise<QueryResult<SupabaseFamilyConferenceMini[]>>,
    residentAssuranceBriefPromise,
  ]);

  const firstError = [
    facilitiesResult.error && { table: "facilities", ...facilitiesResult.error },
    residentsCountRes.error && { table: "residents", ...residentsCountRes.error },
    staffCountRes.error && { table: "staff", ...staffCountRes.error },
    incidentsCountRes.error && { table: "incidents", ...incidentsCountRes.error },
    staffingGapSnapshotsRes.error && { table: "staffing_ratio_snapshots", ...staffingGapSnapshotsRes.error },
    medicationErrorsRes.error && { table: "medication_errors", ...medicationErrorsRes.error },
    expiringCertificationsRes.error && { table: "staff_certifications", ...expiringCertificationsRes.error },
    awayResidentsCountRes.error && { table: "residents_away_count", ...awayResidentsCountRes.error },
    residentsPreviewResult.error && { table: "residents_preview", ...residentsPreviewResult.error },
    acuityWatchlistResult.error && { table: "residents_acuity_watchlist", ...acuityWatchlistResult.error },
    incidentsFeedResult.error && { table: "incidents_feed", ...incidentsFeedResult.error },
    doctrinePendingResult.error && { table: "documents_pending_review", ...doctrinePendingResult.error },
    incidentOverdueFollowupsRes.error && { table: "incident_followups_overdue", ...incidentOverdueFollowupsRes.error },
    incidentUnassignedFollowupsRes.error && { table: "incident_followups_unassigned", ...incidentUnassignedFollowupsRes.error },
    incidentEscalatedFollowupsRes.error && { table: "incident_followups_escalated", ...incidentEscalatedFollowupsRes.error },
    incidentWorkflowRes.error && { table: "incidents_workflow", ...incidentWorkflowRes.error },
    incidentRcaRes.error && { table: "incident_rca", ...incidentRcaRes.error },
    admissionsQueueRes.error && { table: "admission_cases_queue", ...admissionsQueueRes.error },
    dischargeQueueRes.error && { table: "discharge_med_reconciliation", ...dischargeQueueRes.error },
    familyTriageRes.error && { table: "family_message_triage_items", ...familyTriageRes.error },
    familyConferenceRes.error && { table: "family_care_conference_sessions", ...familyConferenceRes.error },
  ].find(Boolean);

  if (firstError) {
    const table = (firstError as Record<string, unknown>).table ?? "unknown";
    const code = (firstError as Record<string, unknown>).code ?? "";
    console.error("[Haven] Admin dashboard query failed", firstError);
    throw new Error(`${firstError.message}${code ? ` [${code}]` : ""} (table: ${table})`);
  }

  const facilityRows = facilitiesResult.data ?? [];
  const licensedBedsSum = facilityRows.reduce((acc, f) => acc + (f.total_licensed_beds ?? 0), 0);
  const primaryTz = facilityRows[0]?.timezone?.trim() || "America/New_York";
  const headlineName =
    isValidFacilityIdForQuery(selectedFacilityId) && facilityRows.length === 1
      ? facilityRows[0].name
      : "All facilities";

  const previewResidents = residentsPreviewResult.data ?? [];
  const watchlistResidents = acuityWatchlistResult.data ?? [];
  const incidentRows = incidentsFeedResult.data ?? [];

  const pendingDoctrineDocs = doctrinePendingResult.data ?? [];
  const doctrineDocIds = pendingDoctrineDocs.map((doc) => doc.id);

  const admissionQueueRowsAll = admissionsQueueRes.data ?? [];
  const moveInResidentIdsAll = admissionQueueRowsAll
    .filter((row) => row.status === "move_in")
    .map((row) => row.resident_id);

  type DoctrineAuditRow = { document_id: string; event_type: string; created_at: string };
  type MoveInReadinessResult = { data: Array<{ resident_id: string }> | null; error: QueryError | null };

  const doctrineDraftCreatedPromise: Promise<QueryResult<DoctrineAuditRow[]>> =
    doctrineDocIds.length > 0
      ? ((supabase
          .from("document_audit_events" as never)
          .select("document_id, event_type, created_at")
          .in("document_id", doctrineDocIds)
          .in("event_type", ["obsidian_draft_created", "review_completed"])) as unknown as Promise<
          QueryResult<DoctrineAuditRow[]>
        >)
      : Promise.resolve({ data: [], error: null } as QueryResult<DoctrineAuditRow[]>);

  const makeMoveInReadinessPromise = (table: string): Promise<MoveInReadinessResult> =>
    moveInResidentIdsAll.length > 0
      ? ((supabase
          .from(table as never)
          .select("resident_id")
          .in("resident_id", moveInResidentIdsAll)
          .is("deleted_at", null)) as unknown as Promise<MoveInReadinessResult>)
      : Promise.resolve({ data: [], error: null } as MoveInReadinessResult);

  // Fuse what used to be three serial phases — the census/watchlist/activity
  // maps, the doctrine draft lookup, and the move-in readiness batch — into a
  // single parallel phase. Every item here only depends on Phase 1's results,
  // not on each other, so there is no reason to await them in sequence.
  const [
    censusPreview,
    acuityWatchlist,
    activity,
    doctrineDraftCreatedRes,
    carePlansRes,
    medsRes,
    payersRes,
    consentsRes,
  ] = await Promise.all([
    mapResidentsToCensusRows(supabase, previewResidents),
    mapResidentsToCensusRows(supabase, watchlistResidents),
    mapIncidentsToActivity(supabase, incidentRows),
    doctrineDraftCreatedPromise,
    makeMoveInReadinessPromise("care_plans"),
    makeMoveInReadinessPromise("resident_medications"),
    makeMoveInReadinessPromise("resident_payers"),
    makeMoveInReadinessPromise("family_consent_records"),
  ]);

  const residentCount = residentsCountRes.count ?? 0;
  const awayResidentCount = awayResidentsCountRes.count ?? 0;
  const activeStaffCount = staffCountRes.count ?? 0;
  const openIncidentAlerts = incidentsCountRes.count ?? 0;
  const staffingGapSnapshots24h = staffingGapSnapshotsRes.count ?? 0;
  const medicationErrorsUnreviewed = medicationErrorsRes.count ?? 0;
  const expiringCertifications30d = expiringCertificationsRes.count ?? 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (doctrineDraftCreatedRes.error) {
    throw doctrineDraftCreatedRes.error;
  }
  const doctrineAuditEvents = doctrineDraftCreatedRes.data ?? [];
  const latestDraftAtByDoc = new Map<string, string>();
  const latestReviewCompleteAtByDoc = new Map<string, string>();
  for (const row of doctrineAuditEvents) {
    if (row.event_type === "obsidian_draft_created" && !latestDraftAtByDoc.has(row.document_id)) {
      latestDraftAtByDoc.set(row.document_id, row.created_at);
    }
    if (row.event_type === "review_completed" && !latestReviewCompleteAtByDoc.has(row.document_id)) {
      latestReviewCompleteAtByDoc.set(row.document_id, row.created_at);
    }
  }
  const draftCreatedIds = new Set(Array.from(latestDraftAtByDoc.keys()));
  const reviewCompletedIds = new Set(
    pendingDoctrineDocs
      .filter((doc) => {
        const draftAt = latestDraftAtByDoc.get(doc.id);
        const reviewAt = latestReviewCompleteAtByDoc.get(doc.id);
        if (!reviewAt) return false;
        if (!draftAt) return true;
        return new Date(reviewAt).getTime() >= new Date(draftAt).getTime();
      })
      .map((doc) => doc.id),
  );
  const doctrineBlockedReview = pendingDoctrineDocs.filter(
    (doc) => !doc.review_owner || !doc.review_due_at || !draftCreatedIds.has(doc.id) || !reviewCompletedIds.has(doc.id),
  ).length;
  const doctrineReadyToPublish = pendingDoctrineDocs.length - doctrineBlockedReview;
  const doctrineDueSoon = pendingDoctrineDocs.filter((doc) => isDueSoon(doc.review_due_at, today)).length;
  const doctrineOverdue = pendingDoctrineDocs.filter((doc) => {
    if (!doc.review_due_at) return false;
    const due = new Date(doc.review_due_at);
    due.setHours(0, 0, 0, 0);
    return due < today;
  }).length;
  const incidentWorkflowRows = incidentWorkflowRes.data ?? [];
  const incidentRcaById = new Map((incidentRcaRes.data ?? []).map((row) => [row.incident_id, row.investigation_status] as const));
  const incidentOpenObligations = incidentWorkflowRows.filter((row) => buildIncidentOpenObligations(row).length > 0).length;
  const incidentRootCausePending = incidentWorkflowRows.filter((row) => {
    const rootCauseExpected = row.severity === "level_3" || row.severity === "level_4";
    return rootCauseExpected && incidentRcaById.get(row.id) !== "complete";
  }).length;
  const incidentCarePlanPending = incidentWorkflowRows.filter((row) => {
    return Boolean(row.resolved_at) && !row.care_plan_updated && (row.severity === "level_3" || row.severity === "level_4");
  }).length;

  const admissionQueueRows = admissionQueueRowsAll;
  const admissionsBlocked = admissionQueueRows.filter((row) => {
    return !row.financial_clearance_at || !row.physician_orders_received_at || !row.bed_id || !row.target_move_in_date;
  }).length;
  const admissionsMoveInReady = admissionQueueRows.filter((row) => {
    return Boolean(row.financial_clearance_at && row.physician_orders_received_at && row.bed_id && row.target_move_in_date);
  }).length;
  const referralsInAdmissions = admissionQueueRows.filter((row) => Boolean(row.referral_lead_id)).length;

  // Move-in readiness Sets now derive from the Phase-2 batch that ran in
  // parallel with the census/watchlist/activity maps — no extra round-trip.
  const moveInResidentIds = moveInResidentIdsAll;
  const carePlanIds = new Set(((carePlansRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
  const medIds = new Set(((medsRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
  const payerIds = new Set(((payersRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
  const consentIds = new Set(((consentsRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
  const admissionsOnboardingPending = moveInResidentIds.filter((residentId) => {
    return !(carePlanIds.has(residentId) && medIds.has(residentId) && payerIds.has(residentId) && consentIds.has(residentId));
  }).length;

  let referralsBlockedHandoffs = 0;
  let referralsReadyHandoffs = 0;
  let referralsOnboardingHandoffs = 0;
  for (const row of admissionQueueRows) {
    if (!row.referral_lead_id) continue;
    const blocked = !row.financial_clearance_at || !row.physician_orders_received_at || !row.bed_id || !row.target_move_in_date;
    if (blocked) {
      referralsBlockedHandoffs += 1;
      continue;
    }
    if (row.status !== "move_in") {
      referralsReadyHandoffs += 1;
      continue;
    }
    const residentId = row.resident_id;
    const onboardingMissing =
      !carePlanIds.has(residentId) ||
      !medIds.has(residentId) ||
      !payerIds.has(residentId) ||
      !consentIds.has(residentId);
    if (onboardingMissing) {
      referralsOnboardingHandoffs += 1;
    }
  }

  const dischargeRows = dischargeQueueRes.data ?? [];
  let dischargePlanning = 0;
  let dischargePharmacistReview = 0;
  let dischargeReadyToComplete = 0;
  for (const row of dischargeRows) {
    const phase = describeDischargePhase(row);
    if (phase === "planning") dischargePlanning += 1;
    if (phase === "pharmacist_review") dischargePharmacistReview += 1;
    if (phase === "ready_to_complete") dischargeReadyToComplete += 1;
  }
  const familyTriagePending = familyTriageRes.count ?? 0;
  const familyConferencesUpcoming = (familyConferenceRes.data ?? []).length;

  return {
    headlineName,
    timezoneLabel: primaryTz,
    shiftSummary: shiftSummaryForTimezone(primaryTz),
    residentCount,
    awayResidentCount,
    licensedBeds: licensedBedsSum > 0 ? licensedBedsSum : null,
    activeStaffCount,
    openIncidentAlerts,
    staffingGapSnapshots24h,
    medicationErrorsUnreviewed,
    expiringCertifications30d,
    workflowQueues: {
      doctrinePendingReview: pendingDoctrineDocs.length,
      doctrineBlockedReview,
      doctrineReadyToPublish,
      doctrineDueSoon,
      doctrineOverdue,
      incidentOverdueFollowups: incidentOverdueFollowupsRes.count ?? 0,
      incidentUnassignedFollowups: incidentUnassignedFollowupsRes.count ?? 0,
      incidentEscalatedFollowups: incidentEscalatedFollowupsRes.count ?? 0,
      incidentOpenObligations,
      incidentRootCausePending,
      incidentCarePlanPending,
      admissionsBlocked,
      admissionsMoveInReady,
      admissionsOnboardingPending,
      referralsInAdmissions,
      referralsBlockedHandoffs,
      referralsReadyHandoffs,
      referralsOnboardingHandoffs,
      dischargePlanning,
      dischargePharmacistReview,
      dischargeReadyToComplete,
      familyTriagePending,
      familyConferencesUpcoming,
    },
    residentAssurance: {
      activeWatches: residentAssuranceBrief.activeWatches,
      pendingWatchApprovals: residentAssuranceBrief.pendingWatchApprovals,
      openEscalations: residentAssuranceBrief.openEscalations,
      openIntegrityFlags: residentAssuranceBrief.openIntegrityFlags,
      criticalSafetyResidents: residentAssuranceBrief.criticalSafetyResidents,
      highOrCriticalSafetyResidents: residentAssuranceBrief.highOrCriticalSafetyResidents,
    },
    workflowInbox: buildWorkflowInbox({
      doctrinePendingReview: pendingDoctrineDocs.length,
      doctrineBlockedReview,
      doctrineReadyToPublish,
      doctrineDueSoon,
      doctrineOverdue,
      incidentOverdueFollowups: incidentOverdueFollowupsRes.count ?? 0,
      incidentUnassignedFollowups: incidentUnassignedFollowupsRes.count ?? 0,
      incidentEscalatedFollowups: incidentEscalatedFollowupsRes.count ?? 0,
      incidentOpenObligations,
      incidentRootCausePending,
      incidentCarePlanPending,
      admissionsBlocked,
      admissionsMoveInReady,
      admissionsOnboardingPending,
      referralsInAdmissions,
      referralsBlockedHandoffs,
      referralsReadyHandoffs,
      referralsOnboardingHandoffs,
      dischargePlanning,
      dischargePharmacistReview,
      dischargeReadyToComplete,
      familyTriagePending,
      familyConferencesUpcoming,
    }),
    censusPreview,
    acuityWatchlist,
    activity,
  };
}

function describeDischargePhase(row: SupabaseDischargeMini): "planning" | "pharmacist_review" | "ready_to_complete" | "complete" | "cancelled" {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "complete") return "complete";
  if (!row.residents?.discharge_target_date) return "planning";
  if (row.residents?.hospice_status === "pending") return "planning";
  if (!row.nurse_reconciliation_notes?.trim()) return "planning";
  if (row.status === "draft") return "pharmacist_review";
  if (!row.pharmacist_npi?.trim() || !row.pharmacist_notes?.trim()) return "pharmacist_review";
  return "ready_to_complete";
}

async function mapResidentsToCensusRows(
  supabase: ReturnType<typeof createClient>,
  residents: SupabaseResidentRow[],
): Promise<DashboardCensusRow[]> {
  if (residents.length === 0) {
    return [];
  }

  const residentIds = residents.map((r) => r.id);

  // Single nested-select replaces the old beds → rooms two-step chain.
  // PostgREST walks beds.room_id → rooms in the same request. RLS still
  // applies to both joined tables.
  type BedJoinRow = SupabaseBedRow & { rooms: { id: string; room_number: string | null; unit_id: string | null } | null };
  const bedsResult = (await supabase
    .from("beds" as never)
    .select("id, room_id, bed_label, current_resident_id, rooms ( id, room_number, unit_id )")
    .in("current_resident_id", residentIds)) as unknown as QueryResult<BedJoinRow>;
  if (bedsResult.error) {
    throw bedsResult.error;
  }
  const beds: BedJoinRow[] = Array.isArray(bedsResult.data) ? bedsResult.data : [];

  const bedByResident = new Map(
    beds.filter((b) => b.current_resident_id).map((b) => [b.current_resident_id as string, b] as const),
  );

  return residents.map((resident) => {
    const firstName = resident.first_name ?? "";
    const lastName = resident.last_name ?? "";
    const fullName = `${firstName} ${lastName}`.trim() || "Unknown resident";
    const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";
    const bed = bedByResident.get(resident.id);
    const room = bed?.rooms ?? null;
    const roomLabel = room?.room_number
      ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
      : "Unassigned";
    const acuity = mapAcuity(resident.acuity_level);
    const { label, tone } = residencyUiLabel(resident.status);

    return {
      id: resident.id,
      name: fullName,
      initials,
      dobDisplay: formatDob(resident.date_of_birth),
      room: roomLabel,
      acuity,
      statusLabel: label,
      statusTone: tone,
      updatedRelative: formatRelativeShort(resident.updated_at),
    };
  });
}

async function mapIncidentsToActivity(
  supabase: ReturnType<typeof createClient>,
  incidents: SupabaseIncidentFeedRow[],
): Promise<DashboardActivityItem[]> {
  if (incidents.length === 0) {
    return [];
  }

  const residentIds = Array.from(
    new Set(
      incidents.map((i) => i.resident_id).filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const residentsResult = residentIds.length
    ? ((await supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .in("id", residentIds)) as unknown as QueryResult<SupabaseResidentMini[]>)
    : ({ data: [], error: null } as QueryResult<SupabaseResidentMini[]>);
  if (residentsResult.error) {
    throw residentsResult.error;
  }
  const resById = new Map((residentsResult.data ?? []).map((r) => [r.id, r] as const));

  return incidents.map((row) => {
    const res = row.resident_id ? resById.get(row.resident_id) : null;
    const resName = res
      ? `${res.first_name ?? ""} ${res.last_name ?? ""}`.trim() || "Resident"
      : "Resident";
    const sev = row.severity ?? "";
    const tone: DashboardActivityItem["tone"] =
      sev === "level_4" || sev === "level_3" ? "critical" : sev === "level_2" ? "warning" : "normal";
    const message = `${resName} · ${formatIncidentCategory(row.category)} (${row.status})`;

    return {
      id: row.id,
      timeLabel: formatRelativeShort(row.occurred_at),
      actor: "Incident",
      message,
      tone,
      href: `/admin/incidents/${row.id}`,
      ctaLabel: tone === "critical" ? "Open critical incident" : "Open incident",
    };
  });
}
