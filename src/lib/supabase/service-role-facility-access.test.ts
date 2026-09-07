import { describe, expect, it, vi } from "vitest";

import { serviceRoleUserHasFacilityAccess } from "./service-role-facility-access";

function single(data: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return query;
}

function client(rows: { profile: unknown; facility?: unknown; grant?: unknown }) {
  const queries = {
    user_profiles: single(rows.profile),
    facilities: single(rows.facility ?? null),
    user_facility_access: single(rows.grant ?? null),
  };
  return {
    client: {
      from: vi.fn((table: keyof typeof queries) => queries[table]),
    },
    queries,
  };
}

const args = { userId: "user-1", organizationId: "org-1", facilityId: "facility-1" };

describe("serviceRoleUserHasFacilityAccess", () => {
  it("does not auto-pass an owner whose current active profile is gone", async () => {
    const { client: admin } = client({ profile: null });

    await expect(serviceRoleUserHasFacilityAccess(admin as never, args)).resolves.toBe(false);
    expect(admin.from).toHaveBeenCalledTimes(1);
  });

  it("auto-passes a current owner only after reloading profile and facility", async () => {
    const { client: admin } = client({ profile: { app_role: "owner" }, facility: { id: "facility-1" } });

    await expect(serviceRoleUserHasFacilityAccess(admin as never, args)).resolves.toBe(true);
    expect(admin.from).toHaveBeenNthCalledWith(1, "user_profiles");
    expect(admin.from).toHaveBeenNthCalledWith(2, "facilities");
  });

  it("requires a current nonrevoked grant for a facility-scoped role", async () => {
    const { client: admin, queries } = client({
      profile: { app_role: "nurse" },
      facility: { id: "facility-1" },
      grant: null,
    });

    await expect(serviceRoleUserHasFacilityAccess(admin as never, args)).resolves.toBe(false);
    expect(queries.user_facility_access.is).toHaveBeenCalledWith("revoked_at", null);
  });
});
