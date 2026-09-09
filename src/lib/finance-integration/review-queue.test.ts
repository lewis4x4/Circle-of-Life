import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { formatReviewCents, formatReviewTimestamp, loadReviewChoices, loadReviewPage, parseReviewDetail, parseReviewPage, type ReviewRequest } from "./review-queue";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64);
const request: ReviewRequest = { organizationId: id(1), entityId: id(2), facilityId: id(3), kind: "events", cursor: null, limit: 2 };
const row = (n: number) => ({ id: id(n), created_at: "2026-09-08T12:00:00.123456+00:00", facility_id: id(3), operation: "payment_received", source_type: "payment", source_id: id(100 + n), source_version: hash, amount_basis: "payment_gross", control_total_cents: "9007199254740993", claimed: false, claimed_batch_id: null });
const page = () => ({ organization_id: id(1), entity_id: id(2), facility_id: id(3), kind: "events", observed_at: "2026-09-08T13:00:00+00:00", consistency: "live_page", items: [row(5), row(4)], total_count: "3", returned_count: 2, has_more: true, next_cursor: { id: id(4), created_at: row(4).created_at }, coverage_scope: "finance_command_receipts_336_only", unrepresented_eligible_receipts: "0", staging_stopped: false, business_release_eligible: false, dispatch_enabled: false });
function detail() {
    const batchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const controls = [{ amountBasis: "payment_gross", operation: "payment_received", eventCount: "1", grossCents: "100" }];
    const lines = [{ accountReference: "100", side: "debit", amountCents: "100" }, { accountReference: "200", side: "credit", amountCents: "100" }];
    return { batch: { id: batchId, created_at: row(4).created_at, organization_id: id(1), entity_id: id(2), facility_id: id(3), accounting_date: "2026-09-08", currency: "USD", status: "prepared", rules_version_id: id(8), payload: { schemaVersion: 1, companyReference: "123", batchReference: batchId, accountingDate: "2026-09-08", currency: "USD", lines }, payload_sha256: hash, member_set_sha256: hash, source_controls: controls, source_controls_sha256: hash, binding_sha256: hash, supersedes: null, accounting_classification: "unverified", business_release_eligible: false, dispatch_enabled: false, preparer_session_id: "must-never-render" }, members: [{ eventId: id(9), identitySha256: hash, sourceVersion: hash, amountBasis: "payment_gross", operation: "payment_received", controlTotalCents: "100", economicDate: "2026-09-08", lines }], decision_history: [{ id: id(10), created_at: row(4).created_at, batch_id: batchId, action: "prepare", origin: "operator", binding_sha256: hash, resulting_status: "prepared", reason_code: null, actor_session_id: "must-never-render" }], invalid_reason: null, accounting_classification: "unverified", business_release_eligible: false, dispatch_enabled: false, binding_claim: "declared_local_only" };
}
describe("accounting review read boundary", () => {
    it("HFA-054: displays both summer and winter timestamps in Eastern time", () => {
        expect(formatReviewTimestamp("2026-09-08T12:00:00.123456Z")).toBe("Sep 8, 2026, 8:00 AM ET");
        expect(formatReviewTimestamp("2026-01-08T12:00:00Z")).toBe("Jan 8, 2026, 7:00 AM ET");
    });

    it("HFA-036: accepts PostgreSQL seed UUIDs and retains exact cents beyond JSON safe integers", () => { expect(parseReviewPage(page(), request).items[0]).toMatchObject({ control_total_cents: "9007199254740993" }); expect(formatReviewCents("9007199254740993")).toBe("$90,071,992,547,409.93"); });
    it.each(["organization_id", "entity_id", "facility_id"])("HFA-065: rejects mismatched %s", key => { expect(() => parseReviewPage({ ...page(), [key]: id(99) }, request)).toThrow(); });
    it.each(["business_release_eligible", "dispatch_enabled"])("HFA-054: requires literal false for %s", key => { for (const bad of [true, null, "false", 0])
        expect(() => parseReviewPage({ ...page(), [key]: bad }, request)).toThrow(); });
    it("HFA-036: rejects numeric, noncanonical and overflowing amounts", () => { for (const amount of [100, "01", "1e2", "-0", "9223372036854775808"])
        expect(() => parseReviewPage({ ...page(), items: [{ ...row(5), control_total_cents: amount }, row(4)] }, request)).toThrow(); });
    it("HFA-052: rejects incomplete, wrong-last-row and inconsistent cursors/counts", () => { for (const patch of [{ next_cursor: { id: id(4) } }, { next_cursor: { id: id(99), created_at: row(4).created_at } }, { returned_count: 1 }, { has_more: false }, { total_count: "1" }, { has_more: false, next_cursor: null }, { items: [row(5), row(5)] }])
        expect(() => parseReviewPage({ ...page(), ...patch }, request)).toThrow(); });
    it("HFA-052: honors microsecond ordering rather than rounding timestamps", () => { const data = page(); data.items[0] = { ...row(4), created_at: "2026-09-08T12:00:00.123457+00:00" }; data.items[1] = row(5); data.next_cursor.id = id(5); expect(parseReviewPage(data, request).returned_count).toBe(2); });
    it("HFA-052 HFA-065: rejects rows before the requested cursor and facility leakage", () => { expect(() => parseReviewPage(page(), { ...request, cursor: page().next_cursor })).toThrow(); expect(() => parseReviewPage({ ...page(), items: [{ ...row(5), facility_id: id(99) }, row(4)] }, request)).toThrow(); });
    it("HFA-065: retains claims with inaccessible broader batch details", () => { const result = parseReviewPage({ ...page(), items: [{ ...row(5), claimed: true }, row(4)] }, request); expect(result.items[0]).toMatchObject({ claimed: true, claimed_batch_id: null }); });
    it("HFA-065 HFA-054: strips historical session identifiers from parsed detail and checks detail scope", () => { const value = detail(); const parsed = parseReviewDetail(value, request, value.batch.id); expect(JSON.stringify(parsed)).not.toContain("must-never-render"); expect(() => parseReviewDetail(value, { ...request, facilityId: id(99) }, value.batch.id)).toThrow(); expect(() => parseReviewDetail(value, request, id(99))).toThrow(); expect(() => parseReviewDetail({ ...value, dispatch_enabled: true }, request, value.batch.id)).toThrow(); });
    it("HFA-036: rejects nested payload free fields and non-string member money", () => { const value = detail(); expect(() => parseReviewDetail({ ...value, batch: { ...value.batch, payload: { ...value.batch.payload, memo: "unapproved free field" } } }, request, value.batch.id)).toThrow(); expect(() => parseReviewDetail({ ...value, members: [{ ...value.members[0], controlTotalCents: 100 }] }, request, value.batch.id)).toThrow(); });
    it("HFA-052 HFA-054: rejects excess timestamp precision and active invalidated detail", () => {
        const value = page(); value.items[0].created_at = "2026-09-08T12:00:00.1234567Z";
        expect(() => parseReviewPage(value, request)).toThrow();
        const snapshot = detail();
        expect(() => parseReviewDetail({ ...snapshot, invalid_reason: "preparer_authority_changed" }, request, snapshot.batch.id)).toThrow();
    });
    it("HFA-054: does not accept an active batch row with a current invalidation reason", () => {
        const snapshot = detail();
        const row = { id: snapshot.batch.id, created_at: snapshot.batch.created_at, facility_id: id(3), accounting_date: "2026-09-08", status: "prepared", invalid_reason: "rules_changed", source_controls: snapshot.batch.source_controls, binding_sha256: hash, accounting_classification: "unverified", business_release_eligible: false, dispatch_enabled: false };
        expect(() => parseReviewPage({ ...page(), kind: "batches", items: [row], returned_count: 1, total_count: "1", has_more: false, next_cursor: null }, { ...request, kind: "batches" })).toThrow();
    });
    it("HFA-052: passes complete cursor and abort signal to the read-only RPC", async () => { const abortSignal = vi.fn().mockResolvedValue({ data: page(), error: null }); const rpc = vi.fn().mockReturnValue({ abortSignal }); const client = { rpc } as unknown as SupabaseClient<Database>; const controller = new AbortController(); await loadReviewPage(client, request, controller.signal); expect(rpc).toHaveBeenCalledWith("finance_review_queue", { p_entity: id(2), p_facility: id(3), p_kind: "events", p_after_created_at: null, p_after_id: null, p_limit: 2 }); expect(abortSignal).toHaveBeenCalledWith(controller.signal); });
});

