import { describe, expect, it, vi } from "vitest";
import { ensureUserFacilityAccessGrants } from "./ensure-user-facility-access";

function mockAdmin(sequence: Array<() => unknown>) {
  let step = 0;
  const from = vi.fn(() => {
    const handler = sequence[step++];
    if (!handler) throw new Error(`unexpected from() call ${step}`);
    return handler();
  });
  return { from } as never;
}

const grant = {
  user_id: "user-1",
  facility_id: "fac-1",
  organization_id: "org-1",
  is_primary: true,
  granted_by: "admin-1",
};

describe("ensureUserFacilityAccessGrants", () => {
  it("updates an active duplicate grant instead of inserting", async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const admin = mockAdmin([
      () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "row-1", revoked_at: null, is_primary: false }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
      () => ({ update }),
    ]);

    const { error } = await ensureUserFacilityAccessGrants(admin, [grant]);
    expect(error).toBeNull();
    expect(update).toHaveBeenCalled();
  });

  it("reactivates a revoked grant", async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const admin = mockAdmin([
      () => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "row-revoked", revoked_at: "2026-01-01T00:00:00Z", is_primary: false }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
      () => ({ update }),
    ]);

    const { error } = await ensureUserFacilityAccessGrants(admin, [grant]);
    expect(error).toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: null, is_primary: true }),
    );
  });
});
