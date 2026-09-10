import { fromZonedTime } from "date-fns-tz";

import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";
import type { OperationsActor } from "@/lib/operations/auth";
import { OCCURRENCE_SELECT } from "@/lib/operations/occurrences";
import { RECEIPT_SELECT } from "@/lib/operations/receipts";
import { buildOperationTaskResponse, DEFAULT_FACILITY_TIMEZONE } from "@/lib/operations/server";
import type { OperationTask } from "@/lib/operations/types";
import { logError } from "@/lib/observability/logger";

/**
 * COL-148 staff work surface (HFO-10): one server-composed read of a site's
 * Today, Upcoming and History. Every row comes through the session client so
 * RLS governs it; the reply shows what the published rules require and never
 * decides for an activity what counts as done (Q10 stays open). Sub-reads that
 * fail are reported in `partial` beside the rows that did load; a failed
 * primary read is an error, never an empty success.
 */

export const WORKSPACE_VIEWS = ["today", "upcoming", "history"] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];
/** Engineering policy (OWNER-DECISIONS 3i): Upcoming spans fourteen days; History pages by fifty. */
export const UPCOMING_DAYS = 14;
export const HISTORY_PAGE_SIZE = 50;
export const WORKSPACE_PARTIALS = ["rules", "receipts", "issues", "legacy", "total"] as const;
export type WorkspacePartial = (typeof WORKSPACE_PARTIALS)[number];
/** Statuses that leave a managed occurrence unfinished; the receipt commands own every other move. */
export const UNFINISHED_STATUSES = ["pending", "in_progress", "missed", "deferred"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InputRule = { key: string; label: string; type: string; required: boolean; unit?: string; min?: number; max?: number; choices?: string[] };
export type EvidenceRule = { kind: string; label: string; min_count: number; when: "always" | "on_failure" | "on_success" };

export type RuleSet = { inputs: InputRule[]; evidence: EvidenceRule[]; recorder_roles: string[]; review_required: boolean };
export type WorkspaceRules = RuleSet & { can_record: boolean };

export type OccurrenceRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  activity_id: string | null;
  subject_id: string | null;
  authority_class: string;
  template_name: string;
  assigned_shift_date: string;
  status: string;
  due_at: string | null;
  grace_ends_at: string | null;
  occurrence_kind: "scheduled" | "event" | "manual" | null;
  period_start_date: string | null;
  period_end_date: string | null;
  requirement_version_id: string | null;
  facility_requirement_id: string | null;
  occurrence_revision: string | null;
  execution_state: string | null;
  effective_receipt_id: string | null;
  performed_at: string | null;
  created_at: string;
};

export type WorkspaceReceipt = Record<string, unknown> & {
  id: string;
  outcome: string | null;
  evidence_status_current: string;
  evidence_satisfied_at: string | null;
  missing_evidence: unknown;
};

export type WorkspaceOccurrence = {
  id: string;
  activity_id: string | null;
  activity_name: string;
  subject_id: string | null;
  subject_label: string;
  occurrence_kind: "scheduled" | "event" | "manual" | null;
  status: string;
  execution_state: string | null;
  occurrence_revision: string | null;
  effective_receipt_id: string | null;
  due_at: string | null;
  grace_ends_at: string | null;
  /** Grace end when set, else the due instant; null is an unknown schedule, never a deadline. */
  deadline_at: string | null;
  schedule_status: "scheduled" | "unknown";
  period_start_date: string | null;
  period_end_date: string | null;
  requirement_version_id: string | null;
  facility_requirement_id: string | null;
  authority_class: string;
};

export type EvidenceSummary = { required: number; finalized: number; missing: number };

export type WorkspaceItem = {
  occurrence: WorkspaceOccurrence;
  /** null only when the rules read failed (`partial` names it); the page must not offer to record without rules. */
  rules: WorkspaceRules | null;
  receipt: WorkspaceReceipt | null;
  /** null only when the issues read failed. */
  open_issues: number | null;
  evidence_summary: EvidenceSummary | null;
};

