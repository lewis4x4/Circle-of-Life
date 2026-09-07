import { describe, expect, it, vi } from "vitest";
import { LifecycleRequestClient } from "./lifecycle-request";

describe("lifecycle request recovery", () => {
  it("reuses the same exact operation after a lost response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = new LifecycleRequestClient(vi.fn(), fetcher);
    const request = { method: "POST", body: JSON.stringify({ facilities: [{ facility_id: "new" }] }) };
    await expect(client.request("/reactivate", request)).rejects.toThrow("network lost");
    const key = client.pending?.key;
    await client.request("/reactivate", request);
    expect(fetcher.mock.calls[0][1]).toEqual(fetcher.mock.calls[1][1]);
    expect(key).toBeTruthy();
    expect(client.pending).toBeNull();
  });
  it("retains 202 payload and prevents another operation from replacing it", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const client = new LifecycleRequestClient(vi.fn(), fetcher);
    await client.request("/user", { method: "PATCH", body: '{"app_role":"nurse"}' });
    await expect(client.request("/user", { method: "PATCH", body: '{"app_role":"caregiver"}' })).rejects.toThrow("pending");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.pending?.body).toContain("nurse");
  });
  it("permits correcting a definitively rejected payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 422 }));
    const client = new LifecycleRequestClient(vi.fn(), fetcher);
    await client.request("/reactivate", { method: "POST", body: "{}" });
    expect(client.pending).toBeNull();
  });
  it("requires explicit review of a terminal job before issuing a replacement", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ sync_status: "action_required" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({}));
    const client = new LifecycleRequestClient(vi.fn(), fetcher);
    await expect(client.request("/user", { method: "PATCH", body: "old" })).rejects.toThrow("review");
    const oldKey = client.pending?.key;
    expect(client.pending?.terminal).toBe(true);
    await expect(client.request("/user", { method: "PATCH", body: "new" })).rejects.toThrow("Review");
    client.acknowledgeTerminal();
    await client.request("/user", { method: "PATCH", body: "new" });
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("Idempotency-Key")).not.toBe(oldKey);
  });

});
