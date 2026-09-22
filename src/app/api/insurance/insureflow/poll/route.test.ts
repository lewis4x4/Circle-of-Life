// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { POST } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The scheduled poll endpoint. The interesting cases are the refusals: this
 * route holds the feed credential, so a wrong or absent secret must get nothing,
 * and the kill switch being off must be reported rather than treated as broken.
 */

const ORIGINAL = { ...process.env };
const SECRET = "poll-secret-value";

function request(headers: Record<string, string> = {}) {
  return new Request("https://haven.test/api/insurance/insureflow/poll", {
    method: "POST",
    headers,
  }) as never;
}

function clientReturning(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order = vi.fn(() => ({ limit }));
  const eq2 = vi.fn(() => ({ order }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { from, rpc, _calls: { select, eq1, eq2 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL };
  process.env.INSUREFLOW_POLL_SECRET = SECRET;
  process.env.INSUREFLOW_FEED_ORIGIN = "https://lrqajzwcmdwahnjyidgv.supabase.co";
  process.env.INSUREFLOW_FEED_TOKEN = `hvn_${"a".repeat(64)}`;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("POST /api/insurance/insureflow/poll", () => {
  it("refuses a request with no secret", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const response = await POST(request({ "x-cron-secret": "not-the-secret" }));
    expect(response.status).toBe(401);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  // A same-length wrong value is the case a naive === would still catch but a
  // length-only check would not; this pins the constant-time comparison.
  it("refuses a same-length wrong secret", async () => {
    const response = await POST(request({ "x-cron-secret": "x".repeat(SECRET.length) }));
    expect(response.status).toBe(401);
  });

  it("refuses everything when no secret is configured at all", async () => {
    delete process.env.INSUREFLOW_POLL_SECRET;
    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(401);
  });

  it("reports the kill switch being off as a state, not a failure", async () => {
    delete process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED;
    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "disabled", polled: 0, results: [] });
    // Nothing was read from the database while disabled.
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("will not poll without an origin and a credential", async () => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    delete process.env.INSUREFLOW_FEED_TOKEN;
    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(503);
  });

  it("asks only for enabled live connections", async () => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    const client = clientReturning([]);
    vi.mocked(createServiceRoleClient).mockReturnValue(client as never);

    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "polled", polled: 0, results: [] });
    expect(client._calls.eq1).toHaveBeenCalledWith("mode", "live");
    expect(client._calls.eq2).toHaveBeenCalledWith("enabled", true);
  });

  it("records a bad connection configuration against that connection instead of failing the run", async () => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    const client = clientReturning([
      {
        id: "c0000000-0000-4000-8000-000000000001",
        organization_id: "00000000-0000-0000-0000-000000000001",
        // Not a uuid, so the transport refuses to be built for it.
        source_integration_id: "not-a-uuid",
        provider_instance: "live:insureflow",
        mode: "live",
        enabled: true,
      },
    ]);
    vi.mocked(createServiceRoleClient).mockReturnValue(client as never);

    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { polled: number; results: Array<{ status: string }> };
    expect(body.polled).toBe(1);
    expect(body.results[0].status).toBe("invalid_configuration");
  });
});
