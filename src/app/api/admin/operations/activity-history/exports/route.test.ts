import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanViewOperations: vi.fn() }));
import { requireOperationsActor, revalidateOperationsActor, actorCanViewOperations } from "@/lib/operations/auth";
import { POST } from "./route";
import { GET } from "./[id]/download/route";
const id = "11111111-1111-4111-8111-111111111111", site = "00000000-0000-0000-0002-000000000003";
const rpc = vi.fn();
const actor = { id: "actor", organizationId: "org", appRole: "owner", currentActor: { client: { rpc } } };
const manifest = { schema_version: 1, generated_at: "2026-09-12T12:00:00Z", snapshot_id: "1:2:", filters: { facility_id: site, activity_id: id }, total: 1, receipt_total: 1, evidence_total: 0, complete: true, source: "Haven", coverage: "Authorized history" };
const row = { id, subject_id: null, authority_class: "facility", activity_name: "=SUM(1,2)", status: "completed", created_at: "2026-09-12T12:00:00Z", receipts: [{ id: "receipt", revision: "v1" }], evidence: [], source_events: [] };
const page = { export_id: id, manifest, rows: [row], offset: 0, next_offset: null };
const get = () => GET(new Request("https://local.test"), { params: Promise.resolve({ id }) });
const post = (body: unknown = { facility_id: site, activity_id: id, request_id: id }) => POST(new Request("https://local.test", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanViewOperations).mockReturnValue(true);
  rpc.mockResolvedValue({ data: page, error: null });
});
describe("history export create and downloadable artifact", () => {
  it("creates an idempotent scope snapshot and rechecks authority", async () => {
    rpc.mockResolvedValueOnce({ data: { export_id: id, manifest }, error: null });
    const response = await post(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ export_id: id, download_url: expect.stringContaining(`${id}/download`) });
    expect(rpc.mock.calls[0]).toEqual(["create_operation_history_export", { p_facility: site, p_activity: id, p_request: id }]);
    expect(rpc.mock.calls[1][0]).toBe("read_operation_history_export");
  });
  it("downloads the actual complete CSV with neutralized formula and manifest", async () => {
    const response = await get(); expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const csv = await response.text(); expect(csv).toContain('"\'=SUM(1,2)"'); expect(csv).toContain('""snapshot_id"":""1:2:""'); expect(csv).toContain('""revision"":""v1""');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("does not send a partial CSV when a later page fails", async () => {
    rpc.mockResolvedValueOnce({ data: { ...page, manifest: { ...manifest, total: 2, receipt_total: 2 }, next_offset: 1 }, error: null }).mockResolvedValueOnce({ data: null, error: { code: "08006" } });
    const response = await get(); expect(response.status).toBe(503); expect(response.headers.get("content-disposition")).toBeNull(); expect(await response.json()).toHaveProperty("error");
  });
  it.each(["site", "native", "actor"])("rejects %s access revoked after assembly", async kind => {
    if (kind === "actor") vi.mocked(revalidateOperationsActor).mockResolvedValue({ response: NextResponse.json({ error: "Denied" }, { status: 403 }) });
    else rpc.mockResolvedValueOnce({ data: page, error: null }).mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    const response = await get(); expect(response.status).toBe(403); expect(response.headers.get("content-disposition")).toBeNull();
  });
  it("denies unauthenticated create/download before querying", async () => {
    vi.mocked(requireOperationsActor).mockResolvedValue({ response: NextResponse.json({}, { status: 401 }) });
    expect((await post()).status).toBe(401); expect((await get()).status).toBe(401); expect(rpc).not.toHaveBeenCalled();
  });
  it("retains the distinct client-generated request token contract", async () => {
    expect((await post({ facility_id: site, activity_id: id, request_id: site })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validates exact filters and refuses arbitrary query/extra fields", async () => {
    expect((await post({ facility_id: site, activity_id: id, request_id: id, sql: "x" })).status).toBe(400);
    expect((await post({ facility_id: "bad" })).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses changed requester even when a new actor still has a view role", async () => {
    vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor: { ...actor, id: "someone-else" } } as never);
    expect((await get()).status).toBe(403);
  });
});
