import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({
  requireOperationsActor: vi.fn(),
  actorCanAccessFacility: vi.fn(async () => true),
  listActorAccessibleFacilityIds: vi.fn(async () => []),
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { POST } from "./route";
import { requireOperationsActor } from "@/lib/operations/auth";

const insert = vi.fn();
const single = vi.fn();
const actor = {
  id: "actor",
  organizationId: "org",
  currentActor: {
    client: {
      from: vi.fn(() => {
        const query = {
          insert: (payload: unknown) => {
            insert(payload);
            return query;
          },
          select: vi.fn().mockReturnThis(),
          single,
        };
        return query;
      }),
    },
  },
};
const valid = {
  facility_id: "facility",
  name: "Generator weekly observation",
  description: "Observe the generator test run",
  category: "safety",
  cadence_type: "weekly",
};

describe("operation template creation keeps stable identity server-owned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
    single.mockResolvedValue({ data: { id: "created", ...valid, activity_id: "allocated" }, error: null });
  });

  it("drops caller-supplied id, activity_id, lineage and version from a root insert", async () => {
    const response = await POST(
      new Request("https://local.test/templates", {
        method: "POST",
        body: JSON.stringify({ ...valid, id: "chosen-id", activity_id: "chosen-activity", previous_version_id: "chosen-parent", version: 4 }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("activity_id");
    expect(payload.previous_version_id).toBeNull();
    expect(payload.version).toBe(1);
    expect(payload.organization_id).toBe("org");
    expect(payload.name).toBe(valid.name);
  });
});
