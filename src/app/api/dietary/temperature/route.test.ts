import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

const sentinel = "column private_temperature violates constraint haccp_logs_secret_check";
const insert = vi.fn();
const actor = {
  id: "actor",
  organization_id: "org",
  admin: {
    from: vi.fn(() => {
      const query = {
        insert: vi.fn((payload: unknown) => {
          insert(payload);
          return query;
        }),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: sentinel, code: "23514" } }),
      };
      return query;
    }),
  },
};

describe("dietary temperature error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  });

  it("logs but does not return an insert error", async () => {
    const response = await POST(new Request("https://local.test/temperature", {
      method: "POST",
      body: JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        facilityId: "22222222-2222-4222-8222-222222222222",
        item: "Soup",
        logType: "hot_hold",
        temperature: 145,
        minimum: 135,
        maximum: 165,
        correctiveAction: "",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Reading was not saved" });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "dietary.temperature.create",
      expect.objectContaining({ message: sentinel }),
      {
        action: "insert",
        receiptId: "11111111-1111-4111-8111-111111111111",
        facilityId: "22222222-2222-4222-8222-222222222222",
      },
    );
  });
});
