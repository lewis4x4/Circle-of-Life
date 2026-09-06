import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";
import { requireAdminApiActor } from "@/lib/admin/api-auth";

const rpc = vi.fn();
const actor = { id: "actor", admin: { rpc } };
const requestBody = {
  ticketId: "11111111-1111-4111-8111-111111111111",
  residentId: "22222222-2222-4222-8222-222222222222",
  foodLevel: 6,
  liquidLevel: 0,
  allergensConfirmed: true,
};

describe("tray pass error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
  });

  it("logs but does not return unexpected RPC details", async () => {
    const sentinel = "relation public.tray_tickets violates constraint private_diet_snapshot_check";
    rpc.mockResolvedValue({ data: null, error: { message: sentinel } });

    const response = await POST(new Request("https://local.test/tray", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Tray verification could not be saved. Refresh the tray and retry." });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith(
      "dietary.tray-pass.create",
      expect.objectContaining({ message: sentinel }),
      { action: "rpc", ticketId: requestBody.ticketId },
    );
  });

  it("preserves a reviewed dietary safety instruction", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "No current active diet order. Contact the nurse." } });

    const response = await POST(new Request("https://local.test/tray", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }));

    expect(await response.json()).toEqual({ error: "No current active diet order. Contact the nurse." });
  });
});