function choicesClient(pages: Record<string, unknown[][]>) {
    const cursors: { table: string; after: string | null }[] = [];
    const positions: Record<string, number> = {};
    const from = vi.fn((table: string) => {
        let after: string | null = null;
        const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query, gt: (_column: string, value: string) => { after = value; return query; }, abortSignal: async () => { cursors.push({ table, after }); const index = positions[table] ?? 0; positions[table] = index + 1; return { data: pages[table]?.[index] ?? [], error: null }; } };
        return query;
    });
    return { client: { from } as unknown as SupabaseClient<Database>, cursors };
}
describe("authorized selector keysets", () => {
    it("HFA-052: reads through a server cap lower than requested and stops only on empty pages", async () => {
        const source = choicesClient({ entities: [[{ id: id(2), name: "Entity A", organization_id: id(1) }], [{ id: id(4), name: "Entity B", organization_id: id(1) }], []], facilities: [[{ id: id(3), name: "Facility", entity_id: id(2), organization_id: id(1) }], []] });
        const result = await loadReviewChoices(source.client, id(1), new AbortController().signal);
        expect(result.entities).toHaveLength(2);
        expect(source.cursors).toEqual([{ table: "entities", after: null }, { table: "entities", after: id(2) }, { table: "entities", after: id(4) }, { table: "facilities", after: null }, { table: "facilities", after: id(3) }]);
    });
    it("HFA-052 HFA-065: rejects duplicates, nonadvancing IDs and wrong-organization choices", async () => {
        for (const next of [{ id: id(2), organization_id: id(1) }, { id: id(1), organization_id: id(1) }, { id: id(4), organization_id: id(9) }]) {
            const source = choicesClient({ entities: [[{ id: id(2), name: "First", organization_id: id(1) }], [{ ...next, name: "Invalid" }]] });
            await expect(loadReviewChoices(source.client, id(1), new AbortController().signal)).rejects.toThrow();
        }
    });
    it("HFA-065: rejects a facility whose entity is absent from authorized entity choices", async () => {
        const source = choicesClient({ entities: [[{ id: id(2), name: "Entity", organization_id: id(1) }], []], facilities: [[{ id: id(3), name: "Facility", entity_id: id(99), organization_id: id(1) }]] });
        await expect(loadReviewChoices(source.client, id(1), new AbortController().signal)).rejects.toThrow("Facility entity unavailable");
    });
});
