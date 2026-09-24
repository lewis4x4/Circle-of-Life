import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), load: vi.fn(), facility: vi.fn() }));
vi.mock("@/lib/auth/current-api-actor", () => ({ requireCurrentApiActor: mocks.actor }));
vi.mock("@/lib/workforce/load", () => ({ loadWorkforce: mocks.load }));
import { GET } from "./route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: mocks.facility };
  mocks.actor.mockResolvedValue({ actor: { client: { from: () => query }, organizationId: "org" } });
  mocks.facility.mockResolvedValue({ data: { id, name: "Test facility" }, error: null });
  mocks.load.mockResolvedValue({ facilityId: id, people: [] });
});
describe("Workforce API", () => {
  it.each(["", "all", "------------------------------------"])("rejects invalid facility scope %s before querying", async (facilityId) => {
    const response = await GET(new Request(`https://example.test/api?facility_id=${facilityId}`));
    expect(response.status).toBe(400);
    expect(mocks.facility).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("retains current-actor denial before reading any records", async () => {
    mocks.actor.mockResolvedValue({ response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await GET(new Request(`https://example.test/api?facility_id=${id}`))).status).toBe(403);
    expect(mocks.facility).not.toHaveBeenCalled();
  });
  it("denies an inaccessible facility even for an allowed role", async () => {
    mocks.facility.mockResolvedValue({ data: null, error: null });
    expect((await GET(new Request(`https://example.test/api?facility_id=${id}`))).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("does not turn a source failure into empty successful records", async () => {
    mocks.load.mockRejectedValue(new Error("source failure"));
    const response = await GET(new Request(`https://example.test/api?facility_id=${id}`));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("people");
  });
  it("returns caller-scoped data privately without a shared cache", async () => {
    const response = await GET(new Request(`https://example.test/api?facility_id=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.actor).toHaveBeenCalledWith(expect.objectContaining({ allowedRoles: ["owner", "org_admin", "facility_admin", "manager"] }));
  });
});