export type WorkspaceActor = { id: string; name: string | null; role: string };

export type WorkspaceReply = {
  view: WorkspaceView;
  facility_id: string;
  generated_at: string;
  actor: WorkspaceActor;
  partial: WorkspacePartial[];
  groups:
    | { due_today: WorkspaceItem[]; outstanding: WorkspaceItem[]; unknown_schedule: WorkspaceItem[]; legacy: OperationTask[] }
    | { upcoming: WorkspaceItem[] }
    | { history: WorkspaceItem[]; next_cursor: string | null; total: number | null };
};

export type WorkspaceOutcome = { status: 200; body: WorkspaceReply } | { status: 400 | 404 | 503; error: string };

// ---------------------------------------------------------------------------
// Facility day window. All instants are UTC ISO; the boundaries are the
// facility's own local midnights so "today" is the site's day, not the server's.
// ---------------------------------------------------------------------------

export type DayWindow = { timeZone: string; today: string; startOfToday: string; startOfTomorrow: string; upcomingEnd: string };

export function facilityDayWindow(now: Date, timeZone: string | null | undefined): DayWindow {
  const zone = timeZone || DEFAULT_FACILITY_TIMEZONE;
  const today = todayFacilityDateIso(now, zone);
  const startOf = (dateIso: string) => fromZonedTime(`${dateIso}T00:00:00`, zone).toISOString();
  return {
    timeZone: zone,
    today,
    startOfToday: startOf(today),
    startOfTomorrow: startOf(addFacilityCalendarDays(today, 1, zone)),
    upcomingEnd: startOf(addFacilityCalendarDays(today, UPCOMING_DAYS + 1, zone)),
  };
}

export function deadlineOf(row: Pick<OccurrenceRow, "due_at" | "grace_ends_at">): string | null {
  const deadline = row.grace_ends_at ?? row.due_at ?? null;
  if (!deadline || Number.isNaN(new Date(deadline).getTime())) return null;
  return deadline;
}

// ---------------------------------------------------------------------------
// History cursor: opaque base64url of the keyset position (due_at desc nulls
// last, id desc). Anything that does not decode to that shape is rejected.
// ---------------------------------------------------------------------------

export type HistoryCursor = { due_at: string | null; id: string };

export function encodeHistoryCursor(position: HistoryCursor): string {
  return Buffer.from(JSON.stringify({ d: position.due_at, i: position.id }), "utf8").toString("base64url");
}

