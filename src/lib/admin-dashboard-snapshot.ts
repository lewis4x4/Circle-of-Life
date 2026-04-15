import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

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
  licensedBeds: number | null;
  activeStaffCount: number;
  openIncidentAlerts: number;
  workflowQueues: {
    doctrinePendingReview: number;
    doctrineBlockedReview: number;
    doctrineReadyToPublish: number;
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
  };
  workflowInbox: WorkflowInboxItem[];
  censusPreview: DashboardCensusRow[];
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

type SupabaseRoomRow = { id: string; room_number: string; unit_id: string | null };

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

function buildWorkflowInbox(input: {
  doctrineBlockedReview: number;
  doctrinePendingReview: number;
  doctrineReadyToPublish: number;
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
}): WorkflowInboxItem[] {
  const items: WorkflowInboxItem[] = [];

  if (input.doctrineBlockedReview > 0) {
    items.push({
      id: "doctrine-blocked",
      label: "Doctrine Review",
      message: `${input.doctrineBlockedReview} document${input.doctrineBlockedReview === 1 ? "" : "s"} are blocked in review out of ${input.doctrinePendingReview} pending.`,
      tone: "warning",
      href: "/admin/knowledge/admin",
      ctaLabel: "Review doctrine",
    });
  }

  if (input.doctrineReadyToPublish > 0) {
    items.push({
      id: "doctrine-ready",
      label: "Doctrine Review",
      message: `${input.doctrineReadyToPublish} document${input.doctrineReadyToPublish === 1 ? "" : "s"} cleared review prerequisites and are ready for publication.`,
      tone: "normal",
      href: "/admin/knowledge/admin",
      ctaLabel: "Review ready docs",
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
      label: "Incident Follow-Ups",
      message: `${parts.join(" · ")} follow-up task${input.incidentOverdueFollowups + input.incidentUnassignedFollowups === 1 ? "" : "s"} need action.`,
      tone: input.incidentEscalatedFollowups > 0 || input.incidentOpenObligations > 0 ? "critical" : "warning",
      href: input.incidentOverdueFollowups > 0 ? "/admin/incidents/overdue-followups" : "/admin/incidents/followups",
      ctaLabel: "Work follow-ups",
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
      href: "/admin/referrals/in-admissions",
      ctaLabel: "Clear handoff blockers",
    });
  } else if (input.referralsOnboardingHandoffs > 0) {
    items.push({
      id: "referral-handoff-onboarding",
      label: "Referral Handoff",
      message: `${input.referralsOnboardingHandoffs} lead${input.referralsOnboardingHandoffs === 1 ? "" : "s"} are through move-in and now depend on downstream onboarding work.`,
      tone: "normal",
      href: "/admin/referrals/in-admissions",
      ctaLabel: "Track onboarding handoffs",
    });
  } else if (input.referralsReadyHandoffs > 0 || input.referralsInAdmissions > 0) {
    items.push({
      id: "referral-handoff",
      label: "Referral Handoff",
      message: `${input.referralsReadyHandoffs} lead${input.referralsReadyHandoffs === 1 ? "" : "s"} are move-in ready inside the admissions bridge out of ${input.referralsInAdmissions} active handoff${input.referralsInAdmissions === 1 ? "" : "s"}.`,
      tone: "normal",
      href: "/admin/referrals/in-admissions",
      ctaLabel: "Track handoffs",
    });
  }

  return items;
}

