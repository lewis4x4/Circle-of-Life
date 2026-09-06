import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

const insert = vi.fn();
const sentinel = "relation public.collection_activities violates constraint private_activity_key";
let replayLookupFails = true;
const actor = {
  id: "actor",
  admin: {
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        insert: vi.fn((payload: unknown) => {
          insert(payload);
          return query;
        }),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: sentinel } }),
        maybeSingle: vi.fn().mockResolvedValue(
          table === "residents"
            ? { data: { id: "resident", organization_id: "org", facility_id: "facility" }, error: null }
            : { data: null, error: replayLookupFails ? { message: sentinel } : null },
        ),
      };
      return query;
    }),
  },
};

describe("collection activity error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replayLookupFails = true;
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  });

  it("does not expose a replay lookup error or attempt a second insert", async () => {
    const response = await POST(new Request("https://local.test/collection", {
      method: "POST",
      body: JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        resident_id: "resident",
        facility_id: "facility",
        activity_type: "call",
        activity_date: "2026-09-06",
        description: "Called payer",
      }),
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Saved activity could not be checked. Retry the request." });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(insert).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "admin.workflows.collection-activities.create",
      expect.objectContaining({ message: sentinel }),
      { action: "replay-lookup", activityId: "11111111-1111-4111-8111-111111111111", facilityId: "facility" },
    );
  });

  it("does not expose an insert error", async () => {
    replayLookupFails = false;
    const response = await POST(new Request("https://local.test/collection", {
      method: "POST",
      body: JSON.stringify({
        resident_id: "resident",
        facility_id: "facility",
        activity_type: "call",
        activity_date: "2026-09-06",
        description: "Called payer",
      }),
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to create collection activity" });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "admin.workflows.collection-activities.create",
      expect.objectContaining({ message: sentinel }),
      { action: "insert", activityId: undefined, facilityId: "facility" },
    );
  });
});
