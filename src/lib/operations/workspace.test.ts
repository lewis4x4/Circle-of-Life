import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import type { OperationsActor } from "@/lib/operations/auth";
import {
  HISTORY_PAGE_SIZE,
  WORKSPACE_ID_BATCH_SIZE,
  composeWorkspace,
  decodeHistoryCursor,
  encodeHistoryCursor,
  facilityDayWindow,
  narrowLegacyToMine,
  narrowToMine,
  partitionToday,
  resolveRules,
  summarizeEvidence,
  type OccurrenceRow,
  type WorkspaceItem,
  type WorkspaceReply,
} from "./workspace";

// ---------------------------------------------------------------------------
// A session client whose reads are tagged by what they ask for, so a test can
// fail one sub-read, hand each read its own rows and assert the filters sent.
// ---------------------------------------------------------------------------

type Call = { method: string; args: unknown[] };
type Tag = "facility" | "reversals" | "managed" | "count" | "versions" | "facility_rules" | "receipts" | "issues" | "legacy" | "profiles";
type Tables = { facility?: unknown; reversals?: unknown[]; managed?: unknown[]; count?: number; versions?: unknown[]; facility_rules?: unknown[]; receipts?: unknown[]; issues?: unknown[]; legacy?: unknown[]; profiles?: unknown[] };

function tagOf(table: string, calls: Call[]): Tag {
  const has = (method: string, first: unknown, second?: unknown) => calls.some((call) => call.method === method && call.args[0] === first && (second === undefined || call.args[1] === second));
  if (table === "facilities") return "facility";
  if (table === "operation_execution_receipts") return has("eq", "receipt_kind", "reversal") ? "reversals" : "receipts";
  if (table === "operation_task_instances") {
    const select = calls.find((call) => call.method === "select");
    if ((select?.args[1] as { head?: boolean } | undefined)?.head) return "count";
    return has("is", "occurrence_kind", null) ? "legacy" : "managed";
  }
  if (table === "operation_requirement_versions") return "versions";
  if (table === "operation_facility_requirements") return "facility_rules";
  if (table === "operation_issues") return "issues";
  return "profiles";
}

function fakeClient(tables: Tables, fail: Array<Tag | { tag: Tag; from: number }> = [], cap = 1000) {
  const queries: Partial<Record<Tag, Call[][]>> = {};
  const reads: Partial<Record<Tag, Call[]>> = {};
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    const result = () => {
      const tag = tagOf(table, calls);
      reads[tag] = calls;
      (queries[tag] ??= []).push(calls);
      const range = calls.find((call) => call.method === "range")?.args as [number, number] | undefined;
      const offset = range?.[0] ?? 0;
      if (fail.some((entry) => typeof entry === "string" ? entry === tag : entry.tag === tag && entry.from === offset)) return { data: null, error: { message: `${tag} failed` }, count: null };
      if (tag === "facility") return { data: tables.facility === undefined ? facility : tables.facility, error: null };
      let data = tag === "count" ? tables.managed ?? [] : tables[tag] ?? [];
      const historyBase = calls.some((call) => call.method === "or" && call.args[0] === "status.in.(completed,cancelled),effective_receipt_id.not.is.null");
      const historyReversed = calls.some((call) => call.method === "not" && call.args[0] === "status");
      if (historyBase || historyReversed) data = data.filter((entry) => {
        const row = entry as OccurrenceRow;
        const base = ["completed", "cancelled"].includes(row.status) || row.effective_receipt_id !== null;
        return historyBase ? base : !base;
      });
      for (const call of calls.filter((call) => call.method === "in" && ["id", "task_instance_id"].includes(String(call.args[0])))) {
        data = data.filter((row) => (call.args[1] as string[]).includes((row as Record<string, string>)[String(call.args[0])]));
      }
      if (tag === "count") return { data: null, error: null, count: historyBase ? tables.count ?? data.length : data.length };
      const timestamp = (value: string) => Date.parse(value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, "")) * 1000 + Number((value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0"));
      if (tag === "managed" && (historyBase || historyReversed)) {
        data = data.filter((entry) => {
          const row = entry as OccurrenceRow;
          const tail = calls.find((call) => call.method === "lt" && call.args[0] === "id");
          if (tail) return row.due_at === null && row.id < String(tail.args[1]);
          const keyset = calls.find((call) => call.method === "or" && String(call.args[0]).startsWith("due_at.lt."));
          if (!keyset || row.due_at === null) return true;
          const match = String(keyset.args[0]).match(/^due_at.lt.(.*?),and\(due_at.eq.*?,id.lt.([^)]*)\)/);
          if (!match) throw new Error("bad keyset");
          return timestamp(row.due_at) < timestamp(match[1]) || timestamp(row.due_at) === timestamp(match[1]) && row.id < match[2];
        }).sort((a, b) => {
          const left = a as OccurrenceRow, right = b as OccurrenceRow;
          if (left.due_at === null && right.due_at !== null) return 1;
          if (left.due_at !== null && right.due_at === null) return -1;
          return (left.due_at && right.due_at ? timestamp(right.due_at) - timestamp(left.due_at) : 0) || right.id.localeCompare(left.id);
        });
      }
      const limit = calls.find((call) => call.method === "limit")?.args[0] as number | undefined;
      data = data.slice(offset, offset + Math.min(cap, range ? range[1] - offset + 1 : limit ?? cap));
      return { data, error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "is", "not", "in", "or", "gte", "lte", "lt", "order", "limit", "range"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled, onRejected);
    return chain;
  });
  return { from, reads, queries };
}

