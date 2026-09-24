import { describe, expect, it } from "vitest";

import { fakeSupabase } from "@/test-utils/fake-supabase";

import { fetchCaregiverShiftBrief } from "./shift-brief";

const ctx = {
  facilityId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  timeZone: "America/New_York",
} as never;

describe("fetchCaregiverShiftBrief head counts (COL-649)", () => {
  it("fails the read instead of reporting census 0 when the count is missing", async () => {
    const { client } = fakeSupabase((call) => (call.head ? { count: null } : { data: [] }));
    await expect(fetchCaregiverShiftBrief(client, ctx)).rejects.toThrow(/count unavailable/);
  });

  it("keeps real counts, including a real zero", async () => {
    const { client } = fakeSupabase((call) => (call.head ? { count: call.table === "residents" ? 12 : 0 } : { data: [] }));
    const brief = await fetchCaregiverShiftBrief(client, ctx);
    expect(brief.census).toBe(12);
    expect(brief.openConditionCount).toBe(0);
  });
});
