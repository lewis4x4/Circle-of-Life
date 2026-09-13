import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn() }));
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { GET } from "./route";
import { GET as history } from "../occurrences/[id]/source-reviews/route";
import { POST as record } from "../occurrences/[id]/source-review/route";
import { POST as recheck } from "../occurrences/[id]/source-reviews/recheck/route";
const id = "00000000-0000-0000-0002-000000000003";
const rpc = vi.fn(); const actor = { id, organizationId: id, appRole: "owner", currentActor: { client: { rpc } } };
const context = () => ({ params: Promise.resolve({ id }) });
const period = { start_date: "2026-09-01", end_date: "2026-09-13" };
const candidates = { task_id: id, subject_kind: "resident", eligible: true, allowed_families: ["resident_contact"], family: "resident_contact", period, availability: "available", reason: null, items: [], next_cursor: null, complete: true };
const hist = { task_id: id, reviews: [] };
const payload = { request_key: "source-review-001", expected_occurrence_revision: "a".repeat(64), period,
  references: [{ family: "resident_contact", source_id: id, source_version: "b".repeat(64) }], payload: { outcome: "performed", note: "Explicit review" } };
const req = (body: unknown) => new Request("https://local.test", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never); vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never); });
describe("resident source API current native reads", () => {
  it("reads candidates only after revalidation so native access loss cannot leak a stale list", async () => {
    let visible = true;
    vi.mocked(revalidateOperationsActor).mockImplementation(async () => { visible = false; return { actor } as never; });
    rpc.mockImplementation(async () => ({ data: { ...candidates, items: visible ? [{ source_id: id, source_version: "b".repeat(64), source_at: null, label: "private", evidence_meaning: "metadata" }] : [] }, error: null }));
    const response = await GET(new Request(`https://local.test?task_id=${id}&family=resident_contact&start_date=2026-09-01&end_date=2026-09-13`));
    expect(response.status).toBe(200); expect((await response.json()).items).toEqual([]); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("uses the revalidated caller for history and returns only fresh masked history", async () => {
    const freshRpc = vi.fn().mockResolvedValue({ data: hist, error: null });
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor: { ...actor, currentActor: { client: { rpc: freshRpc } } } } as never);
    expect((await history(new Request("https://local.test"), context())).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled(); expect(freshRpc).toHaveBeenCalledWith("read_resident_source_reviews", { p_task: id });
  });
  it("does not disclose mutation-time history after revalidation loses native visibility", async () => {
    rpc.mockResolvedValueOnce({ data: { private_stale_source: id }, error: null }).mockResolvedValueOnce({ data: hist, error: null });
    const response = await recheck(req({ reference_id: id, request_key: "recheck-001" }), context());
    expect(response.status).toBe(200); expect(await response.json()).toEqual(hist);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["recheck_resident_source_review", "read_resident_source_reviews"]);
  });
  it("returns the human performance receipt without request hashes and verifies final HFO scope", async () => {
    rpc.mockResolvedValueOnce({ data: { receipt_outcome: { receipt: { id, recorder_id: id, request_hash: "private" }, occurrence: { id }, issue: null, replayed: false }, references: [{ reference_id: id }] }, error: null }).mockResolvedValueOnce({ data: hist, error: null });
    const response = await record(req(payload), context()); expect(response.status).toBe(200);
    expect((await response.json()).receipt).not.toHaveProperty("request_hash");
    expect(rpc.mock.calls[0][1].p_payload).toEqual(payload.payload);
  });
  it("does not return a saved receipt after final HFO scope revocation", async () => {
    rpc.mockResolvedValueOnce({ data: { receipt_outcome: { receipt: { id }, occurrence: { id }, issue: null, replayed: false }, references: [{ reference_id: id }] }, error: null }).mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await record(req(payload), context())).status).toBe(404);
  });
  it("rejects historical review claims and an arbitrary family before mutation", async () => {
    expect((await record(req({ ...payload, payload: { outcome: "performed", performed_at: "2026-09-01T12:00:00Z" } }), context())).status).toBe(400);
    expect((await GET(new Request(`https://local.test?task_id=${id}&family=arbitrary&start_date=2026-09-01&end_date=2026-09-13`))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("denies anonymous and changed actor before native access", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) });
    expect((await history(new Request("https://local.test"), context())).status).toBe(401);
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor: { ...actor, id: "other" } } as never);
    expect((await history(new Request("https://local.test"), context())).status).toBe(404); expect(rpc).not.toHaveBeenCalled();
  });
});
