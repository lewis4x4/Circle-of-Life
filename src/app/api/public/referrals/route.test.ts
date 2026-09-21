// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { POST } from "./route";

const { rpc, logError } = vi.hoisted(() => ({ rpc: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError }));
const payload = { kind: "inquiry", requestKey: "11111111-1111-4111-8111-111111111111", facility: "homewood", name: "Test Family", phone: "3865550199", email: "test@example.invalid", message: "Please call about availability." };
function request(body: unknown = payload, headers: Record<string, string> = {}) {
  return new Request("https://haven.test/api/public/referrals", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-server-only-secret"); rpc.mockResolvedValue({ data: "22222222-2222-4222-8222-222222222222", error: null }); });
afterEach(() => vi.unstubAllEnvs());

describe("public referral receipt", () => {
  it("returns only a receipt after the canonical server-side intake commits", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("public_referral_intake", expect.objectContaining({ p_facility_id: "00000000-0000-0000-0002-000000000003", p_request_key: payload.requestKey, p_kind: "inquiry", p_notes: payload.message }));
  });
  it.each([{ organization_id: "forged" }, { facility: "unknown" }, { name: " " }, { phone: "bad" }, { email: "bad" }, { requestKey: "bad" }, { message: "x".repeat(4001) }])("rejects invalid or authority-bearing input: %j", async (change) => {
    expect((await POST(request({ ...payload, ...change }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and oversized requests", async () => {
    expect((await POST(request(payload, { origin: "https://other.test" }))).status).toBe(403);
    expect((await POST(request(payload, { "content-length": "17000" }))).status).toBe(413);
    expect((await POST(request({ ...payload, message: "x".repeat(17000) })))).toMatchObject({ status: 413 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["23505", 409], ["XX000", 503]])("does not claim receipt on database failure %s", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "Sensitive database details" } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("Sensitive");
  });
  it("does not claim receipt on a missing commit result or a lost response", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockRejectedValueOnce(new Error("network"));
    expect((await POST(request())).status).toBe(503);
    expect((await POST(request())).status).toBe(503);
  });
  it("preserves the same request key on retry", async () => {
    await POST(request()); await POST(request());
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
  it("uses Netlify's trusted address before forwarded headers and sends only its HMAC", async () => {
    await POST(request(payload, { "x-nf-client-connection-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.99, 192.0.2.100" }));
    const fingerprint = createHmac("sha256", "synthetic-server-only-secret").update("haven-public-referral-client-v1\0").update("192.0.2.1").digest("hex");
    expect(rpc.mock.calls[0][1].p_client_fingerprint).toBe(fingerprint);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("192.0.2.");
    expect(logError).not.toHaveBeenCalled();
  });
  it("ignores caller-controlled forwarded addresses and uses a shared bucket without Netlify's trusted header", async () => {
    await POST(request(payload, { "x-forwarded-for": "192.0.2.2, 192.0.2.3" }));
    await POST(request(payload, { "x-forwarded-for": "198.51.100.9" }));
    await POST(request()); await POST(request());
    expect(rpc.mock.calls[0][1].p_client_fingerprint).toBe(rpc.mock.calls[1][1].p_client_fingerprint);
    expect(rpc.mock.calls[2][1].p_client_fingerprint).toBe(rpc.mock.calls[3][1].p_client_fingerprint);
    expect(rpc.mock.calls[0][1].p_client_fingerprint).toBe(rpc.mock.calls[2][1].p_client_fingerprint);
  });
  it("returns retry guidance for the database-enforced client limit", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0429" } });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(await response.json()).not.toHaveProperty("received");
    expect(logError).not.toHaveBeenCalled();
  });
  it("reports unexpected failures without passing request details or raw errors to the logger", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: payload.email } }).mockRejectedValueOnce(new Error(payload.phone));
    await POST(request()); await POST(request());
    expect(logError).toHaveBeenCalledTimes(2);
    for (const call of logError.mock.calls) {
      expect(call[1].message).not.toContain(payload.email);
      expect(call[1].message).not.toContain(payload.phone);
      expect(JSON.stringify(call)).not.toContain(payload.name);
    }
  });
  it("fails closed without the server HMAC secret", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await POST(request())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);
  });
  it("persists tour preferences as a request, without claiming scheduling or messaging", async () => {
    const common = { requestKey: payload.requestKey, facility: payload.facility, name: payload.name, phone: payload.phone, email: payload.email };
    const response = await POST(request({ ...common, kind: "tour", tourDate: "2026-10-03", tourTime: "11:30 AM (Lunch with Residents Included)", lunchOption: "yes-2" }));
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0][1].p_notes).toContain("staff confirmation");
    expect(rpc.mock.calls[0][1].p_notes).toContain("2026-10-03");
    expect(rpc.mock.calls[0][1].p_notes).toContain("yes-2");
  });
});
