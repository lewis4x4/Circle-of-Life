import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/client";
import { fetchResidentAssuranceCommandBrief } from "@/lib/resident-assurance/command-center-brief";

import { NURSE_WATCHLIST_NO_ROOM_COPY } from "./medication-brief-display-copy";
import { fetchNurseMedicationBrief } from "./medication-brief";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/resident-assurance/command-center-brief", () => ({
  fetchResidentAssuranceCommandBrief: vi.fn(),
}));

const PLACEHOLDER_RESIDENT_ID = "00000000-0000-4000-8000-000000000001";
const PLACEHOLDER_RESIDENT_NAME = "Resident A";

type CountResult = { count: number | null; error: { message: string } | null };

function createCountQueryMock(result: CountResult = { count: 0, error: null }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    then: (resolve: (value: CountResult) => void) => {
      resolve(result);
      return Promise.resolve(result);
    },
  };
  return chain;
}

const CONTROLLED_QUERY_INDEX = 4;
const FACILITY_ID = "00000000-0000-4000-8000-0000000000f1";

function mockQueries(results: Partial<Record<number, CountResult>> = {}) {
  const queries = Array.from({ length: 7 }, (_, index) => createCountQueryMock(results[index]));
  const tables: string[] = [];
  let queryIndex = 0;
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn().mockImplementation((table: string) => {
      tables.push(table);
      return queries[queryIndex++];
    }),
  } as never);
  return { queries, tables };
}

describe("fetchNurseMedicationBrief watchlistResidents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn().mockReturnValue(createCountQueryMock()),
    } as never);
    vi.mocked(fetchResidentAssuranceCommandBrief).mockResolvedValue({
      activeWatches: 0,
      pendingWatchApprovals: 0,
      openEscalations: 0,
      openIntegrityFlags: 0,
      criticalSafetyResidents: 0,
      highOrCriticalSafetyResidents: 1,
      highRiskResidents: [
        {
          id: PLACEHOLDER_RESIDENT_ID,
          name: PLACEHOLDER_RESIDENT_NAME,
          riskTier: "high",
          score: 42,
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("anchors today's eMAR queries to Eastern midnight after 8pm ET", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-20T20:05:00-04:00"));
    const queries = Array.from({ length: 7 }, () => createCountQueryMock());
    let queryIndex = 0;
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => queries[queryIndex++]),
    } as never);

    await fetchNurseMedicationBrief("00000000-0000-4000-8000-0000000000f1");

    for (const index of [1, 2, 5]) {
      expect(queries[index]?.gte).toHaveBeenCalledWith(
        "scheduled_time",
        "2026-08-20T04:00:00.000Z",
      );
    }
    expect(queries[6]?.gte).toHaveBeenCalledWith(
      "scheduled_time",
      "2026-08-20T00:05:00.000Z",
    );
  });

  it("names the missing room gap on watchlist rows without changing name or reason", async () => {
    const brief = await fetchNurseMedicationBrief("00000000-0000-4000-8000-0000000000f1");

    expect(brief.watchlistResidents).toEqual([
      {
        id: PLACEHOLDER_RESIDENT_ID,
        name: PLACEHOLDER_RESIDENT_NAME,
        room: NURSE_WATCHLIST_NO_ROOM_COPY,
        reason: "high risk · score 42",
      },
    ]);
    expect(brief.watchlistResidents[0]?.room).not.toBe("—");
  });
});

describe("fetchNurseMedicationBrief controlled substance discrepancies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchResidentAssuranceCommandBrief).mockResolvedValue({
      activeWatches: 0,
      pendingWatchApprovals: 0,
      openEscalations: 0,
      openIntegrityFlags: 0,
      criticalSafetyResidents: 0,
      highOrCriticalSafetyResidents: 0,
      highRiskResidents: [],
    });
  });

  it("filters open discrepancies on the real columns, scoped to the facility", async () => {
    const { queries, tables } = mockQueries({ [CONTROLLED_QUERY_INDEX]: { count: 2, error: null } });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    const controlled = queries[CONTROLLED_QUERY_INDEX]!;
    expect(tables[CONTROLLED_QUERY_INDEX]).toBe("controlled_substance_counts");
    expect(controlled.eq).toHaveBeenCalledWith("facility_id", FACILITY_ID);
    expect(controlled.neq).toHaveBeenCalledWith("discrepancy", 0);
    expect(controlled.not).toHaveBeenCalledWith("discrepancy_resolved", "is", true);
    expect(controlled.is).toHaveBeenCalledWith("deleted_at", null);
    expect(controlled.eq).not.toHaveBeenCalledWith("has_discrepancy", expect.anything());
    expect(brief.controlledDiscrepancies).toBe(2);
  });

  it("returns null, not 0, when the controlled count query errors", async () => {
    mockQueries({
      [CONTROLLED_QUERY_INDEX]: { count: null, error: { message: "column does not exist" } },
    });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    expect(brief.controlledDiscrepancies).toBeNull();
    expect(brief.activeMedications).toBe(0);
  });

  it("returns null for med errors and eMAR compliance when their queries error", async () => {
    const failed = { count: null, error: { message: "boom" } };
    mockQueries({ 1: failed, 3: failed });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    expect(brief.emarCompliancePct).toBeNull();
    expect(brief.medErrors7d).toBeNull();
  });
});
