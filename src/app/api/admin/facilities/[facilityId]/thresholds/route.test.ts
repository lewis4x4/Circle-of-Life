import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));

import { PUT } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

type FacilityRow = { id: string; organization_id: string } | null;

class MockQuery {
  constructor(
    private readonly table: string,
    private readonly state: {
      facility: FacilityRow;
      legacyPrimitiveCalls: string[];
    },
  ) {}

  select(columns?: string) {
    if (this.table === "facility_operational_thresholds" && columns?.includes("id")) {
      this.state.legacyPrimitiveCalls.push("select:id");
    }
    return this;
  }

  eq() {
    return this;
  }

  is() {
    return this;
  }

  maybeSingle() {
    if (this.table === "facilities") {
      return Promise.resolve({ data: this.state.facility, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  update() {
    this.state.legacyPrimitiveCalls.push("update");
    return this;
  }

  insert() {
    this.state.legacyPrimitiveCalls.push("insert");
    return this;
  }

  single() {
    return Promise.resolve({ data: null, error: null });
  }
}

describe("PUT /api/admin/facilities/[facilityId]/thresholds", () => {
  const facilityId = "11111111-1111-1111-1111-111111111111";
  const organizationId = "22222222-2222-2222-2222-222222222222";
  const actorId = "33333333-3333-3333-3333-333333333333";

  const validPayload = [
    {
      threshold_type: "occupancy_low_pct",
      yellow_threshold: 80,
      red_threshold: 70,
      notify_roles: ["owner", "org_admin"],
      enabled: true,
      alert_frequency: "daily_until_resolved",
    },
  ];

  let facility: FacilityRow;
  let legacyPrimitiveCalls: string[];
  let rpcMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    facility = { id: facilityId, organization_id: organizationId };
    legacyPrimitiveCalls = [];
    rpcMock = vi.fn();

    const admin = {
      from: (table: string) => new MockQuery(table, { facility, legacyPrimitiveCalls }),
      rpc: rpcMock,
    };

    vi.mocked(requireAdminApiActor).mockResolvedValue({
      actor: {
        id: actorId,
        organization_id: organizationId,
        admin,
      },
    } as never);

    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  });

  it("saves valid thresholds with one RPC call and returns { data }", async () => {
    const rpcData = [{ id: "row-1", threshold_type: "occupancy_low_pct" }];
    rpcMock.mockResolvedValue({ data: rpcData, error: null });

    const request = new Request("http://localhost/api/admin/facilities/x/thresholds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });

    const response = await PUT(request as never, {
      params: Promise.resolve({ facilityId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: rpcData });
    expect(requireAdminApiActor).toHaveBeenCalledWith({ allowedRoles: ["owner", "org_admin"] });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("upsert_facility_operational_thresholds", {
      p_facility_id: facilityId,
      p_organization_id: organizationId,
      p_actor_id: actorId,
      p_thresholds: validPayload,
    });
    expect(legacyPrimitiveCalls).toEqual([]);
  });

  it("returns 404 and does not write when facility is inaccessible", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(false);

    const request = new Request("http://localhost/api/admin/facilities/x/thresholds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });

    const response = await PUT(request as never, {
      params: Promise.resolve({ facilityId }),
    });

    expect(response.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(legacyPrimitiveCalls).toEqual([]);
  });

  it("returns 400 on invalid JSON", async () => {
    const request = new Request("http://localhost/api/admin/facilities/x/thresholds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });

    const response = await PUT(request as never, {
      params: Promise.resolve({ facilityId }),
    });

    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(legacyPrimitiveCalls).toEqual([]);
  });

  it("returns 422 on validation error", async () => {
    const request = new Request("http://localhost/api/admin/facilities/x/thresholds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ threshold_type: "occupancy_low_pct" }]),
    });

    const response = await PUT(request as never, {
      params: Promise.resolve({ facilityId }),
    });

    expect(response.status).toBe(422);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(legacyPrimitiveCalls).toEqual([]);
  });

  it("returns 500 with top-level error when RPC fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const request = new Request("http://localhost/api/admin/facilities/x/thresholds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });

    const response = await PUT(request as never, {
      params: Promise.resolve({ facilityId }),
    });

    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.error).toBe("Failed to save thresholds");
    expect(payload).not.toHaveProperty("data");
    expect(legacyPrimitiveCalls).toEqual([]);
  });
});
