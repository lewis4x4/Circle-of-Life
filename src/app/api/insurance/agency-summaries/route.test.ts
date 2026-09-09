import { beforeEach, describe, expect, it, vi } from "vitest";
import { agencySummaryFixture } from "@/components/insurance/test-support/agency-summary-fixture";
const mock = vi.hoisted(() => ({
  require: vi.fn(),
  revalidate: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
}));
vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mock.require,
  revalidateCurrentApiActor: mock.revalidate,
}));
import { GET } from "./route";
const actor = () => ({
  id: "actor",
  organizationId: "organization",
  client: { rpc: mock.rpc },
  admin: { rpc: mock.adminRpc },
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.require.mockResolvedValue({ actor: actor() });
  mock.revalidate.mockResolvedValue({ actor: actor() });
  mock.rpc.mockResolvedValue({ data: agencySummaryFixture(), error: null });
});
describe("agency summary read API", () => {
  it("uses only the current session read RPC and prohibits caching", async () => {
    const r = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(r.status).toBe(200);
    expect(mock.require).toHaveBeenCalledWith({
      allowedRoles: ["owner", "org_admin"],
      scope: "insurance.agency-summaries.read",
    });
    expect(mock.rpc).toHaveBeenCalledWith("insureflow_receiver_read", {
      p_action: "list",
      p_payload: {},
    });
    expect(mock.adminRpc).not.toHaveBeenCalled();
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await r.json()).read_at).toBeTruthy();
  });
  it("passes only explicit identifier filters", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const r = await GET(
      new Request(
        `https://haven.test/api/insurance/agency-summaries?connection_id=${id}`,
      ),
    );
    expect(r.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("insureflow_receiver_read", {
      p_action: "list",
      p_payload: { connection_id: id },
    });
  });
  it.each([
    "organization_id=foreign",
    "entity_id=not-an-id",
    "connection_id=11111111-1111-4111-8111-111111111111&connection_id=22222222-2222-4222-8222-222222222222",
  ])("rejects untrusted filters %s", async (query) => {
    const r = await GET(
      new Request(`https://haven.test/api/insurance/agency-summaries?${query}`),
    );
    expect(r.status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("stops before reading when the actor is not allowed", async () => {
    mock.require.mockResolvedValue({
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const r = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(r.status).toBe(403);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rechecks authority after the read and suppresses results after revocation", async () => {
    mock.revalidate.mockResolvedValue({
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const r = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain("IF-SYN-42");
  });
  it("rejects organization changes during the read", async () => {
    mock.revalidate.mockResolvedValue({
      actor: { ...actor(), organizationId: "other" },
    });
    const r = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain("IF-SYN-42");
  });
  it("returns only display-allowlisted fields, never raw quarantine or unknown source fields", async () => {
    const data = agencySummaryFixture();
    const augmented = {
      ...data,
      quarantine: { raw: "PRIVATE-ROOT" },
      connections: data.connections.map((c) => ({
        ...c,
        raw_state: "PRIVATE-CONNECTION",
        summaries: c.summaries.map((s) => ({
          ...s,
          hash: "PRIVATE-HASH",
          summary: { ...s.summary, commission: "PRIVATE-COMMISSION" },
        })),
      })),
    };
    mock.rpc.mockResolvedValue({ data: augmented, error: null });
    const r = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("PRIVATE");
    expect(text).toContain('"premium":90000.75');
    expect(text).toContain('"source_sequence":"9007199254740993"');
  });
  it.each(["expired", "disabled", "unavailable"])(
    "hides summaries from a %s connection even if the RPC returned rows",
    async (state) => {
      const data = agencySummaryFixture(state === "expired" ? -1000 : 60000);
      if (state === "disabled") data.connections[0].enabled = false;
      if (state === "unavailable") data.connections[0].state = "unavailable";
      mock.rpc.mockResolvedValue({ data, error: null });
      const r = await GET(
        new Request("https://haven.test/api/insurance/agency-summaries"),
      );
      expect(r.status).toBe(200);
      expect((await r.json()).connections[0].summaries).toEqual([]);
    },
  );
  it("fails closed if a projection tries to enable live data", async () => {
    mock.rpc.mockResolvedValue({
      data: { ...agencySummaryFixture(), live_connection_enabled: true },
      error: null,
    });
    const r = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("IF-SYN-42");
  });
  it("never reflects raw database or transport errors", async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "PRIVATE-RAW-STATE" },
    });
    const r = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("PRIVATE");
    mock.require.mockRejectedValue(new Error("PRIVATE-AUTH-ERROR"));
    const authFailure = await GET(
      new Request("https://haven.test/api/insurance/agency-summaries"),
    );
    expect(authFailure.status).toBe(503);
    expect(authFailure.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
