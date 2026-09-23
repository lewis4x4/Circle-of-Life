import { describe, expect, it } from "vitest";

import { fakeSupabase } from "@/test-utils/fake-supabase";

import { countSameDayAssessments } from "./record-assessment";

const args = { residentId: "r1", assessmentType: "morse_fall", assessmentDate: "2026-09-23" };

describe("countSameDayAssessments (COL-649)", () => {
  it("throws on a missing count so the duplicate check reads as unknown, not 'none'", async () => {
    const { client } = fakeSupabase(() => ({ count: null }));
    await expect(countSameDayAssessments(client, args)).rejects.toThrow(/count unavailable/);
  });

  it("returns a real count", async () => {
    const { client } = fakeSupabase(() => ({ count: 1 }));
    await expect(countSameDayAssessments(client, args)).resolves.toBe(1);
  });
});
