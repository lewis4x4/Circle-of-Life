import { createHash } from "node:crypto";
import type { OperationsActor } from "@/lib/operations/auth";
import { listActorAccessibleFacilityIds } from "@/lib/operations/auth";
import { readAllOperationRows } from "@/lib/operations/read-all";
import { judgeDue, validateScheduleRule } from "@/lib/operations/schedule-evaluator";
import { UNFINISHED_STATUSES } from "@/lib/operations/workspace";

export const ATTENTION_CATEGORIES = ["overdue", "unresolved_issues", "missing_evidence", "waiting", "unassigned", "configuration_needed"] as const;
export type AttentionCategory = typeof ATTENTION_CATEGORIES[number];
export type AttentionItem = { key: string; source_kind: "occurrence" | "issue" | "configuration"; source_id: string; facility_id: string; facility_name: string; facility_timezone: string; activity_id: string | null; activity_name: string; categories: AttentionCategory[]; reason: string; status: string; severity: string | null; at: string | null; task_id: string | null; issue_id: string | null; detail: Record<string, unknown> };
export type AttentionCount = { count: number | null; denominator: number | null; unit: string; definition: string };
export type NeedsAttentionReply = { facility_id: string | null; facilities: { id: string; name: string }[]; category: AttentionCategory | null; counts: Record<AttentionCategory, AttentionCount>; items: AttentionItem[]; total: number | null; next_cursor: string | null; partial: string[]; high_severity_issues: number | null; all_clear: boolean };
export type AttentionOutcome = { status: 200; body: NeedsAttentionReply } | { status: 400 | 404 | 409 | 503; error: string };
export type AttentionRow = Record<string, unknown> & { id: string };
export type AttentionSources = { facility: { id: string; name: string; timezone: string | null }; occurrences: AttentionRow[] | null; receipts: AttentionRow[] | null; issues: AttentionRow[] | null; activities: AttentionRow[] | null; configurations: AttentionRow[] | null; versions: AttentionRow[] | null };
const PAGE_SIZE = 50;
const definitions: Record<AttentionCategory, [string, string]> = {
  overdue: ["unfinished occurrences", "Unfinished managed occurrences past their approved grace end or due instant; unknown deadlines remain configuration needed."],
  unresolved_issues: ["unresolved issues", "Every unresolved issue, independent of whether its linked work was performed or failed."],
  missing_evidence: ["occurrences with an effective receipt", "Occurrences whose current effective receipt explicitly reports unsatisfied required evidence."],
  waiting: ["unfinished occurrences and unresolved issues", "Occurrences awaiting verification and unresolved issues in waiting state, including recorded follow-up; waiting is not completion."],
  unassigned: ["unfinished occurrences and unresolved issues", "Occurrences without a current eligible named primary or approved backup, plus issues without a current named or role owner. Issue backups require the separate takeover action."],
  configuration_needed: ["activity/site configurations and unfinished occurrences", "Visible activity/site pairs without confirmed in-force applicability, governing requirements or schedules, plus unfinished occurrences with unknown deadlines. These are separate source records."],
};
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const inForce = (row: AttentionRow, now: Date) => row.status === "published" && typeof row.effective_from === "string" && Date.parse(row.effective_from) <= now.getTime() && (row.effective_to === null || typeof row.effective_to === "string" && Date.parse(row.effective_to) > now.getTime());

