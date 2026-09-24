import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

let addressCounter = 0;

function request(body: unknown, address?: string): Request {
  addressCounter += 1;
  return new Request("https://haven.example/api/floor/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": address ?? `10.1.0.${addressCounter}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/floor/enroll", () => {
  it("enrolls a floor-kind code and returns the token, no-store", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, device_id: "d1", token: "tok", facility_id: "f1", facility_name: "Synthetic facility", device_kind: "floor" }, error: null });
    const response = await POST(request({ code: "abcd2345", label: "Floor 01" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ device_id: "d1", token: "tok", facility_id: "f1", facility_name: "Synthetic facility", device_label: "Floor 01" });
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_enroll_device", { p_code: "ABCD2345", p_label: "Floor 01", p_device_kind: "floor" });
  });

  it("answers code_invalid (401) for a kiosk code, a used code or an expired one", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: false, error: "code_invalid" }, error: null });
    const response = await POST(request({ code: "ABCD2345", label: "Floor 01" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "code_invalid" });
  });

  it("rejects a malformed code or label without a database call", async () => {
    expect((await POST(request({ code: "abc", label: "x" }))).status).toBe(400);
    expect((await POST(request({ code: "ABCD2345", label: "" }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("maps a database error to unavailable without its text", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "relation secret_table does not exist", code: "42P01" } });
    const response = await POST(request({ code: "ABCD2345", label: "Floor 01" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("throttles an address after ten failed codes", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: false, error: "code_invalid" }, error: null });
    for (let i = 0; i < 10; i += 1) {
      expect((await POST(request({ code: "ABCD2345", label: "x" }, "203.0.113.19"))).status).toBe(401);
    }
    const throttled = await POST(request({ code: "ABCD2345", label: "x" }, "203.0.113.19"));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBeTruthy();
    expect(mock.rpc).toHaveBeenCalledTimes(10);
  });
});