export function decodeHistoryCursor(cursor: string): HistoryCursor | null {
  if (!cursor || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const { d, i } = parsed as { d?: unknown; i?: unknown };
    if (typeof i !== "string" || !UUID.test(i)) return null;
    if (d === null) return { due_at: null, id: i };
    if (typeof d !== "string" || Number.isNaN(new Date(d).getTime())) return null;
    return { due_at: d, id: i };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Governing rules: local over central exactly as 341 coalesces
// (`coalesce(fr.local_x, v.x)`): a present local list wins even when empty;
// only an absent local list falls back to the central version.
// ---------------------------------------------------------------------------

export type VersionRuleRow = { id: string; allowed_recorder_roles: string[] | null; review_required: boolean | null; required_inputs: InputRule[] | null; required_evidence: EvidenceRule[] | null };
export type FacilityRuleRow = { id: string; local_allowed_recorder_roles: string[] | null; local_required_inputs: InputRule[] | null; local_required_evidence: EvidenceRule[] | null };

function coalesce<T>(local: T | null | undefined, central: T | null | undefined, fallback: T): T {
  if (local !== null && local !== undefined) return local;
  if (central !== null && central !== undefined) return central;
  return fallback;
}

export function resolveRules(version: VersionRuleRow, facilityRequirement: FacilityRuleRow | null): RuleSet {
  return {
    inputs: coalesce(facilityRequirement?.local_required_inputs, version.required_inputs, []),
    evidence: coalesce(facilityRequirement?.local_required_evidence, version.required_evidence, []),
    recorder_roles: coalesce(facilityRequirement?.local_allowed_recorder_roles, version.allowed_recorder_roles, []),
    review_required: Boolean(version.review_required),
  };
}

export function withRecordingAuthority(rules: RuleSet, role: string): WorkspaceRules {
  return { ...rules, can_record: rules.recorder_roles.includes(role) };
}

/** The evidence rules that apply to an outcome (341 `operation_receipt_missing_evidence`, restated). */
export function applicableEvidenceRules(rules: EvidenceRule[], outcome: string): EvidenceRule[] {
  if (outcome === "not_performed") return [];
  return rules.filter((rule) => rule.min_count >= 1 && (rule.when === "always" || (rule.when === "on_success" && outcome === "performed") || (rule.when === "on_failure" && outcome === "failed")));
}

/**
 * Counts in rules. With a receipt the receipt is the truth: its
 * `missing_evidence` is the applicable list at record time and
 * `evidence_status_current` says whether it has since been satisfied.
 * Without a receipt the summary is what a performed outcome would need.
 */
export function summarizeEvidence(rules: RuleSet | null, receipt: WorkspaceReceipt | null): EvidenceSummary | null {
  if (receipt) {
    const listed = Array.isArray(receipt.missing_evidence) ? receipt.missing_evidence.length : 0;
    if (receipt.evidence_status_current === "not_required") return { required: 0, finalized: 0, missing: 0 };
    if (receipt.evidence_status_current === "missing") return { required: listed, finalized: 0, missing: listed };
    return { required: listed, finalized: listed, missing: 0 };
  }
  if (!rules) return null;
  const required = applicableEvidenceRules(rules.evidence, "performed").length;
  return { required, finalized: 0, missing: required };
}

// ---------------------------------------------------------------------------
// Partition and narrowing. Unassigned work is always shown; `mine` keeps a
// row whose recorder list names the actor's role, has no recorder list, or
// whose rules could not be read (unknown is not "someone else's").
// ---------------------------------------------------------------------------

export type TodayGroups = { due_today: WorkspaceItem[]; outstanding: WorkspaceItem[]; unknown_schedule: WorkspaceItem[] };

export function partitionToday(items: WorkspaceItem[], window: Pick<DayWindow, "startOfToday">): TodayGroups {
  const groups: TodayGroups = { due_today: [], outstanding: [], unknown_schedule: [] };
  const startOfToday = new Date(window.startOfToday).getTime();
  for (const item of items) {
    const deadline = item.occurrence.deadline_at;
    if (!deadline) {
      groups.unknown_schedule.push(item);
      continue;
    }
    // The query bounds the deadline to before tomorrow; anything later is kept visible rather than dropped.
    const at = new Date(deadline).getTime();
    if (at < startOfToday) groups.outstanding.push(item);
    else groups.due_today.push(item);
  }
  const byDeadline = (left: WorkspaceItem, right: WorkspaceItem) =>
    (left.occurrence.deadline_at ?? "").localeCompare(right.occurrence.deadline_at ?? "") || left.occurrence.id.localeCompare(right.occurrence.id);
  groups.due_today.sort(byDeadline);
  groups.outstanding.sort(byDeadline);
  groups.unknown_schedule.sort((left, right) => left.occurrence.id.localeCompare(right.occurrence.id));
  return groups;
}

export function narrowToMine(items: WorkspaceItem[], role: string): WorkspaceItem[] {
  return items.filter((item) => !item.rules || item.rules.recorder_roles.length === 0 || item.rules.recorder_roles.includes(role));
}

export function narrowLegacyToMine(tasks: OperationTask[], actor: Pick<OperationsActor, "id" | "appRole">): OperationTask[] {
  return tasks.filter((task) => (!task.assigned_to && !task.assigned_role) || task.assigned_to === actor.id || (!task.assigned_to && task.assigned_role === actor.appRole));
}

/** A display label that never carries a protected subject's name: the site name for the site, else the kind and a short id. */
export function subjectLabel(row: Pick<OccurrenceRow, "subject_id" | "authority_class">, facilityName: string | null): string {
  const short = row.subject_id ? row.subject_id.slice(0, 8) : "unknown";
  switch (row.authority_class) {
    case "facility":
    case "financial":
      return facilityName ?? "This site";
    case "resident":
      return `Resident ${short}`;
    case "employee_personnel":
    case "employee_medical":
      return `Employee ${short}`;
    case "asset":
      return `Asset ${short}`;
    default:
      return `Subject ${short}`;
  }
}

export function shapeOccurrence(row: OccurrenceRow, facilityName: string | null): WorkspaceOccurrence {
  const deadline = deadlineOf(row);
  return {
    id: row.id,
    activity_id: row.activity_id ?? null,
    activity_name: row.template_name,
    subject_id: row.subject_id ?? null,
    subject_label: subjectLabel(row, facilityName),
    occurrence_kind: row.occurrence_kind ?? null,
    status: row.status,
    execution_state: row.execution_state ?? null,
    occurrence_revision: row.occurrence_revision ?? null,
    effective_receipt_id: row.effective_receipt_id ?? null,
    due_at: row.due_at ?? null,
    grace_ends_at: row.grace_ends_at ?? null,
    deadline_at: deadline,
    schedule_status: deadline ? "scheduled" : "unknown",
    period_start_date: row.period_start_date ?? null,
    period_end_date: row.period_end_date ?? null,
    requirement_version_id: row.requirement_version_id ?? null,
    facility_requirement_id: row.facility_requirement_id ?? null,
    authority_class: row.authority_class,
  };
}

// ---------------------------------------------------------------------------
// Composition against the session client.
// ---------------------------------------------------------------------------

/** Managed columns plus the COL-142 execution facts the occurrence list omits. */
export const WORKSPACE_OCCURRENCE_SELECT = `${OCCURRENCE_SELECT}, execution_state, effective_receipt_id, performed_at`;
export const WORKSPACE_RECEIPT_SELECT = `${RECEIPT_SELECT}, evidence_status_current, evidence_satisfied_at`;
const VERSION_RULE_SELECT = "id, allowed_recorder_roles, review_required, required_inputs, required_evidence";
const FACILITY_RULE_SELECT = "id, local_allowed_recorder_roles, local_required_inputs, local_required_evidence";
/** The legacy list columns (tasks route), read here only for Today's legacy group. */
const LEGACY_TASK_SELECT =
  "id, organization_id, facility_id, template_id, activity_id, template_name, template_category, template_cadence_type, assigned_shift_date, assigned_shift, assigned_to, signed_by, requires_dual_sign, assigned_role, status, due_at, missed_at, deferred_until, priority, license_threatening, estimated_minutes, current_escalation_level, created_at, updated_at";

type SessionClient = OperationsActor["currentActor"]["client"];
type ReadResult<T> = { data: T | null; error: { message?: string } | null };
type LegacyRow = Parameters<typeof buildOperationTaskResponse>[0]["rows"][number];

export type ComposeWorkspaceArgs = {
  actor: OperationsActor;
  facilityId: string;
  view: WorkspaceView;
  cursor: string | null;
  mine: boolean;
  now?: Date;
};

export async function composeWorkspace(args: ComposeWorkspaceArgs): Promise<WorkspaceOutcome> {
  const { actor, facilityId, view, mine } = args;
  const now = args.now ?? new Date();
  const client = actor.currentActor.client;
  const scope = `admin.operations.workspace.${view}`;
  const partial = new Set<WorkspacePartial>();

  const cursor = view === "history" && args.cursor ? decodeHistoryCursor(args.cursor) : null;
  if (view === "history" && args.cursor && !cursor) return { status: 400, error: "cursor is invalid" };

  // The site's own day governs the window; its name labels site-subject rows.
  const facilityRead = (await client
    .from("facilities")
    .select("id, name, timezone")
    .eq("organization_id", actor.organizationId)
    .eq("id", facilityId)
    .is("deleted_at", null)
    .maybeSingle()) as ReadResult<{ id: string; name: string; timezone: string | null }>;
  if (facilityRead.error) {
    logError(scope, facilityRead.error, { action: "facility", facilityId });
    return { status: 503, error: "Workspace unavailable" };
  }
  if (!facilityRead.data) return { status: 404, error: "Facility not found" };
  const facility = facilityRead.data;
  const window = facilityDayWindow(now, facility.timezone);

  // (1) Primary read: the view's managed occurrences.
  let reversedIds: string[] = [];
  if (view === "history") {
    const reversals = (await client
      .from("operation_execution_receipts" as never)
      .select("task_instance_id")
      .eq("organization_id", actor.organizationId)
      .eq("facility_id", facilityId)
      .eq("receipt_kind", "reversal")) as ReadResult<Array<{ task_instance_id: string }>>;
    if (reversals.error) {
      logError(scope, reversals.error, { action: "reversals", facilityId });
      return { status: 503, error: "Workspace unavailable" };
    }
    reversedIds = Array.from(new Set((reversals.data ?? []).map((row) => row.task_instance_id).filter(Boolean)));
  }

  const base = () =>
    client
      .from("operation_task_instances" as never)
      .select(WORKSPACE_OCCURRENCE_SELECT)
      .eq("organization_id", actor.organizationId)
      .eq("facility_id", facilityId)
      .not("occurrence_kind", "is", null)
      .is("deleted_at", null);
  const historyMembership = ["status.in.(completed,cancelled)", "effective_receipt_id.not.is.null", ...(reversedIds.length > 0 ? [`id.in.(${reversedIds.join(",")})`] : [])].join(",");

  let occurrenceRead: ReadResult<OccurrenceRow[]>;
  let total: number | null = null;
  if (view === "today") {
    occurrenceRead = (await base()
      .in("status", [...UNFINISHED_STATUSES])
      .or(`grace_ends_at.lt.${window.startOfTomorrow},and(grace_ends_at.is.null,due_at.lt.${window.startOfTomorrow}),due_at.is.null`)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })) as ReadResult<OccurrenceRow[]>;
  } else if (view === "upcoming") {
    occurrenceRead = (await base()
      .in("status", [...UNFINISHED_STATUSES])
      .or(
        `and(grace_ends_at.gte.${window.startOfTomorrow},grace_ends_at.lt.${window.upcomingEnd}),and(grace_ends_at.is.null,due_at.gte.${window.startOfTomorrow},due_at.lt.${window.upcomingEnd})`,
      )
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })) as ReadResult<OccurrenceRow[]>;
  } else {
    let page = base().or(historyMembership);
    if (cursor) {
      page = cursor.due_at === null ? page.is("due_at", null).lt("id", cursor.id) : page.or(`due_at.lt.${cursor.due_at},and(due_at.eq.${cursor.due_at},id.lt.${cursor.id}),due_at.is.null`);
    }
    occurrenceRead = (await page
      .order("due_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1)) as ReadResult<OccurrenceRow[]>;
    // The complete count comes from its own query, never from the page length.
    const countRead = (await client
      .from("operation_task_instances" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", actor.organizationId)
      .eq("facility_id", facilityId)
      .not("occurrence_kind", "is", null)
      .is("deleted_at", null)
      .or(historyMembership)) as unknown as { count: number | null; error: { message?: string } | null };
    if (countRead.error || typeof countRead.count !== "number") {
      logError(scope, countRead.error ?? new Error("History count unavailable"), { action: "count", facilityId });
      partial.add("total");
    } else {
      total = countRead.count;
    }
  }
  if (occurrenceRead.error) {
    logError(scope, occurrenceRead.error, { action: "occurrences", facilityId });
    return { status: 503, error: "Workspace unavailable" };
  }
  const allRows = occurrenceRead.data ?? [];
  const rows = view === "history" ? allRows.slice(0, HISTORY_PAGE_SIZE) : allRows;
  const nextCursor = view === "history" && allRows.length > HISTORY_PAGE_SIZE ? encodeHistoryCursor({ due_at: rows[rows.length - 1].due_at ?? null, id: rows[rows.length - 1].id }) : null;

  // (2) Governing rules per distinct (requirement_version_id, facility_requirement_id).
  const versionIds = Array.from(new Set(rows.map((row) => row.requirement_version_id).filter((id): id is string => Boolean(id))));
  const facilityRuleIds = Array.from(new Set(rows.map((row) => row.facility_requirement_id).filter((id): id is string => Boolean(id))));
  let versions = new Map<string, VersionRuleRow>();
  let facilityRules = new Map<string, FacilityRuleRow>();
  let rulesLoaded = true;
  if (versionIds.length > 0) {
    const [versionRead, facilityRuleRead] = await Promise.all([
      client.from("operation_requirement_versions" as never).select(VERSION_RULE_SELECT).eq("organization_id", actor.organizationId).in("id", versionIds) as unknown as Promise<ReadResult<VersionRuleRow[]>>,
      facilityRuleIds.length > 0
        ? (client.from("operation_facility_requirements" as never).select(FACILITY_RULE_SELECT).eq("organization_id", actor.organizationId).in("id", facilityRuleIds) as unknown as Promise<ReadResult<FacilityRuleRow[]>>)
        : Promise.resolve<ReadResult<FacilityRuleRow[]>>({ data: [], error: null }),
    ]);
    if (versionRead.error || facilityRuleRead.error) {
      logError(scope, versionRead.error ?? facilityRuleRead.error, { action: "rules", facilityId });
      rulesLoaded = false;
      partial.add("rules");
    } else {
      versions = new Map((versionRead.data ?? []).map((row) => [row.id, row]));
      facilityRules = new Map((facilityRuleRead.data ?? []).map((row) => [row.id, row]));
    }
  }

  // (3) The effective receipt per occurrence.
  const receiptIds = Array.from(new Set(rows.map((row) => row.effective_receipt_id).filter((id): id is string => Boolean(id))));
  let receipts = new Map<string, WorkspaceReceipt>();
  if (receiptIds.length > 0) {
    const receiptRead = (await client
      .from("operation_execution_receipts" as never)
      .select(WORKSPACE_RECEIPT_SELECT)
      .eq("organization_id", actor.organizationId)
      .in("id", receiptIds)) as ReadResult<WorkspaceReceipt[]>;
    if (receiptRead.error) {
      logError(scope, receiptRead.error, { action: "receipts", facilityId });
      partial.add("receipts");
    } else {
      receipts = new Map((receiptRead.data ?? []).map((row) => [row.id, row]));
    }
  }

  // (4) Open issue counts per occurrence (COL-144 vocabulary: anything not resolved is open work).
  const occurrenceIds = rows.map((row) => row.id);
  let issueCounts: Map<string, number> | null = new Map();
  if (occurrenceIds.length > 0) {
    const issueRead = (await client
      .from("operation_issues" as never)
      .select("task_instance_id")
      .eq("organization_id", actor.organizationId)
      .eq("facility_id", facilityId)
      .in("task_instance_id", occurrenceIds)
      .neq("status", "resolved")) as ReadResult<Array<{ task_instance_id: string | null }>>;
    if (issueRead.error) {
      logError(scope, issueRead.error, { action: "issues", facilityId });
      partial.add("issues");
      issueCounts = null;
    } else {
      for (const issue of issueRead.data ?? []) {
        if (!issue.task_instance_id) continue;
        issueCounts.set(issue.task_instance_id, (issueCounts.get(issue.task_instance_id) ?? 0) + 1);
      }
    }
  }

  let items = rows.map((row): WorkspaceItem => {
    const version = row.requirement_version_id ? versions.get(row.requirement_version_id) : undefined;
    const ruleSet = rulesLoaded && version ? resolveRules(version, row.facility_requirement_id ? facilityRules.get(row.facility_requirement_id) ?? null : null) : null;
    const receipt = row.effective_receipt_id ? receipts.get(row.effective_receipt_id) ?? null : null;
    return {
      occurrence: shapeOccurrence(row, facility.name),
      rules: ruleSet ? withRecordingAuthority(ruleSet, actor.appRole) : null,
      receipt,
      open_issues: issueCounts ? issueCounts.get(row.id) ?? 0 : null,
      evidence_summary: summarizeEvidence(ruleSet, receipt),
    };
  });
  if (mine) items = narrowToMine(items, actor.appRole);

  const reply = {
    view,
    facility_id: facilityId,
    generated_at: now.toISOString(),
    actor: { id: actor.id, name: actor.currentActor.fullName ?? null, role: actor.appRole },
  };

  if (view === "upcoming") {
    return { status: 200, body: { ...reply, partial: Array.from(partial), groups: { upcoming: items } } };
  }
  if (view === "history") {
    return { status: 200, body: { ...reply, partial: Array.from(partial), groups: { history: items, next_cursor: nextCursor, total } } };
  }

  // (5) Today only: legacy (unmanaged) tasks for the same facility day, through the existing list helpers.
  let legacy: OperationTask[] = [];
  try {
    legacy = await readLegacyTasks(client, actor, facilityId, window, facility, now);
    if (mine) legacy = narrowLegacyToMine(legacy, actor);
  } catch (error) {
    logError(scope, error, { action: "legacy", facilityId });
    partial.add("legacy");
  }
  const groups = partitionToday(items, window);
  return { status: 200, body: { ...reply, partial: Array.from(partial), groups: { ...groups, legacy } } };
}

async function readLegacyTasks(
  client: SessionClient,
  actor: OperationsActor,
  facilityId: string,
  window: DayWindow,
  facility: { id: string; name: string; timezone: string | null },
  now: Date,
): Promise<OperationTask[]> {
  // The window is the facility's own day. `parseOperationTaskFilters` is not
  // used for it: a date-only param goes through `new Date()` (UTC midnight)
  // and back through local formatting, which shifts the day on a non-UTC host.
  let query = client
    .from("operation_task_instances" as never)
    .select(LEGACY_TASK_SELECT)
    .eq("organization_id", actor.organizationId)
    .eq("facility_id", facilityId)
    .is("occurrence_kind", null)
    .is("deleted_at", null)
    .gte("assigned_shift_date", window.today)
    .lte("assigned_shift_date", window.today)
    .in("status", [...UNFINISHED_STATUSES]);
  if (actor.appRole === "housekeeper") query = query.or(`assigned_to.eq.${actor.id},and(assigned_to.is.null,assigned_role.eq.housekeeper)`);
  const taskRead = (await query.order("assigned_shift_date", { ascending: true }).order("created_at", { ascending: true })) as ReadResult<LegacyRow[]>;
  if (taskRead.error) throw new Error("Legacy tasks unavailable");
  const rows = taskRead.data ?? [];
  const assigneeIds = Array.from(new Set(rows.map((row) => row.assigned_to).filter((id): id is string => Boolean(id))));
  let assigneeNames = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data, error } = await client.from("user_profiles").select("id, full_name").in("id", assigneeIds).is("deleted_at", null);
    if (error) throw new Error("Legacy task details unavailable");
    assigneeNames = new Map((data ?? []).map((profile) => [profile.id, profile.full_name]));
  }
  return buildOperationTaskResponse({
    rows,
    facilityNames: new Map([[facility.id, facility.name]]),
    facilityTimezones: new Map([[facility.id, facility.timezone ?? null]]),
    assigneeNames,
    dateFrom: window.today,
    dateTo: window.today,
    now,
  }).tasks;
}