const facilityId = "33333333-3333-4333-8333-333333333333";
const facility = { id: facilityId, name: "Homewood Lodge", timezone: "America/New_York" };
const versionId = "11111111-1111-4111-8111-111111111111";
const facilityRuleId = "22222222-2222-4222-8222-222222222222";
const residentSubject = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-09-10T15:00:00Z");
// Homewood is Eastern: 2026-09-10 runs from 04:00Z on the 10th to 04:00Z on the 11th.
const startOfToday = "2026-09-10T04:00:00.000Z";
const startOfTomorrow = "2026-09-11T04:00:00.000Z";

function uuid(n: number) {
  return `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function occurrence(overrides: Partial<OccurrenceRow> & { id: string }): OccurrenceRow {
  return {
    organization_id: "org",
    facility_id: facilityId,
    activity_id: "activity",
    subject_id: residentSubject,
    authority_class: "resident",
    template_name: "Weight check",
    assigned_shift_date: "2026-09-10",
    status: "pending",
    due_at: "2026-09-10T20:00:00+00:00",
    grace_ends_at: null,
    occurrence_kind: "scheduled",
    period_start_date: "2026-09-10",
    period_end_date: "2026-09-10",
    requirement_version_id: versionId,
    facility_requirement_id: facilityRuleId,
    occurrence_revision: "a".repeat(64),
    execution_state: "none",
    effective_receipt_id: null,
    performed_at: null,
    created_at: "2026-09-01T12:00:00Z",
    ...overrides,
  };
}

const version = { id: versionId, allowed_recorder_roles: ["nurse", "facility_admin"], review_required: false, required_inputs: [{ key: "weight_lb", label: "Weight", type: "number", required: true, unit: "lb" }], required_evidence: [] };
const facilityRule = { id: facilityRuleId, local_allowed_recorder_roles: null, local_required_inputs: null, local_required_evidence: null };

function actorFor(client: ReturnType<typeof fakeClient>, appRole = "facility_admin"): OperationsActor {
  return { id: "actor", organizationId: "org", appRole, currentActor: { id: "actor", fullName: "Dana Ortiz", client } } as unknown as OperationsActor;
}

async function compose(client: ReturnType<typeof fakeClient>, args: Partial<Parameters<typeof composeWorkspace>[0]> = {}) {
  const outcome = await composeWorkspace({ actor: actorFor(client), facilityId, view: "today", cursor: null, mine: false, now, ...args });
  if (outcome.status !== 200) throw new Error(`unexpected ${outcome.status}: ${outcome.error}`);
  return outcome.body;
}

function todayGroups(body: WorkspaceReply) {
  if (!("due_today" in body.groups)) throw new Error("not a today reply");
  return body.groups;
}

function historyGroups(body: WorkspaceReply) {
  if (!("history" in body.groups)) throw new Error("not a history reply");
  return body.groups;
}

beforeEach(() => vi.clearAllMocks());

describe("facility day window", () => {
  it.each([
    ["2026-11-01T15:00:00Z", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", 25],
    ["2026-03-08T15:00:00Z", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z", 23],
  ] as const)("uses civil midnights across DST at %s", (instant, start, end, hours) => {
    const window = facilityDayWindow(new Date(instant), "America/New_York");
    expect(window.startOfToday).toBe(start);
    expect(window.startOfTomorrow).toBe(end);
    expect((Date.parse(end) - Date.parse(start)) / 3600000).toBe(hours);
  });

  it("bounds today and the upcoming fortnight by the facility's own midnights", () => {
    const window = facilityDayWindow(now, "America/New_York");
    expect(window).toEqual({ timeZone: "America/New_York", today: "2026-09-10", startOfToday, startOfTomorrow, upcomingEnd: "2026-09-25T04:00:00.000Z" });
    // Just after Eastern midnight the server's UTC date is already tomorrow; the site's day governs.
    expect(facilityDayWindow(new Date("2026-09-11T03:30:00Z"), "America/New_York").today).toBe("2026-09-10");
  });
});

describe("today partition", () => {
  it("groups due today, outstanding from earlier however old, and unknown schedules, and keeps legacy tasks apart", async () => {
    const client = fakeClient({
      managed: [
        occurrence({ id: uuid(1), due_at: "2026-09-10T20:00:00+00:00" }),
        occurrence({ id: uuid(2), due_at: "2026-09-09T20:00:00+00:00", status: "missed" }),
        occurrence({ id: uuid(3), due_at: "2026-03-01T20:00:00+00:00", status: "in_progress", execution_state: "performed_missing_evidence", effective_receipt_id: uuid(90) }),
        occurrence({ id: uuid(4), occurrence_kind: "manual", due_at: null, period_start_date: null, period_end_date: null, facility_requirement_id: null }),
        // Grace end is the deadline: due yesterday, grace runs into today.
        occurrence({ id: uuid(5), due_at: "2026-09-09T20:00:00+00:00", grace_ends_at: "2026-09-10T12:00:00+00:00" }),
        // Grace ends at exactly the facility's midnight boundary: before today, so outstanding.
        occurrence({ id: uuid(6), due_at: "2026-09-09T12:00:00+00:00", grace_ends_at: "2026-09-10T03:59:59+00:00" }),
      ],
      versions: [version],
      facility_rules: [facilityRule],
      receipts: [{ id: uuid(90), outcome: "performed", evidence_status_current: "missing", evidence_satisfied_at: null, missing_evidence: [{ kind: "photo", label: "Scale", min_count: 1, when: "always" }] }],
      legacy: [{ id: "legacy-1", organization_id: "org", facility_id: facilityId, template_id: null, activity_id: null, template_name: "Kitchen log", template_category: "safety", template_cadence_type: "daily", assigned_shift_date: "2020-01-01", assigned_shift: "day", assigned_to: null, assigned_role: "housekeeper", status: "pending", due_at: null, missed_at: null, deferred_until: null, priority: "normal", license_threatening: false, estimated_minutes: 5, current_escalation_level: 0, created_at: "2026-09-10T10:00:00Z", updated_at: "2026-09-10T10:00:00Z" }],
    });
    const body = await compose(client);
    const groups = todayGroups(body);
    expect(groups.due_today.map((item) => item.occurrence.id)).toEqual([uuid(5), uuid(1)]);
    expect(groups.outstanding.map((item) => item.occurrence.id)).toEqual([uuid(3), uuid(2), uuid(6)]);
    expect(groups.unknown_schedule.map((item) => item.occurrence.id)).toEqual([uuid(4)]);
    expect(groups.unknown_schedule[0].occurrence).toMatchObject({ deadline_at: null, schedule_status: "unknown", occurrence_kind: "manual" });
    expect(groups.due_today[0].occurrence).toMatchObject({ deadline_at: "2026-09-10T12:00:00+00:00", schedule_status: "scheduled" });
    expect(groups.legacy).toHaveLength(1);
    expect(groups.legacy[0]).toMatchObject({ id: "legacy-1", template_name: "Kitchen log", assigned_shift_date: "2020-01-01", due_judgment: "unknown", facility_name: "Homewood Lodge" });
    expect(body.partial).toEqual([]);
    expect(body).toMatchObject({ view: "today", facility_id: facilityId, facility_timezone: "America/New_York", generated_at: now.toISOString(), actor: { id: "actor", name: "Dana Ortiz", role: "facility_admin" } });
    // The managed read asks for unfinished rows whose deadline falls before the facility's tomorrow, or no deadline at all.
    const managed = client.reads.managed ?? [];
    expect(managed.find((call) => call.method === "in")?.args).toEqual(["status", ["pending", "in_progress", "missed", "deferred"]]);
    expect(managed.find((call) => call.method === "or")?.args[0]).toBe(`grace_ends_at.lt.${startOfTomorrow},and(grace_ends_at.is.null,due_at.lt.${startOfTomorrow}),due_at.is.null`);
    expect(managed.find((call) => call.method === "not")?.args).toEqual(["occurrence_kind", "is", null]);
    // Legacy rows come from the same facility day through the legacy list shape.
    const legacy = client.reads.legacy ?? [];
    expect(legacy.some((call) => call.method === "gte" || call.method === "limit")).toBe(false);
    expect(legacy.find((call) => call.method === "lte")?.args).toEqual(["assigned_shift_date", "2026-09-10"]);
  });

  it("partitions purely by deadline against the facility's start of day", () => {
    const item = (id: string, deadline_at: string | null): WorkspaceItem => ({ occurrence: { id, deadline_at } as WorkspaceItem["occurrence"], rules: null, receipt: null, open_issues: 0, evidence_summary: null });
    const groups = partitionToday([item("b", startOfToday), item("a", "2020-01-01T00:00:00Z"), item("c", null), item("d", "2026-09-10T03:59:59.999Z")], { startOfToday });
    expect(groups.due_today.map((entry) => entry.occurrence.id)).toEqual(["b"]);
    expect(groups.outstanding.map((entry) => entry.occurrence.id)).toEqual(["a", "d"]);
    expect(groups.unknown_schedule.map((entry) => entry.occurrence.id)).toEqual(["c"]);
  });
});

describe("governing rules", () => {
  it("coalesces local over central as 341 does: a present local list wins even when empty, an absent one falls back", () => {
    const rules = resolveRules(version, { id: facilityRuleId, local_allowed_recorder_roles: [], local_required_inputs: null, local_required_evidence: [{ kind: "photo", label: "Scale", min_count: 1, when: "on_success" }] });
    expect(rules).toEqual({ inputs: version.required_inputs, evidence: [{ kind: "photo", label: "Scale", min_count: 1, when: "on_success" }], recorder_roles: [], review_required: false });
    expect(resolveRules(version, null)).toEqual({ inputs: version.required_inputs, evidence: [], recorder_roles: ["nurse", "facility_admin"], review_required: false });
  });

  it.each(["version", "local", "no-version"])("fails closed when the pinned %s rule is unavailable", async (missing) => {
    const client = fakeClient({
      managed: [occurrence({ id: uuid(1), requirement_version_id: missing === "no-version" ? null : versionId }), occurrence({ id: uuid(2), facility_requirement_id: null })],
      versions: missing === "version" ? [] : [version],
      facility_rules: missing === "local" ? [] : [facilityRule],
    });
    const body = await compose(client, { mine: true });
    expect(body.partial).toContain("rules");
    const items = todayGroups(body).due_today;
    expect(items[0].rules).toBeNull();
    expect(items[0].evidence_summary).toBeNull();
    if (missing !== "version") expect(items[1].rules?.can_record).toBe(true);
  });

  it("resolves each occurrence's own pinned versions and says whether the actor's role may record", async () => {
    const otherVersion = uuid(70);
    const client = fakeClient({
      managed: [occurrence({ id: uuid(1) }), occurrence({ id: uuid(2), requirement_version_id: otherVersion, facility_requirement_id: null })],
      versions: [version, { id: otherVersion, allowed_recorder_roles: ["nurse"], review_required: true, required_inputs: [], required_evidence: [{ kind: "document", label: "Log", min_count: 1, when: "always" }] }],
      facility_rules: [{ ...facilityRule, local_allowed_recorder_roles: ["facility_admin"] }],
    });
    const groups = todayGroups(await compose(client));
    const byId = new Map(groups.due_today.map((item) => [item.occurrence.id, item]));
    expect(byId.get(uuid(1))?.rules).toEqual({ inputs: version.required_inputs, evidence: [], recorder_roles: ["facility_admin"], review_required: false, can_record: true });
    expect(byId.get(uuid(2))?.rules).toEqual({ inputs: [], evidence: [{ kind: "document", label: "Log", min_count: 1, when: "always" }], recorder_roles: ["nurse"], review_required: true, can_record: false });
    expect(byId.get(uuid(2))?.evidence_summary).toEqual({ required_rules: 1, satisfied: false });
    expect(client.reads.versions?.find((call) => call.method === "in")?.args).toEqual(["id", [versionId, otherVersion]]);
    expect(client.reads.facility_rules?.find((call) => call.method === "in")?.args).toEqual(["id", [facilityRuleId]]);
  });
});

describe("mine narrowing", () => {
  const item = (id: string, recorder_roles: string[] | null): WorkspaceItem => ({
    occurrence: { id } as WorkspaceItem["occurrence"],
    rules: recorder_roles ? { inputs: [], evidence: [], recorder_roles, review_required: false, can_record: recorder_roles.includes("nurse") } : null,
    receipt: null,
    open_issues: 0,
    evidence_summary: null,
  });

  it("keeps rows naming the actor's role, unassigned rows and rows whose rules could not be read", () => {
    const kept = narrowToMine([item("mine", ["nurse"]), item("theirs", ["dietary"]), item("unassigned", []), item("unknown", null)], "nurse");
    expect(kept.map((entry) => entry.occurrence.id)).toEqual(["mine", "unassigned", "unknown"]);
  });

  it("keeps unassigned legacy tasks and the actor's own", () => {
    const task = (id: string, assigned_to: string | null, assigned_role: string | null) => ({ id, assigned_to, assigned_role }) as Parameters<typeof narrowLegacyToMine>[0][number];
    const kept = narrowLegacyToMine([task("own", "actor", null), task("other-person", "someone", null), task("own-role", null, "nurse"), task("other-role", null, "dietary"), task("unassigned", null, null)], { id: "actor", appRole: "nurse" });
    expect(kept.map((entry) => entry.id)).toEqual(["own", "own-role", "unassigned"]);
  });

  it("never narrows unless asked", async () => {
    const client = fakeClient({ managed: [occurrence({ id: uuid(1) })], versions: [{ ...version, allowed_recorder_roles: ["dietary"] }], facility_rules: [facilityRule] });
    expect(todayGroups(await compose(client)).due_today).toHaveLength(1);
    expect(todayGroups(await compose(client, { mine: true })).due_today).toHaveLength(0);
  });
});

describe("history paging", () => {
  it("round-trips an opaque cursor and rejects anything else", () => {
    const cursor = encodeHistoryCursor({ due_at: "2026-09-10T20:00:00+00:00", id: uuid(7) });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeHistoryCursor(cursor)).toEqual({ due_at: "2026-09-10T20:00:00+00:00", id: uuid(7) });
    expect(decodeHistoryCursor(encodeHistoryCursor({ due_at: null, id: uuid(8) }))).toEqual({ due_at: null, id: uuid(8) });
    expect(decodeHistoryCursor("not base64url!")).toBeNull();
    expect(decodeHistoryCursor(Buffer.from('{"d":"2026-09-10","i":"nope"}').toString("base64url"))).toBeNull();
    expect(decodeHistoryCursor(Buffer.from('{"d":"yesterday","i":"' + uuid(1) + '"}').toString("base64url"))).toBeNull();
  });

  it.each(["2026-09-10", "Thu Sep 10 2026 20:00:00 GMT (x,y)", "2026-09-10T20:00:00Z),id.gt.0", "2026-09-10T20:00:00.1234567Z"])("rejects unsafe or unsupported date syntax %s before any read", async (due_at) => {
    const client = fakeClient({});
    const outcome = await composeWorkspace({ actor: actorFor(client), facilityId, view: "history", cursor: encodeHistoryCursor({ due_at, id: uuid(7) }), mine: false, now });
    expect(outcome.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("preserves microseconds in both keyset predicates", async () => {
    const due_at = "2026-09-10T20:00:00.123456+00:00";
    const cursor = encodeHistoryCursor({ due_at, id: uuid(7) });
    expect(decodeHistoryCursor(cursor)).toEqual({ due_at, id: uuid(7) });
    const client = fakeClient({});
    await compose(client, { view: "history", cursor });
    expect(client.reads.managed?.filter((call) => call.method === "or")[1].args[0]).toBe(`due_at.lt.${due_at},and(due_at.eq.${due_at},id.lt.${uuid(7)}),due_at.is.null`);
  });

  it("pages fifty newest-first, takes the total from the count query and continues from the keyset cursor", async () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, index) => occurrence({ id: uuid(1000 - index), status: "completed", execution_state: "completed", effective_receipt_id: uuid(2000 - index), due_at: `2026-08-${String(30 - Math.floor(index / 5)).padStart(2, "0")}T20:00:00+00:00` }));
    const client = fakeClient({ managed: rows, count: 4321, versions: [version], facility_rules: [facilityRule], reversals: [{ task_instance_id: uuid(3) }] });
    const body = await compose(client, { view: "history" });
    const groups = historyGroups(body);
    expect(groups.history).toHaveLength(HISTORY_PAGE_SIZE);
    expect(groups.total).toBe(4321);
    expect(groups.next_cursor).not.toBeNull();
    const last = rows[HISTORY_PAGE_SIZE - 1];
    expect(decodeHistoryCursor(groups.next_cursor as string)).toEqual({ due_at: last.due_at, id: last.id });
    const managed = client.queries.managed?.[0] ?? [];
    expect(managed.find((call) => call.method === "limit")?.args).toEqual([HISTORY_PAGE_SIZE + 1]);
    expect(managed.filter((call) => call.method === "order").map((call) => call.args)).toEqual([["due_at", { ascending: false, nullsFirst: false }], ["id", { ascending: false }]]);
    // Finished rows, rows with an effective receipt and reversed rows (found through their reversal receipts) all belong to History.
    const membership = "status.in.(completed,cancelled),effective_receipt_id.not.is.null";
    expect(managed.find((call) => call.method === "or")?.args[0]).toBe(membership);
    expect(client.queries.count?.[0].find((call) => call.method === "or")?.args[0]).toBe(membership);
    expect(client.queries.managed?.[1].find((call) => call.method === "in")?.args).toEqual(["id", [uuid(3)]]);
    expect(client.reads.count?.find((call) => call.method === "select")?.args).toEqual(["id", { count: "exact", head: true }]);

    const next = fakeClient({ managed: rows.slice(HISTORY_PAGE_SIZE), count: 4321, versions: [version], facility_rules: [facilityRule] });
    const page = historyGroups(await compose(next, { view: "history", cursor: groups.next_cursor }));
    expect(page.history).toHaveLength(1);
    expect(page.next_cursor).toBeNull();
    const keyset = (next.reads.managed ?? []).filter((call) => call.method === "or").map((call) => call.args[0]);
    expect(keyset[1]).toBe(`due_at.lt.${last.due_at},and(due_at.eq.${last.due_at},id.lt.${last.id}),due_at.is.null`);
  });

  it("continues past the unscheduled tail by id alone", async () => {
    const client = fakeClient({ managed: [], count: 0 });
    await compose(client, { view: "history", cursor: encodeHistoryCursor({ due_at: null, id: uuid(9) }) });
    const managed = client.reads.managed ?? [];
    expect(managed.find((call) => call.method === "is" && call.args[0] === "due_at")?.args).toEqual(["due_at", null]);
    expect(managed.find((call) => call.method === "lt")?.args).toEqual(["id", uuid(9)]);
  });

  it("refuses a malformed cursor before reading", async () => {
    const client = fakeClient({});
    const outcome = await composeWorkspace({ actor: actorFor(client), facilityId, view: "history", cursor: "@@@", mine: false, now });
    expect(outcome).toEqual({ status: 400, error: "cursor is invalid" });
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("upcoming", () => {
  it("reads unfinished rows whose deadline falls after today through fourteen days", async () => {
    const client = fakeClient({ managed: [occurrence({ id: uuid(1), due_at: "2026-09-12T20:00:00+00:00" })], versions: [version], facility_rules: [facilityRule] });
    const body = await compose(client, { view: "upcoming" });
    expect("upcoming" in body.groups && body.groups.upcoming.map((item) => item.occurrence.id)).toEqual([uuid(1)]);
    const managed = client.reads.managed ?? [];
    expect(managed.find((call) => call.method === "or")?.args[0]).toBe(
      `and(grace_ends_at.gte.${startOfTomorrow},grace_ends_at.lt.2026-09-25T04:00:00.000Z),and(grace_ends_at.is.null,due_at.gte.${startOfTomorrow},due_at.lt.2026-09-25T04:00:00.000Z)`,
    );
    expect(client.reads.legacy).toBeUndefined();
  });
});

describe("receipts, issues and evidence", () => {
  it("attaches the effective receipt with its current evidence status and counts unresolved issues per occurrence", async () => {
    const receipt = { id: uuid(90), outcome: "performed", completion_state: "completed", evidence_status_current: "complete", evidence_satisfied_at: "2026-09-10T14:00:00+00:00", missing_evidence: [{ kind: "photo", label: "Scale", min_count: 1, when: "always" }], recorder_id: "actor" };
    const client = fakeClient({
      managed: [occurrence({ id: uuid(1), status: "in_progress", execution_state: "awaiting_verification", effective_receipt_id: uuid(90) }), occurrence({ id: uuid(2) })],
      versions: [version],
      facility_rules: [facilityRule],
      receipts: [receipt],
      issues: [{ task_instance_id: uuid(1) }, { task_instance_id: uuid(1) }, { task_instance_id: uuid(2) }],
    });
    const groups = todayGroups(await compose(client));
    const byId = new Map(groups.due_today.map((item) => [item.occurrence.id, item]));
    expect(byId.get(uuid(1))?.receipt).toEqual(receipt);
    expect(byId.get(uuid(1))?.open_issues).toBe(2);
    expect(byId.get(uuid(1))?.evidence_summary).toEqual({ required_rules: null, satisfied: true });
    expect(byId.get(uuid(2))?.receipt).toBeNull();
    expect(byId.get(uuid(2))?.open_issues).toBe(1);
    expect(byId.get(uuid(2))?.evidence_summary).toEqual({ required_rules: 0, satisfied: true });
    expect(client.reads.receipts?.find((call) => call.method === "in")?.args).toEqual(["id", [uuid(90)]]);
    expect(client.reads.issues?.find((call) => call.method === "neq")?.args).toEqual(["status", "resolved"]);
    expect(client.reads.issues?.find((call) => call.method === "in")?.args).toEqual(["task_instance_id", [uuid(1), uuid(2)]]);
  });

  it("summarises evidence from the receipt when there is one and from the performed-outcome rules otherwise", () => {
    const rules = { inputs: [], evidence: [{ kind: "photo", label: "A", min_count: 3, when: "always" as const }, { kind: "document", label: "B", min_count: 1, when: "on_success" as const }, { kind: "reading", label: "C", min_count: 1, when: "on_failure" as const }], recorder_roles: [], review_required: false };
    expect(summarizeEvidence(rules, null)).toEqual({ required_rules: 2, satisfied: false });
    expect(summarizeEvidence(null, null)).toBeNull();
    const receipt = (evidence_status_current: string, missing: unknown[]) => ({ id: "r", outcome: "performed", evidence_status_current, evidence_satisfied_at: null, missing_evidence: missing });
    expect(summarizeEvidence(rules, receipt("missing", [{}]))).toEqual({ required_rules: null, satisfied: false });
    // Corrections may carry finalized evidence, leaving an empty unmet snapshot.
    expect(summarizeEvidence(rules, receipt("complete", []))).toEqual({ required_rules: null, satisfied: true });
    expect(summarizeEvidence(rules, receipt("not_required", []))).toEqual({ required_rules: 0, satisfied: true });
  });
});

describe("partial and failed reads", () => {
  it("reports each failed sub-read and keeps the rows that loaded", async () => {
    const tables: Tables = { managed: [occurrence({ id: uuid(1), effective_receipt_id: uuid(90) })], versions: [version], facility_rules: [facilityRule], receipts: [{ id: uuid(90), outcome: "performed", evidence_status_current: "not_required", evidence_satisfied_at: null, missing_evidence: [] }], legacy: [] };
    const rulesDown = todayGroups(await compose(fakeClient(tables, ["versions"])));
    expect(rulesDown.due_today[0].rules).toBeNull();
    const facilityRulesDown = await compose(fakeClient(tables, ["facility_rules"]));
    expect(facilityRulesDown.partial).toEqual(["rules"]);
    const receiptsDown = await compose(fakeClient(tables, ["receipts"]));
    expect(receiptsDown.partial).toEqual(["receipts"]);
    expect(todayGroups(receiptsDown).due_today[0]).toMatchObject({ receipt: null, open_issues: 0, occurrence: { effective_receipt_id: uuid(90) } });
    const issuesDown = await compose(fakeClient(tables, ["issues"]));
    expect(issuesDown.partial).toEqual(["issues"]);
    expect(todayGroups(issuesDown).due_today[0].open_issues).toBeNull();
    const legacyDown = await compose(fakeClient(tables, ["legacy"]));
    expect(legacyDown.partial).toEqual(["legacy"]);
    expect(todayGroups(legacyDown)).toMatchObject({ legacy: [], due_today: [{ occurrence: { id: uuid(1) } }] });
    const everythingDown = await compose(fakeClient(tables, ["versions", "receipts", "issues", "legacy"]));
    expect(everythingDown.partial).toEqual(["rules", "receipts", "issues", "legacy"]);
    expect(todayGroups(everythingDown).due_today).toHaveLength(1);
  });

  it("marks a missing pinned receipt partial without substituting prospective rules", async () => {
    const body = await compose(fakeClient({ managed: [occurrence({ id: uuid(1), effective_receipt_id: uuid(90) })], versions: [version], facility_rules: [facilityRule] }));
    expect(body.partial).toEqual(["receipts"]);
    expect(todayGroups(body).due_today[0]).toMatchObject({ receipt: null, evidence_summary: null });
  });

  it("reports a failed history count without inventing a total from the page length", async () => {
    const client = fakeClient({ managed: [occurrence({ id: uuid(1), status: "completed" })], versions: [version], facility_rules: [facilityRule] }, ["count"]);
    const body = await compose(client, { view: "history" });
    expect(body.partial).toEqual(["total"]);
    expect(historyGroups(body)).toMatchObject({ total: null, history: [{ occurrence: { id: uuid(1) } }] });
  });

  it("never turns a failed primary read into an empty success", async () => {
    expect(await composeWorkspace({ actor: actorFor(fakeClient({}, ["managed"])), facilityId, view: "today", cursor: null, mine: false, now })).toEqual({ status: 503, error: "Workspace unavailable" });
    expect(await composeWorkspace({ actor: actorFor(fakeClient({}, ["facility"])), facilityId, view: "today", cursor: null, mine: false, now })).toEqual({ status: 503, error: "Workspace unavailable" });
    expect(await composeWorkspace({ actor: actorFor(fakeClient({}, ["reversals"])), facilityId, view: "history", cursor: null, mine: false, now })).toEqual({ status: 503, error: "Workspace unavailable" });
    expect(await composeWorkspace({ actor: actorFor(fakeClient({ facility: null })), facilityId, view: "today", cursor: null, mine: false, now })).toEqual({ status: 404, error: "Facility not found" });
  });

  it("distinguishes an empty site from a partial one", async () => {
    const body = await compose(fakeClient({}));
    expect(body.partial).toEqual([]);
    expect(todayGroups(body)).toEqual({ due_today: [], outstanding: [], unknown_schedule: [], legacy: [] });
  });
});

describe("provider row caps and id batches", () => {
  it.each(["today", "upcoming"] as const)("reads all 1101 %s rows and dependent ids under a small provider cap", async (view) => {
    const managed = Array.from({ length: 1101 }, (_, i) => occurrence({ id: uuid(i + 1), requirement_version_id: uuid(i + 2000), facility_requirement_id: null, effective_receipt_id: uuid(i + 4000) }));
    const versions = managed.map((row) => ({ ...version, id: row.requirement_version_id }));
    const receipts = managed.map((row) => ({ id: row.effective_receipt_id, outcome: "performed", evidence_status_current: "not_required", missing_evidence: [], evidence_satisfied_at: null }));
    const issues = Array.from({ length: 1101 }, () => ({ task_instance_id: uuid(1) }));
    const client = fakeClient({ managed, versions, receipts, issues }, [], 73);
    const body = await compose(client, { view });
    const items = "upcoming" in body.groups ? body.groups.upcoming : todayGroups(body).due_today;
    expect(items).toHaveLength(1101);
    expect(items[0].open_issues).toBe(1101);
    expect(items[1100].receipt?.id).toBe(uuid(5100));
    expect(body.partial).toEqual([]);
    for (const tag of ["versions", "receipts", "issues"] as const) {
      const batches = client.queries[tag] ?? [];
      expect(batches.length).toBeGreaterThan(11);
      for (const calls of batches) {
        const ids = calls.find((call) => call.method === "in")?.args[1] as string[];
        expect(ids.length).toBeLessThanOrEqual(WORKSPACE_ID_BATCH_SIZE);
        expect(calls.some((call) => call.method === "order" && call.args[0] === "id")).toBe(true);
      }
    }
    expect(client.queries.managed?.[1].find((call) => call.method === "range")?.args[0]).toBe(73);
  });

  it("retains 1101 old legacy rows and batches their assignee lookups", async () => {
    const legacy = Array.from({ length: 1101 }, (_, i) => ({ ...occurrence({ id: uuid(i + 1) }), occurrence_kind: null, assigned_shift_date: "2020-01-01", assigned_to: uuid(i + 2000), assigned_role: null, template_category: "safety", priority: "normal", assigned_shift: "day", updated_at: now.toISOString() }));
    const profiles = legacy.map((row) => ({ id: row.assigned_to, full_name: "Staff member" }));
    const client = fakeClient({ legacy, profiles }, [], 73);
    const body = await compose(client);
    expect(todayGroups(body).legacy).toHaveLength(1101);
    expect(body.partial).toEqual([]);
    expect(client.queries.profiles?.length).toBeGreaterThan(11);
    expect(client.reads.legacy?.filter((call) => call.method === "order").map((call) => call.args[0])).toEqual(["assigned_shift_date", "created_at", "id"]);
  });

  it("pages reversal receipts before deduplication and batches 1101 distinct reversed occurrences", async () => {
    const managed = Array.from({ length: 1101 }, (_, i) => occurrence({ id: uuid(i + 1) }));
    const client = fakeClient({ managed, versions: [version], facility_rules: [facilityRule], reversals: [...managed.map((row) => ({ task_instance_id: row.id })), { task_instance_id: uuid(1) }] }, [], 73);
    const groups = historyGroups(await compose(client, { view: "history" }));
    expect(groups.history).toHaveLength(50);
    expect(groups.total).toBe(1101);
    expect(groups.history[0].occurrence.id).toBe(uuid(1101));
    expect(client.queries.reversals?.length).toBeGreaterThan(15);
    expect(client.queries.managed?.length).toBeGreaterThanOrEqual(13);
    expect(client.queries.managed?.slice(1).every((calls) => (calls.find((call) => call.method === "in")?.args[1] as string[]).length <= 100)).toBe(true);
  });

  it("merges disjoint history sources without losing microsecond neighbors, null tails or site-wide counts", async () => {
    const managed = Array.from({ length: 60 }, (_, i) => occurrence({ id: uuid(i + 1), status: i % 2 ? "completed" : "pending", due_at: `2026-09-10T20:00:00.${String(i + 1).padStart(6, "0")}+00:00` }));
    managed.push(occurrence({ id: uuid(80), status: "completed", due_at: null }));
    // Also include a reversed id already in the base; it must be excluded from the extra source.
    const reversals = managed.map((row) => ({ task_instance_id: row.id }));
    const tables = { managed, reversals, versions: [version], facility_rules: [facilityRule] };
    const first = historyGroups(await compose(fakeClient(tables, [], 17), { view: "history" }));
    expect(first.total).toBe(61);
    expect(first.history.map((item) => item.occurrence.id)).toEqual(Array.from({ length: 50 }, (_, i) => uuid(60 - i)));
    const next = historyGroups(await compose(fakeClient(tables, [], 17), { view: "history", cursor: first.next_cursor }));
    expect(next.total).toBe(61);
    expect(next.history.map((item) => item.occurrence.id)).toEqual([...Array.from({ length: 10 }, (_, i) => uuid(10 - i)), uuid(80)]);
    expect(next.next_cursor).toBeNull();
  });

  it("merges differing timezone offsets and fractional widths in PostgreSQL order", async () => {
    const managed = [
      occurrence({ id: uuid(1), status: "completed", due_at: "2026-09-10T20:00:00.1Z" }),
      occurrence({ id: uuid(2), due_at: "2026-09-10T15:00:00.100001-05:00" }),
      occurrence({ id: uuid(3), status: "completed", due_at: "2026-09-10T20:00:00.09+00:00" }),
      occurrence({ id: uuid(4), due_at: "2026-09-10T20:00:00.100000Z" }),
    ];
    const client = fakeClient({ managed, reversals: managed.map((row) => ({ task_instance_id: row.id })), versions: [version], facility_rules: [facilityRule] });
    const groups = historyGroups(await compose(client, { view: "history" }));
    expect(groups.history.map((item) => item.occurrence.id)).toEqual([uuid(2), uuid(4), uuid(1), uuid(3)]);
  });

  it("discards incomplete primary and sub-read pages after later-page failures", async () => {
    const managed = Array.from({ length: 100 }, (_, i) => occurrence({ id: uuid(i + 1) }));
    const primary = fakeClient({ managed }, [{ tag: "managed", from: 73 }], 73);
    expect((await composeWorkspace({ actor: actorFor(primary), facilityId, view: "today", cursor: null, mine: false, now })).status).toBe(503);
    const history = fakeClient({ managed: managed.map((row) => ({ ...row, status: "completed" })) }, [{ tag: "managed", from: 17 }], 17);
    expect((await composeWorkspace({ actor: actorFor(history), facilityId, view: "history", cursor: null, mine: false, now })).status).toBe(503);
    const issues = Array.from({ length: 100 }, () => ({ task_instance_id: uuid(1) }));
    const body = await compose(fakeClient({ managed: managed.slice(0, 1), versions: [version], facility_rules: [facilityRule], issues }, [{ tag: "issues", from: 73 }], 73));
    expect(body.partial).toEqual(["issues"]);
    expect(todayGroups(body).due_today[0].open_issues).toBeNull();
    const reversal = fakeClient({ reversals: issues }, [{ tag: "reversals", from: 73 }], 73);
    expect((await composeWorkspace({ actor: actorFor(reversal), facilityId, view: "history", cursor: null, mine: false, now })).status).toBe(503);
  });
});

describe("what the reply never carries", () => {
  it("names subjects without a protected person's name and carries no object paths or request fingerprints", async () => {
    const receipt = { id: uuid(90), outcome: "performed", evidence_status_current: "missing", evidence_satisfied_at: null, missing_evidence: [], request_key: "rec-0001", recorder_id: "actor" };
    const client = fakeClient({
      managed: [
        occurrence({ id: uuid(1), effective_receipt_id: uuid(90) }),
        occurrence({ id: uuid(2), authority_class: "facility", subject_id: uuid(50) }),
        occurrence({ id: uuid(3), authority_class: "employee_medical", subject_id: uuid(51) }),
        occurrence({ id: uuid(4), authority_class: "asset", subject_id: uuid(52) }),
      ],
      versions: [version],
      facility_rules: [facilityRule],
      receipts: [receipt],
    });
    const body = await compose(client);
    const labels = todayGroups(body).due_today.map((item) => [item.occurrence.id, item.occurrence.subject_label]);
    expect(labels).toEqual([[uuid(1), `Resident ${residentSubject.slice(0, 8)}`], [uuid(2), "Homewood Lodge"], [uuid(3), `Employee ${uuid(51).slice(0, 8)}`], [uuid(4), `Asset ${uuid(52).slice(0, 8)}`]]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("object_path");
    expect(serialized).not.toContain("request_hash");
    expect(serialized).not.toContain("schedule_snapshot");
    // The receipt read never selects object paths; evidence rows are not read here at all.
    expect(client.reads.receipts?.find((call) => call.method === "select")?.args[0]).not.toContain("object_path");
    expect(client.from.mock.calls.map((call) => call[0])).not.toContain("operation_evidence");
    expect(Object.keys(todayGroups(body).due_today[0].occurrence).sort()).toEqual([
      "activity_id", "activity_name", "authority_class", "deadline_at", "due_at", "effective_receipt_id", "execution_state", "facility_requirement_id", "grace_ends_at", "id",
      "occurrence_kind", "occurrence_revision", "period_end_date", "period_start_date", "requirement_version_id", "schedule_status", "status", "subject_id", "subject_label",
    ]);
  });
});
