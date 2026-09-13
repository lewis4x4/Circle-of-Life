import type { OperationsActor } from "@/lib/operations/auth";
import { readAllOperationRows, type ReadResult } from "@/lib/operations/read-all";
import { DEFAULT_FACILITY_TIMEZONE } from "@/lib/operations/server";
import { WORKSPACE_RECEIPT_SELECT, UNFINISHED_STATUSES, type WorkspaceReceipt } from "@/lib/operations/workspace";

export const CORPORATE_HISTORY_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
type Cursor = { facility: string; activity: string; at: string; id: string; as_of: string };
export function encodeCorporateHistoryCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor)).toString("base64url"); }
export function decodeCorporateHistoryCursor(value: string, facility: string, activity: string): Cursor | null {
  try {
    if (value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const row = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (row.facility !== facility || row.activity !== activity || !UUID.test(row.id)
      || ![row.at, row.as_of].every((date) => typeof date === "string" && INSTANT.test(date) && Number.isFinite(Date.parse(date)))) return null;
    return row;
  } catch { return null; }
}

export type CorporateHistoryItem = {
  id: string; activity_id: string; activity_name: string; subject_id: string | null; authority_class: string;
  status: string; execution_state: string | null; due_at: string | null; created_at: string;
  requirement_version_id: string | null; facility_requirement_id: string | null;
  effective_receipt_id: string | null; performed_at: string | null; receipt: WorkspaceReceipt | null;
};
export type CorporateHistoryReply = {
  facility_id: string; facility_name: string; facility_timezone: string;
  activities: { id: string; name: string }[]; activity_id: string | null;
  /** Occurrence ledger, including pending, cancelled and reversed rows. Status is never inferred as performance. */
  history: CorporateHistoryItem[]; next_cursor: string | null; total: number | null;
  next_due_at: string | null; schedule_status: "scheduled" | "unknown";
  open_issues: number | null; last_receipt: WorkspaceReceipt | null; partial: string[];
};
type Row = Omit<CorporateHistoryItem, "activity_name" | "receipt"> & { template_name: string };
const SELECT = "id,activity_id,subject_id,authority_class,status,execution_state,due_at,created_at,requirement_version_id,facility_requirement_id,effective_receipt_id,performed_at,template_name";
export type CorporateHistoryOutcome = { status: 200; body: CorporateHistoryReply } | { status: 400 | 404 | 503; error: string };

/** Every query uses the session client: identical site, organization and subject RLS govern pages and totals. */
export async function composeCorporateHistory(args: { actor: OperationsActor; facilityId: string; activityId: string | null; cursor: string | null; now?: Date }): Promise<CorporateHistoryOutcome> {
  const { actor, facilityId, activityId } = args;
  const client = actor.currentActor.client;
  const cursor = args.cursor && activityId ? decodeCorporateHistoryCursor(args.cursor, facilityId, activityId) : null;
  if (args.cursor !== null && !cursor) return { status: 400, error: "cursor is invalid" };
  const asOf = cursor?.as_of ?? (args.now ?? new Date()).toISOString();
  const facility = await client.from("facilities").select("id,name,timezone").eq("organization_id", actor.organizationId).eq("id", facilityId).is("deleted_at", null).maybeSingle();
  if (facility.error) return { status: 503, error: "Activity history unavailable" };
  if (!facility.data) return { status: 404, error: "Facility not found" };
  const catalog = await readAllOperationRows<{ id: string; name: string }>(() => client.from("operation_activities" as never).select("id,name").eq("organization_id", actor.organizationId).or(`facility_id.is.null,facility_id.eq.${facilityId}`).order("id", { ascending: true }));
  if (catalog.error) return { status: 503, error: "Activity catalog unavailable" };
  const activities = (catalog.data ?? []).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (activityId && !activities.some((entry) => entry.id === activityId)) return { status: 404, error: "Activity not found" };
  const body: CorporateHistoryReply = { facility_id: facilityId, facility_name: facility.data.name, facility_timezone: facility.data.timezone || DEFAULT_FACILITY_TIMEZONE, activities, activity_id: activityId, history: [], next_cursor: null, total: null, next_due_at: null, schedule_status: "unknown", open_issues: null, last_receipt: null, partial: [] };
  if (!activityId) return { status: 200, body };
  const base = (count = false) => client.from("operation_task_instances" as never).select(count ? "id" : SELECT, count ? { count: "exact", head: true } : undefined).eq("organization_id", actor.organizationId).eq("facility_id", facilityId).eq("activity_id", activityId).not("occurrence_kind", "is", null).is("deleted_at", null);
  const page = () => {
    let query = base().lte("created_at", asOf).order("created_at", { ascending: false }).order("id", { ascending: false });
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    return query;
  };
  const [read, count, nextDue, issues, latest] = await Promise.all([
    readAllOperationRows<Row>(page, CORPORATE_HISTORY_PAGE_SIZE + 1),
    base(true).lte("created_at", asOf),
    base().in("status", [...UNFINISHED_STATUSES]).gte("due_at", (args.now ?? new Date()).toISOString()).order("due_at", { ascending: true }).order("id", { ascending: true }).limit(1),
    client.from("operation_issues" as never).select("id", { count: "exact", head: true }).eq("organization_id", actor.organizationId).eq("facility_id", facilityId).eq("activity_id", activityId).neq("status", "resolved"),
    client.from("operation_execution_receipts" as never).select(WORKSPACE_RECEIPT_SELECT).eq("organization_id", actor.organizationId).eq("facility_id", facilityId).eq("activity_id", activityId).eq("receipt_kind", "performance").eq("outcome", "performed").is("superseded_by_receipt_id", null).order("performed_at", { ascending: false }).order("id", { ascending: false }).limit(1),
  ]);
  if (latest.error) body.partial.push("last_receipt");
  else body.last_receipt = (latest.data as WorkspaceReceipt[] | null)?.[0] ?? null;
  if (read.error) return { status: 503, error: "Activity history unavailable" };
  body.total = count.error ? null : count.count ?? null;
  if (body.total === null) body.partial.push("total");
  if (nextDue.error) body.partial.push("schedule");
  else { body.next_due_at = (nextDue.data as Row[] | null)?.[0]?.due_at ?? null; body.schedule_status = body.next_due_at ? "scheduled" : "unknown"; }
  body.open_issues = issues.error ? null : issues.count ?? null;
  if (body.open_issues === null) body.partial.push("issues");
  const rows = (read.data ?? []).slice(0, CORPORATE_HISTORY_PAGE_SIZE);
  const ids = rows.map((row) => row.effective_receipt_id).filter((id): id is string => Boolean(id));
  const receipts: ReadResult<WorkspaceReceipt[]> = ids.length ? await readAllOperationRows<WorkspaceReceipt>(() => client.from("operation_execution_receipts" as never).select(WORKSPACE_RECEIPT_SELECT).eq("organization_id", actor.organizationId).eq("facility_id", facilityId).eq("activity_id", activityId).in("id", ids).order("id", { ascending: true })) : { data: [], error: null };
  const byId = new Map((receipts.data ?? []).map((receipt) => [receipt.id, receipt]));
  if (receipts.error || ids.some((id) => !byId.has(id))) body.partial.push("receipts");
  body.history = rows.map(({ template_name, ...row }) => ({ ...row, activity_name: template_name, receipt: row.effective_receipt_id ? byId.get(row.effective_receipt_id) ?? null : null }));
  // Names are current readable profile labels; receipt identity and historical attribution remain immutable.
  const displayedReceipts = [...body.history.flatMap((row) => row.receipt ? [row.receipt] : []), ...(body.last_receipt ? [body.last_receipt] : [])];
  const peopleIds = Array.from(new Set(displayedReceipts.flatMap((receipt) => [receipt.recorder_id, receipt.performer_user_id]).filter((id): id is string => typeof id === "string")));
  if (peopleIds.length) {
    const people = await readAllOperationRows<{ id: string; full_name: string | null }>(() => client.from("user_profiles").select("id,full_name").eq("organization_id", actor.organizationId).in("id", peopleIds).is("deleted_at", null).order("id", { ascending: true }));
    const names = new Map((people.data ?? []).map((person) => [person.id, person.full_name]));
    if (people.error || peopleIds.some((id) => !names.get(id))) body.partial.push("people");
    for (const receipt of displayedReceipts) {
      receipt.recorder_name = names.get(String(receipt.recorder_id)) ?? null;
      receipt.performer_name = names.get(String(receipt.performer_user_id)) ?? (receipt.performer_kind === "self" ? names.get(String(receipt.recorder_id)) ?? null : null);
    }
  }
  if ((read.data?.length ?? 0) > CORPORATE_HISTORY_PAGE_SIZE) { const last = rows[rows.length - 1]; body.next_cursor = encodeCorporateHistoryCursor({ facility: facilityId, activity: activityId, at: last.created_at, id: last.id, as_of: asOf }); }
  return { status: 200, body };
}
