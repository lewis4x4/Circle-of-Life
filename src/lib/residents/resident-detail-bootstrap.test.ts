import { beforeEach, describe, expect, it, vi } from "vitest";

const bootstrapMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadResidentOverviewDetail: vi.fn(),
}));

vi.mock("react", () => ({
  cache:
    <Args extends unknown[], Result>(load: (...args: Args) => Result) => {
      const values = new Map<string, Result>();
      return (...args: Args): Result => {
        const key = JSON.stringify(args);
        if (!values.has(key)) values.set(key, load(...args));
        return values.get(key) as Result;
      };
    },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: bootstrapMocks.createClient,
}));

vi.mock("@/lib/residents/resident-detail-overview-load", () => ({
  loadResidentOverviewDetail: bootstrapMocks.loadResidentOverviewDetail,
}));

import { loadResidentDetailBootstrap } from "./resident-detail-bootstrap";

describe("loadResidentDetailBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates the layout and overview projection within one render request", async () => {
    const supabase = { from: vi.fn() };
    const detail = { id: "resident-1", fullName: "Mary Johnson" };
    bootstrapMocks.createClient.mockResolvedValue(supabase);
    bootstrapMocks.loadResidentOverviewDetail.mockResolvedValue(detail);

    const first = loadResidentDetailBootstrap("resident-1", "facility-1");
    const second = loadResidentDetailBootstrap("resident-1", "facility-1");

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({
      initialDetail: detail,
      initialError: null,
      initialFacilityId: "facility-1",
    });
    expect(bootstrapMocks.createClient).toHaveBeenCalledTimes(1);
    expect(bootstrapMocks.loadResidentOverviewDetail).toHaveBeenCalledTimes(1);
  });
});
