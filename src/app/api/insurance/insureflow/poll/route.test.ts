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

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL };
  process.env.INSUREFLOW_POLL_SECRET = SECRET;
  process.env.INSUREFLOW_FEED_ORIGIN = "https://lrqajzwcmdwahnjyidgv.supabase.co";
  process.env.INSUREFLOW_FEED_TOKEN = `hvn_${"a".repeat(64)}`;
  process.env.INSUREFLOW_CONNECTIONS = JSON.stringify([
    {
      connection_id: "9f3c1d80-0000-4000-8000-000000000002",
      organization_id: "00000000-0000-0000-0000-000000000001",
      provider_instance: "live:insureflow-col",
      integration_id: "7c9e1a20-0000-4000-8000-000000000001",
    },
  ]);
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

  it("refuses to poll when the connection list is missing or malformed", async () => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    for (const bad of [undefined, "", "not json", "{}", '[{"connection_id":"nope"}]']) {
      if (bad === undefined) delete process.env.INSUREFLOW_CONNECTIONS;
      else process.env.INSUREFLOW_CONNECTIONS = bad;
      const response = await POST(request({ "x-cron-secret": SECRET }));
      expect(response.status).toBe(503);
    }
  });

  // The projection is deliberately unreadable by service_role, so the route must
  // never try to enumerate connections from the table.
  it("never reads the connections table", async () => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } });
    const from = vi.fn(() => {
      throw new Error("route must not query insureflow_receiver_connections");
    });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from, rpc } as never);

    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(200);
    expect(from).not.toHaveBeenCalled();
    // It reached the receiver, which is the only permitted path.
    expect(rpc).toHaveBeenCalledWith("insureflow_receiver_service", expect.objectContaining({ p_action: "claim" }));
  });

  it("rejects a provider instance that is not a live one", async () => {
    process.env.INSUREFLOW_LIVE_TRANSPORT_ENABLED = "true";
    process.env.INSUREFLOW_CONNECTIONS = JSON.stringify([
      {
        connection_id: "9f3c1d80-0000-4000-8000-000000000002",
        organization_id: "00000000-0000-0000-0000-000000000001",
        provider_instance: "synthetic:local",
        integration_id: "7c9e1a20-0000-4000-8000-000000000001",
      },
    ]);
    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(503);
  });
});
