import { describe, expect, it, vi } from "vitest";
import {
  ensureUserFacilityAccessGrants,
  rollbackUserFacilityAccessGrants,
} from "./ensure-user-facility-access";
import { createUserSchema } from "@/lib/validation/user-management";

function mockAdmin(sequence: Array<() => unknown>) {
  let step = 0;
  const from = vi.fn(() => {
    const handler = sequence[step++];
    if (!handler) throw new Error(`unexpected from() call ${step}`);
    return handler();
  });
  return { from } as never;
}

function lookupReturning(rows: unknown[]) {
  return () => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  });
}

const grant = {
  user_id: "user-1",
  facility_id: "fac-1",
  organization_id: "org-1",
  is_primary: true,
  granted_by: "admin-1",
};

describe("ensureUserFacilityAccessGrants", () => {
  it("is a no-op when an identical active grant already exists", async () => {
    // Charlene's case: an active Homewood grant from 2026-08-19 that already matches
    // what the create request is asking for. No write may be issued.
    const admin = mockAdmin([
      lookupReturning([
        {
          id: "row-aug",
          revoked_at: null,
          is_primary: true,
          granted_by: "admin-1",
          organization_id: "org-1",
        },
      ]),
    ]);

    const { error, applied } = await ensureUserFacilityAccessGrants(admin, [grant]);

    expect(error).toBeNull();
    expect(applied).toEqual([
      {
        facility_id: "fac-1",
        row_id: "row-aug",
        outcome: "unchanged",
        previous: { is_primary: true, granted_by: "admin-1", organization_id: "org-1" },
      },
    ]);
    // Exactly one from() call — the lookup. No update, no insert.
    expect((admin as unknown as { from: ReturnType<typeof vi.fn> }).from).toHaveBeenCalledTimes(1);
  });

  it("updates an active duplicate grant instead of inserting", async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const admin = mockAdmin([
      lookupReturning([
        {
          id: "row-1",
          revoked_at: null,
          is_primary: false,
          granted_by: "someone-else",
          organization_id: "org-1",
        },
      ]),
      () => ({ update }),
    ]);

    const { error, applied } = await ensureUserFacilityAccessGrants(admin, [grant]);
    expect(error).toBeNull();
    expect(update).toHaveBeenCalled();
    expect(applied[0].outcome).toBe("updated");
    expect(applied[0].previous).toEqual({
      is_primary: false,
      granted_by: "someone-else",
      organization_id: "org-1",
    });
  });

  it("reactivates a revoked grant", async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const admin = mockAdmin([
      lookupReturning([
        {
          id: "row-revoked",
          revoked_at: "2026-01-01T00:00:00Z",
          is_primary: false,
          granted_by: null,
          organization_id: "org-1",
        },
      ]),
      () => ({ update }),
    ]);

    const { error, applied } = await ensureUserFacilityAccessGrants(admin, [grant]);
    expect(error).toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: null, is_primary: true }),
    );
    expect(applied[0].outcome).toBe("reactivated");
  });

  it("inserts and reports the new row id when no grant exists", async () => {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "row-new" }, error: null }),
      }),
    });
    const admin = mockAdmin([lookupReturning([]), () => ({ insert })]);

    const { error, applied } = await ensureUserFacilityAccessGrants(admin, [grant]);
    expect(error).toBeNull();
    expect(applied).toEqual([
      { facility_id: "fac-1", row_id: "row-new", outcome: "inserted", previous: null },
    ]);
  });

  it("returns the grants applied so far when a later grant fails", async () => {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "row-new" }, error: null }),
      }),
    });
    const admin = mockAdmin([
      lookupReturning([]),
      () => ({ insert }),
      () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
              }),
            }),
          }),
        }),
      }),
    ]);

    const { error, applied } = await ensureUserFacilityAccessGrants(admin, [
      grant,
      { ...grant, facility_id: "fac-2", is_primary: false },
    ]);

    expect(error).toBe("boom");
    expect(applied).toHaveLength(1);
    expect(applied[0].outcome).toBe("inserted");
  });
});

describe("rollbackUserFacilityAccessGrants", () => {
  it("deletes inserted rows, re-revokes reactivated rows, and restores updated rows", async () => {
    const del = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const updateReactivated = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const updateRestored = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    // Rollback runs in reverse order: updated, then reactivated, then inserted.
    const admin = mockAdmin([
      () => ({ update: updateRestored }),
      () => ({ update: updateReactivated }),
      () => ({ delete: del }),
    ]);

    const { error } = await rollbackUserFacilityAccessGrants(admin, [
      { facility_id: "fac-1", row_id: "row-new", outcome: "inserted", previous: null },
      {
        facility_id: "fac-2",
        row_id: "row-revoked",
        outcome: "reactivated",
        previous: { is_primary: false, granted_by: null, organization_id: "org-1" },
      },
      {
        facility_id: "fac-3",
        row_id: "row-existing",
        outcome: "updated",
        previous: { is_primary: false, granted_by: "someone-else", organization_id: "org-1" },
      },
    ]);

    expect(error).toBeNull();
    expect(del).toHaveBeenCalled();
    expect(updateReactivated).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: expect.any(String) }),
    );
    expect(updateRestored).toHaveBeenCalledWith({
      is_primary: false,
      granted_by: "someone-else",
      organization_id: "org-1",
    });
  });

  it("never touches a grant that already existed unchanged", async () => {
    // The Charlene guarantee: rolling back a failed create must not revoke or delete
    // the grant she already had.
    const admin = mockAdmin([]);

    const { error } = await rollbackUserFacilityAccessGrants(admin, [
      {
        facility_id: "fac-1",
        row_id: "row-aug",
        outcome: "unchanged",
        previous: { is_primary: true, granted_by: "admin-1", organization_id: "org-1" },
      },
    ]);

    expect(error).toBeNull();
    expect((admin as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});

describe("createUserSchema facility uniqueness", () => {
  const base = {
    email: "new@example.test",
    full_name: "New User",
    app_role: "housekeeper" as const,
    send_invite: true,
  };
  const facilityA = "20000000-0000-4000-8000-000000000002";
  const facilityB = "20000000-0000-4000-8000-000000000003";

  it("rejects the same facility listed twice", () => {
    const parsed = createUserSchema.safeParse({
      ...base,
      facilities: [
        { facility_id: facilityA, is_primary: true },
        { facility_id: facilityA, is_primary: false },
      ],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message === "Each facility may only be listed once")).toBe(
        true,
      );
    }
  });

  it("accepts distinct facilities", () => {
    const parsed = createUserSchema.safeParse({
      ...base,
      facilities: [
        { facility_id: facilityA, is_primary: true },
        { facility_id: facilityB, is_primary: false },
      ],
    });

    expect(parsed.success).toBe(true);
  });
});
