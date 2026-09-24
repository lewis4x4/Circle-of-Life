import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { POST } from "./route";

let addressCounter = 0;

function request(body: unknown, address?: string): Request {
  addressCounter += 1;
  return new Request("https://haven.example/api/kiosk/timeclock/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nf-client-connection-ip": address ?? `10.0.0.${addressCounter}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/kiosk/timeclock/enroll", () => {
  it("exchanges a valid code for a device token and facility name", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: true, device_id: "d1", token: "tok", facility_id: "f1", facility_name: "Synthetic facility" }, error: null });
    const response = await POST(request({ code: "abcd2345", label: "Front desk" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ device_id: "d1", token: "tok", facility_id: "f1", facility_name: "Synthetic facility" });
    expect(mock.rpc).toHaveBeenCalledWith("timeclock_enroll_device", { p_code: "ABCD2345", p_label: "Front desk", p_device_kind: "kiosk" });
  });

  it("returns 401 code_invalid for a used or expired code", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: false, error: "code_invalid" }, error: null });
    const response = await POST(request({ code: "ABCD2345", label: "Front desk" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "code_invalid" });
  });

  it("rejects a malformed code without a database call", async () => {
    expect((await POST(request({ code: "abc", label: "x" }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("throttles an address after ten failed codes", async () => {
    mock.rpc.mockResolvedValue({ data: { ok: false, error: "code_invalid" }, error: null });
    for (let i = 0; i < 10; i += 1) {
      expect((await POST(request({ code: "ABCD2345", label: "x" }, "203.0.113.9"))).status).toBe(401);
    }
    const throttled = await POST(request({ code: "ABCD2345", label: "x" }, "203.0.113.9"));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBeTruthy();
    expect(throttled.headers.get("Cache-Control")).toBe("no-store");
    expect(mock.rpc).toHaveBeenCalledTimes(10);
  });
});