export async function fetchAdminDashboardSnapshot(
  selectedFacilityId: string | null,
): Promise<AdminDashboardSnapshot> {
  const supabase = createClient();

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

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    incidentsCountQuery = incidentsCountQuery.eq("facility_id", selectedFacilityId);
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
    .in("status", ["open", "investigating", "in_review", "regulatory_review", "resolved"]);

  let incidentRcaQuery = supabase
    .from("incident_rca" as never)
    .select("incident_id, investigation_status");

  let admissionsQueueQuery = supabase
    .from("admission_cases" as never)
    .select("id, resident_id, referral_lead_id, status, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id")
    .is("deleted_at", null)
    .not("status", "eq", "cancelled");

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    doctrinePendingQuery = doctrinePendingQuery.eq("facility_id", selectedFacilityId);
    incidentOverdueFollowupsQuery = incidentOverdueFollowupsQuery.eq("facility_id", selectedFacilityId);
    incidentUnassignedFollowupsQuery = incidentUnassignedFollowupsQuery.eq("facility_id", selectedFacilityId);
    incidentEscalatedFollowupsQuery = incidentEscalatedFollowupsQuery.eq("facility_id", selectedFacilityId);
    incidentWorkflowQuery = incidentWorkflowQuery.eq("facility_id", selectedFacilityId);
    incidentRcaQuery = incidentRcaQuery.eq("facility_id", selectedFacilityId);
    admissionsQueueQuery = admissionsQueueQuery.eq("facility_id", selectedFacilityId);
  }

  const [
    facilitiesResult,
    residentsCountRes,
    staffCountRes,
    incidentsCountRes,
    residentsPreviewResult,
    incidentsFeedResult,
    doctrinePendingResult,
    incidentOverdueFollowupsRes,
    incidentUnassignedFollowupsRes,
    incidentEscalatedFollowupsRes,
    incidentWorkflowRes,
    incidentRcaRes,
    admissionsQueueRes,
  ] = await Promise.all([
    facilitiesQuery as unknown as Promise<QueryResult<SupabaseFacilityRow[]>>,
    residentsCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    staffCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentsCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    residentsPreviewQuery as unknown as Promise<QueryResult<SupabaseResidentRow[]>>,
    incidentsFeedQuery as unknown as Promise<QueryResult<SupabaseIncidentFeedRow[]>>,
    doctrinePendingQuery as unknown as Promise<QueryResult<SupabaseDoctrineDocMini[]>>,
    incidentOverdueFollowupsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentUnassignedFollowupsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentEscalatedFollowupsQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentWorkflowQuery as unknown as Promise<QueryResult<SupabaseIncidentMini[]>>,
    incidentRcaQuery as unknown as Promise<QueryResult<SupabaseIncidentRcaMini[]>>,
    admissionsQueueQuery as unknown as Promise<QueryResult<SupabaseAdmissionMini[]>>,
  ]);

  const firstError = [
    facilitiesResult.error && { table: "facilities", ...facilitiesResult.error },
    residentsCountRes.error && { table: "residents", ...residentsCountRes.error },
    staffCountRes.error && { table: "staff", ...staffCountRes.error },
    incidentsCountRes.error && { table: "incidents", ...incidentsCountRes.error },
    residentsPreviewResult.error && { table: "residents_preview", ...residentsPreviewResult.error },
    incidentsFeedResult.error && { table: "incidents_feed", ...incidentsFeedResult.error },
    doctrinePendingResult.error && { table: "documents_pending_review", ...doctrinePendingResult.error },
    incidentOverdueFollowupsRes.error && { table: "incident_followups_overdue", ...incidentOverdueFollowupsRes.error },
    incidentUnassignedFollowupsRes.error && { table: "incident_followups_unassigned", ...incidentUnassignedFollowupsRes.error },
    incidentEscalatedFollowupsRes.error && { table: "incident_followups_escalated", ...incidentEscalatedFollowupsRes.error },
    incidentWorkflowRes.error && { table: "incidents_workflow", ...incidentWorkflowRes.error },
    incidentRcaRes.error && { table: "incident_rca", ...incidentRcaRes.error },
    admissionsQueueRes.error && { table: "admission_cases_queue", ...admissionsQueueRes.error },
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
  const incidentRows = incidentsFeedResult.data ?? [];

  const [censusPreview, activity] = await Promise.all([
    mapResidentsToCensusRows(supabase, previewResidents),
    mapIncidentsToActivity(supabase, incidentRows),
  ]);

  const residentCount = residentsCountRes.count ?? 0;
  const activeStaffCount = staffCountRes.count ?? 0;
  const openIncidentAlerts = incidentsCountRes.count ?? 0;

  const pendingDoctrineDocs = doctrinePendingResult.data ?? [];
  const doctrineDocIds = pendingDoctrineDocs.map((doc) => doc.id);
  const doctrineDraftCreatedRes =
    doctrineDocIds.length > 0
      ? ((await supabase
          .from("document_audit_events" as never)
          .select("document_id")
          .in("document_id", doctrineDocIds)
          .eq("event_type", "obsidian_draft_created")) as unknown as QueryResult<Array<{ document_id: string }>>)
      : ({ data: [], error: null } as QueryResult<Array<{ document_id: string }>>);
  if (doctrineDraftCreatedRes.error) {
    throw doctrineDraftCreatedRes.error;
  }
  const draftCreatedIds = new Set((doctrineDraftCreatedRes.data ?? []).map((row) => row.document_id));
  const doctrineBlockedReview = pendingDoctrineDocs.filter(
    (doc) => !doc.review_owner || !doc.review_due_at || !draftCreatedIds.has(doc.id),
  ).length;
  const doctrineReadyToPublish = pendingDoctrineDocs.length - doctrineBlockedReview;
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

  const admissionQueueRows = admissionsQueueRes.data ?? [];
  const admissionsBlocked = admissionQueueRows.filter((row) => {
    return !row.financial_clearance_at || !row.physician_orders_received_at || !row.bed_id || !row.target_move_in_date;
  }).length;
  const admissionsMoveInReady = admissionQueueRows.filter((row) => {
    return Boolean(row.financial_clearance_at && row.physician_orders_received_at && row.bed_id && row.target_move_in_date);
  }).length;
  const referralsInAdmissions = admissionQueueRows.filter((row) => Boolean(row.referral_lead_id)).length;

  const moveInResidentIds = admissionQueueRows
    .filter((row) => row.status === "move_in")
    .map((row) => row.resident_id);
  let admissionsOnboardingPending = 0;
  let carePlanIds = new Set<string>();
  let medIds = new Set<string>();
  let payerIds = new Set<string>();
  let consentIds = new Set<string>();
  if (moveInResidentIds.length > 0) {
    const [carePlansRes, medsRes, payersRes, consentsRes] = await Promise.all([
      supabase.from("care_plans" as never).select("resident_id").in("resident_id", moveInResidentIds).is("deleted_at", null),
      supabase.from("resident_medications" as never).select("resident_id").in("resident_id", moveInResidentIds).is("deleted_at", null),
      supabase.from("resident_payers" as never).select("resident_id").in("resident_id", moveInResidentIds).is("deleted_at", null),
      supabase.from("family_consent_records" as never).select("resident_id").in("resident_id", moveInResidentIds).is("deleted_at", null),
    ]);
    carePlanIds = new Set(((carePlansRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
    medIds = new Set(((medsRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
    payerIds = new Set(((payersRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
    consentIds = new Set(((consentsRes.data ?? []) as Array<{ resident_id: string }>).map((row) => row.resident_id));
    admissionsOnboardingPending = moveInResidentIds.filter((residentId) => {
      return !(carePlanIds.has(residentId) && medIds.has(residentId) && payerIds.has(residentId) && consentIds.has(residentId));
    }).length;
  }

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

  return {
    headlineName,
    timezoneLabel: primaryTz,
    shiftSummary: shiftSummaryForTimezone(primaryTz),
    residentCount,
    licensedBeds: licensedBedsSum > 0 ? licensedBedsSum : null,
    activeStaffCount,
    openIncidentAlerts,
    workflowQueues: {
      doctrinePendingReview: pendingDoctrineDocs.length,
      doctrineBlockedReview,
      doctrineReadyToPublish,
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
    },
    workflowInbox: buildWorkflowInbox({
      doctrinePendingReview: pendingDoctrineDocs.length,
      doctrineBlockedReview,
      doctrineReadyToPublish,
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
    }),
    censusPreview,
    activity,
  };
}

function buildIncidentOpenObligations(incident: SupabaseIncidentMini): string[] {
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

async function mapResidentsToCensusRows(
  supabase: ReturnType<typeof createClient>,
  residents: SupabaseResidentRow[],
): Promise<DashboardCensusRow[]> {
  if (residents.length === 0) {
    return [];
  }

  const residentIds = residents.map((r) => r.id);
  const bedsResult = (await supabase
    .from("beds" as never)
    .select("id, room_id, bed_label, current_resident_id")
    .in("current_resident_id", residentIds)) as unknown as QueryResult<SupabaseBedRow>;
  if (bedsResult.error) {
    throw bedsResult.error;
  }
  const beds: SupabaseBedRow[] = Array.isArray(bedsResult.data) ? bedsResult.data : [];

  const roomIds = Array.from(
    new Set(
      beds.map((b) => b.room_id).filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const roomsResult = roomIds.length
    ? ((await supabase.from("rooms" as never).select("id, room_number, unit_id").in("id", roomIds)) as unknown as QueryResult<
        SupabaseRoomRow[]
      >)
    : ({ data: [], error: null } as QueryResult<SupabaseRoomRow[]>);
  if (roomsResult.error) {
    throw roomsResult.error;
  }
  const rooms = roomsResult.data ?? [];

  const bedByResident = new Map(
    beds.filter((b) => b.current_resident_id).map((b) => [b.current_resident_id as string, b] as const),
  );
  const roomById = new Map(rooms.map((r) => [r.id, r] as const));

  return residents.map((resident) => {
    const firstName = resident.first_name ?? "";
    const lastName = resident.last_name ?? "";
    const fullName = `${firstName} ${lastName}`.trim() || "Unknown resident";
    const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";
    const bed = bedByResident.get(resident.id);
    const room = bed?.room_id ? roomById.get(bed.room_id) : null;
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
    };
  });
}
