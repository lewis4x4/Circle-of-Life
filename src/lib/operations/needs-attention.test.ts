import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/operations/auth", () => ({ listActorAccessibleFacilityIds: vi.fn() }));
import { listActorAccessibleFacilityIds, type OperationsActor } from "./auth";
import { classifyAttention, composeNeedsAttention, type AttentionSources, type AttentionRow } from "./needs-attention";
const siteId = "11111111-1111-4111-8111-111111111111";
const activityId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-09-13T12:00:00Z");
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const rule = { rule_version: 1, timezone: "America/New_York", recurrence: { kind: "weekly", weekday: "monday" }, deadline: { time: "12:00" } };
function site(overrides: Partial<AttentionSources> = {}): AttentionSources {
  return { facility: { id: siteId, name: "Homewood", timezone: "America/New_York" }, occurrences: [], receipts: [], issues: [], activities: [{ id: activityId, name: "Generator check" }], configurations: [{ id: id(1), activity_id: activityId, requirement_version_id: id(2), status: "published", effective_from: "2026-01-01T00:00:00Z", effective_to: null, applicability: "applicable", schedule_status: "confirmed", schedule_rule: rule }], versions: [{ id: id(2), activity_id: activityId, status: "published", effective_from: "2026-01-01T00:00:00Z", effective_to: null }], ...overrides };
}
const occurrence = (n: number, extra: Record<string, unknown> = {}): AttentionRow => ({ id: id(n), activity_id: activityId, occurrence_kind: "scheduled", status: "pending", assigned_role: "maintenance_role", attention_ownership: { coverage_current: true, owner_user_id: id(99), backup_user_id: null }, due_at: "2026-09-12T12:00:00Z", grace_ends_at: null, ...extra });
const issue = (n: number, extra: Record<string, unknown> = {}): AttentionRow => ({ id: id(n), activity_id: activityId, summary: "Generator failed", severity: "high", status: "open", owner_user_id: null, owner_role: null, owner_current: null, ...extra });
describe("attention categories and denominators", () => {
  it("counts overlaps by source identity while failed performed work stays an unresolved issue", () => {
    const result = classifyAttention([site({ occurrences: [occurrence(3, { status: "completed", execution_state: "failed", effective_receipt_id: id(4) }), occurrence(5, { assigned_role: null, attention_ownership: { coverage_current: false, owner_user_id: id(99) }, execution_state: "awaiting_verification" })], receipts: [{ id: id(4), evidence_status_current: "missing" }], issues: [issue(6, { task_instance_id: id(3), status: "waiting" })] })], now);
    expect(Object.fromEntries(Object.entries(result.counts).map(([key, value]) => [key, value.count]))).toEqual({ overdue: 1, unresolved_issues: 1, missing_evidence: 1, waiting: 2, unassigned: 2, configuration_needed: 0 });
    expect(result.items).toHaveLength(3); expect(result.high_severity_issues).toBe(1);
    expect(result.counts.waiting.denominator).toBe(2); expect(result.counts.missing_evidence.denominator).toBe(1);
  });
  it("deduplicates configuration category while preserving distinct unknown reasons", () => {
    const result = classifyAttention([site({ occurrences: [occurrence(3, { due_at: null, attention_ownership: { coverage_current: false, owner_user_id: null, backup_user_id: null } })] })], now);
    expect(result.items[0].categories).toEqual(["unassigned", "configuration_needed"]);
    expect(result.items[0].reason).toContain("Named coverage"); expect(result.items[0].reason).toContain("deadline");
    expect(result.counts.configuration_needed.count).toBe(1);
  });
  it("uses grace/evaluator and current evidence instead of stale evidence requirements", () => {
    const result = classifyAttention([site({ occurrences: [occurrence(3, { grace_ends_at: "2026-09-14T00:00:00Z", effective_receipt_id: id(4) }), occurrence(5, { due_at: null, occurrence_kind: "manual" })], receipts: [{ id: id(4), evidence_status_current: "complete", missing_evidence: [{ old: true }] }] })], now);
    expect(result.items).toEqual([]); expect(result.counts.overdue.denominator).toBe(2);
  });
  it("separates absent/future configuration, not applicable, and unknown scheduled occurrence", () => {
    const base = site();
    expect(classifyAttention([site({ configurations: [] })], now).counts.configuration_needed.count).toBe(1);
    expect(classifyAttention([site({ configurations: [{ ...base.configurations![0], effective_from: "2027-01-01T00:00:00Z" }] })], now).counts.configuration_needed.count).toBe(1);
    expect(classifyAttention([site({ configurations: [{ ...base.configurations![0], applicability: "not_applicable", schedule_status: "needs_confirmation" }] })], now).counts.configuration_needed.count).toBe(0);
    expect(classifyAttention([site({ occurrences: [occurrence(3, { due_at: null })] })], now).counts.configuration_needed.count).toBe(1);
    expect(classifyAttention([site({ activities: [] })], now).counts.configuration_needed.count).toBeNull();
  });
  it("retains role ownership only when current, and makes source failure unavailable", () => {
    const result = classifyAttention([site({ issues: [issue(3, { owner_role: "manager", owner_current: true }), issue(4, { owner_user_id: id(9), owner_current: false })] })], now);
    expect(result.counts.unassigned.count).toBe(1);
    const failed = classifyAttention([site({ issues: null, receipts: null })], now);
    expect(failed.counts.unresolved_issues.count).toBeNull(); expect(failed.high_severity_issues).toBeNull(); expect(failed.counts.missing_evidence.count).toBeNull();
  });
});
function fakeActor(source: AttentionSources, fail?: { table: string; from: number }) {
  const tables: Record<string, AttentionRow[] | null> = { operation_attention_occurrences: source.occurrences, operation_execution_receipts: source.receipts, operation_issue_backlog: source.issues, operation_activities: source.activities, operation_facility_requirements: source.configurations, operation_requirement_versions: source.versions };
  const reads: { table: string; calls: unknown[][] }[] = [];
  const client = { from(table: string) {
    const calls: unknown[][] = []; reads.push({ table, calls }); const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not", "is", "or", "order", "range"]) query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; };
    const result = () => {
      if (table === "facilities") return { data: source.facility, error: null };
      const range = calls.find((call) => call[0] === "range"), from = Number(range?.[1] ?? 0);
      if (table === fail?.table && from >= fail.from || tables[table] === null) return { data: null, error: { message: "late source failure" } };
      const rows = tables[table] ?? [];
      return { data: rows.slice(from, Math.min(Number(range?.[2] ?? rows.length) + 1, from + 17)), error: null };
    };
    query.maybeSingle = () => Promise.resolve(result()); query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve); return query;
  } };
  return { actor: { id: id(9999), organizationId: "org", appRole: "owner", currentActor: { client } } as unknown as OperationsActor, reads };
}
beforeEach(() => { vi.mocked(listActorAccessibleFacilityIds).mockResolvedValue([siteId]); });
describe("complete source reads and detail paging", () => {
  it("reconciles 1103 items across provider caps and every page independent of category overlaps", async () => {
    const { actor, reads } = fakeActor(site({ issues: Array.from({ length: 1103 }, (_, n) => issue(n)) }));
    const seen: string[] = []; let cursor: string | null = null;
    do {
      const result = await composeNeedsAttention({ actor, facilityId: null, category: "unresolved_issues", cursor, now });
      expect(result.status).toBe(200); if (result.status !== 200) throw new Error(result.error);
      expect(result.body.total).toBe(1103); expect(result.body.counts.unassigned.count).toBe(1103);
      seen.push(...result.body.items.map((item) => item.key)); cursor = result.body.next_cursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(1103); expect(seen.length).toBe(1103);
    for (const read of reads) expect(read.calls).toContainEqual(["eq", "organization_id", "org"]);
    for (const read of reads.filter((r) => r.table === "operation_issue_backlog")) expect(read.calls).toContainEqual(["eq", "facility_id", siteId]);
  });
  it("never reports zero/all clear when a later source page fails", async () => {
    const { actor } = fakeActor(site({ issues: Array.from({ length: 1103 }, (_, n) => issue(n)) }), { table: "operation_issue_backlog", from: 1020 });
    const result = await composeNeedsAttention({ actor, facilityId: null, category: "unresolved_issues", cursor: null, now });
    expect(result).toMatchObject({ status: 200, body: { total: null, all_clear: false, counts: { unresolved_issues: { count: null } } } });
  });
  it("rejects cursors across scope/category and dataset changes", async () => {
    const { actor } = fakeActor(site({ issues: Array.from({ length: 60 }, (_, n) => issue(n)) }));
    const first = await composeNeedsAttention({ actor, facilityId: null, category: null, cursor: null, now });
    if (first.status !== 200) throw new Error(first.error);
    expect((await composeNeedsAttention({ actor, facilityId: null, category: "waiting", cursor: first.body.next_cursor, now })).status).toBe(400);
    const changed = fakeActor(site({ issues: Array.from({ length: 61 }, (_, n) => issue(n)) }));
    expect((await composeNeedsAttention({ actor: changed.actor, facilityId: null, category: null, cursor: first.body.next_cursor, now })).status).toBe(409);
  });
  it("does not claim all clear without accessible facilities", async () => {
    vi.mocked(listActorAccessibleFacilityIds).mockResolvedValue([]);
    const result = await composeNeedsAttention({ ...fakeActor(site()), facilityId: null, category: null, cursor: null, now });
    expect(result).toMatchObject({ status: 200, body: { facilities: [], all_clear: false } });
  });
});