/** Pure classification over complete RLS-filtered sources. Categories overlap; total counts unique source keys, never category sums. */
export function classifyAttention(sites: AttentionSources[], now: Date): { items: AttentionItem[]; counts: Record<AttentionCategory, AttentionCount>; partial: string[]; high_severity_issues: number | null } {
  const items: AttentionItem[] = [], partial: string[] = [];
  const counts = Object.fromEntries(ATTENTION_CATEGORIES.map((category) => [category, { count: 0, denominator: 0, unit: definitions[category][0], definition: definitions[category][1] }])) as Record<AttentionCategory, AttentionCount>;
  const unavailable = (site: string, source: string, affected: AttentionCategory[]) => { partial.push(`${site}:${source}`); for (const category of affected) counts[category].count = counts[category].denominator = null; };
  const addDenominator = (category: AttentionCategory, n: number) => { const entry = counts[category]; if (entry.denominator !== null) entry.denominator += n; };
  for (const site of sites) {
    const { facility } = site;
    const item = (row: AttentionRow, source_kind: AttentionItem["source_kind"], categories: AttentionCategory[], reason: string, detail: Record<string, unknown>): AttentionItem => ({ key: `${facility.id}:${source_kind}:${row.id}`, source_kind, source_id: row.id, facility_id: facility.id, facility_name: facility.name, facility_timezone: facility.timezone ?? "UTC", activity_id: string(row.activity_id), activity_name: string(row.template_name) ?? string(site.activities?.find((a) => a.id === row.activity_id)?.name) ?? "Activity", categories: [...new Set(categories)], reason, status: string(row.status) ?? "unknown", severity: string(row.severity), at: string(row.due_at) ?? string(row.reported_at) ?? string(row.effective_from), task_id: source_kind === "occurrence" ? row.id : string(row.task_instance_id), issue_id: source_kind === "issue" ? row.id : null, detail });
    if (!site.occurrences) unavailable(facility.id, "occurrences", ["overdue", "missing_evidence", "configuration_needed", "waiting", "unassigned"]);
    if (!site.receipts) unavailable(facility.id, "receipts", ["missing_evidence"]);
    const receipts = new Map(site.receipts?.map((row) => [row.id, row]) ?? []);
    for (const row of site.occurrences ?? []) {
      const categories: AttentionCategory[] = [], reasons: string[] = [];
      const unfinished = (UNFINISHED_STATUSES as readonly unknown[]).includes(row.status);
      if (unfinished) {
        addDenominator("overdue", 1); addDenominator("configuration_needed", 1); addDenominator("waiting", 1); addDenominator("unassigned", 1);
        if (row.execution_state === "awaiting_verification") { categories.push("waiting"); reasons.push("Performed work awaits verification"); }
        const ownership = row.attention_ownership as Record<string, unknown> | null | undefined;
        if (!ownership) unavailable(facility.id, `ownership:${row.id}`, ["unassigned", "configuration_needed"]);
        else if (ownership.coverage_current !== true) {
          categories.push("unassigned"); reasons.push("No current eligible named primary or approved backup");
          if (!ownership.owner_user_id && !ownership.backup_user_id) { categories.push("configuration_needed"); reasons.push("Named coverage needs confirmation; a role alone does not choose a person"); }
        }
        const judgment = judgeDue({ status: "pending", dueAt: string(row.grace_ends_at) ?? string(row.due_at), now, timeZone: facility.timezone ?? "UTC" });
        if (judgment.judgment === "overdue") { categories.push("overdue"); reasons.push("Approved deadline has passed"); }
        if (judgment.judgment === "unknown" && row.occurrence_kind === "scheduled") { categories.push("configuration_needed"); reasons.push("Occurrence deadline needs confirmation"); }
      }
      if (row.effective_receipt_id) {
        addDenominator("missing_evidence", 1);
        const receipt = receipts.get(String(row.effective_receipt_id));
        if (site.receipts && !receipt) unavailable(facility.id, `receipt:${row.effective_receipt_id}`, ["missing_evidence"]);
        else if (receipt && receipt.evidence_status_current === "missing") { categories.push("missing_evidence"); reasons.push("Required evidence is missing"); }
      }
      if (categories.length) items.push(item(row, "occurrence", categories, reasons.join("; "), { attention_ownership: row.attention_ownership, due_at: row.due_at, grace_ends_at: row.grace_ends_at, execution_state: row.execution_state, effective_receipt_id: row.effective_receipt_id, assigned_to: row.assigned_to, assigned_role: row.assigned_role, requirement_version_id: row.requirement_version_id }));
    }
    if (!site.issues) unavailable(facility.id, "issues", ["unresolved_issues", "waiting", "unassigned"]);
    for (const row of site.issues ?? []) {
      if (row.status === "resolved") continue;
      for (const category of ["unresolved_issues", "waiting", "unassigned"] as const) addDenominator(category, 1);
      const categories: AttentionCategory[] = ["unresolved_issues"];
      if (row.status === "waiting") categories.push("waiting");
      if ((!row.owner_user_id && !row.owner_role) || row.owner_current !== true) categories.push("unassigned");
      items.push(item(row, "issue", categories, string(row.summary) ?? "Unresolved issue", { summary: row.summary, owner_user_id: row.owner_user_id, owner_role: row.owner_role, owner_current: row.owner_current, backup_user_id: row.backup_user_id, backup_current: row.backup_current, waiting_reason: row.waiting_reason, follow_up_at: row.follow_up_at, follow_up_overdue: row.follow_up_overdue, issue_revision: row.issue_revision, next_action: row.status === "waiting" ? "Follow up at the recorded time; resolve separately when the problem is fixed" : (!row.owner_user_id && !row.owner_role) || row.owner_current !== true ? "Assign a current owner" : "Owner to act and record a separate resolution" }));
    }
    if (!site.activities || site.activities.length === 0 || !site.configurations || !site.versions) unavailable(facility.id, "requirements", ["configuration_needed"]);
    if (site.activities && site.configurations && site.versions) for (const activity of site.activities) {
      addDenominator("configuration_needed", 1);
      const configurations = site.configurations.filter((row) => row.activity_id === activity.id && inForce(row, now));
      const configuration = configurations.length === 1 ? configurations[0] : undefined;
      const reasons: string[] = [];
      if (!configuration) reasons.push(configurations.length ? "Conflicting in-force configurations" : "Applicability has no in-force published configuration");
      else if (configuration.applicability !== "not_applicable") {
        if (configuration.applicability !== "applicable") reasons.push("Applicability needs confirmation");
        const version = site.versions.find((row) => row.id === configuration.requirement_version_id && row.activity_id === activity.id && inForce(row, now));
        if (!version) reasons.push("Governing requirement is unavailable or not in force");
        if (configuration.schedule_status !== "confirmed" || !validateScheduleRule(configuration.schedule_rule).ok) reasons.push("Schedule needs confirmation");
      }
      if (reasons.length) items.push(item({ ...activity, id: activity.id, activity_id: activity.id, status: configuration?.applicability ?? "unknown" }, "configuration", ["configuration_needed"], reasons.join("; "), { configuration_id: configuration?.id ?? null, applicability: configuration?.applicability ?? "unknown", applicability_reason: configuration?.applicability_reason ?? null, schedule_status: configuration?.schedule_status ?? "unknown", requirement_version_id: configuration?.requirement_version_id ?? null, reasons }));
    }
  }
  for (const category of ATTENTION_CATEGORIES) if (counts[category].count !== null) counts[category].count = items.filter((item) => item.categories.includes(category)).length;
  return { items: items.sort((a, b) => a.key.localeCompare(b.key)), counts, partial: [...new Set(partial)].sort(), high_severity_issues: counts.unresolved_issues.count === null ? null : items.filter((item) => item.source_kind === "issue" && item.severity === "high").length };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function composeNeedsAttention(args: { actor: OperationsActor; facilityId: string | null; category: AttentionCategory | null; cursor: string | null; now: Date }): Promise<AttentionOutcome> {
  const { actor, facilityId, category, now } = args, client = actor.currentActor.client;
  let ids: string[];
  try { ids = (await listActorAccessibleFacilityIds(actor)).sort(); } catch { return { status: 503, error: "Facility access unavailable" }; }
  if (facilityId && !ids.includes(facilityId)) return { status: 404, error: "Facility not found" };
  const selectedIds = facilityId ? [facilityId] : ids;
  const sites: AttentionSources[] = [];
  for (const id of selectedIds) {
    const facility = await client.from("facilities").select("id,name,timezone").eq("organization_id", actor.organizationId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (facility.error || !facility.data) return { status: 503, error: "Facility information unavailable" };
    const read = (table: string, columns: string, scoped = true) => {
      let query = client.from(table as never).select(columns).eq("organization_id", actor.organizationId);
      if (scoped) query = query.eq("facility_id", id);
      return query;
    };
    const [occurrences, receipts, issues, activities, configurations, versions] = await Promise.all([
      readAllOperationRows<AttentionRow>(() => read("operation_attention_occurrences", "id,attention_ownership,activity_id,template_name,occurrence_kind,assigned_to,assigned_role,status,due_at,grace_ends_at,execution_state,effective_receipt_id,requirement_version_id").not("occurrence_kind", "is", null).is("deleted_at", null).order("id", { ascending: true })),
      readAllOperationRows<AttentionRow>(() => read("operation_execution_receipts", "id,evidence_status_current").is("superseded_by_receipt_id", null).order("id", { ascending: true })),
      readAllOperationRows<AttentionRow>(() => read("operation_issue_backlog", "id,activity_id,task_instance_id,summary,severity,status,reported_at,owner_user_id,owner_role,owner_current,backup_user_id,backup_current,waiting_reason,follow_up_at,follow_up_overdue,issue_revision").order("id", { ascending: true })),
      readAllOperationRows<AttentionRow>(() => read("operation_activities", "id,name", false).or(`facility_id.is.null,facility_id.eq.${id}`).order("id", { ascending: true })),
      readAllOperationRows<AttentionRow>(() => read("operation_facility_requirements", "id,activity_id,requirement_version_id,status,effective_from,effective_to,applicability,applicability_reason,schedule_status,schedule_rule").eq("status", "published").order("id", { ascending: true })),
      readAllOperationRows<AttentionRow>(() => read("operation_requirement_versions", "id,activity_id,status,effective_from,effective_to", false).eq("status", "published").order("id", { ascending: true })),
    ]);
    sites.push({ facility: facility.data, occurrences: occurrences.error ? null : occurrences.data, receipts: receipts.error ? null : receipts.data, issues: issues.error ? null : issues.data, activities: activities.error ? null : activities.data, configurations: configurations.error ? null : configurations.data, versions: versions.error ? null : versions.data });
  }
  const result = classifyAttention(sites, now);
  const scope = digest({ actor: actor.id, org: actor.organizationId, sites: selectedIds, category });
  const fingerprint = digest(result);
  let after = "";
  if (args.cursor !== null) {
    try {
      if (!/^[A-Za-z0-9_-]{1,1000}$/.test(args.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(args.cursor, "base64url").toString("utf8"));
      if (cursor.scope !== scope || typeof cursor.key !== "string" || !/^[a-f0-9]{64}$/.test(cursor.fingerprint)) throw new Error();
      if (cursor.fingerprint !== fingerprint) return { status: 409, error: "Attention records changed; reload the first page" };
      after = cursor.key;
      if (!result.items.some((item) => item.key === after && (!category || item.categories.includes(category)))) throw new Error();
    } catch { return { status: 400, error: "cursor is invalid for this scope" }; }
  }
  const filtered = result.items.filter((item) => !category || item.categories.includes(category));
  const candidates = filtered.filter((item) => item.key.localeCompare(after) > 0);
  const items = candidates.slice(0, PAGE_SIZE);
  const incomplete = category ? result.counts[category].count === null : result.partial.length > 0;
  return { status: 200, body: { facility_id: facilityId, facilities: sites.map((site) => ({ id: site.facility.id, name: site.facility.name })), category, counts: result.counts, items, total: incomplete ? null : filtered.length, next_cursor: candidates.length > PAGE_SIZE ? Buffer.from(JSON.stringify({ scope, fingerprint, key: items[items.length - 1].key })).toString("base64url") : null, partial: result.partial, high_severity_issues: result.high_severity_issues, all_clear: sites.length > 0 && result.partial.length === 0 && result.items.length === 0 } };
}
