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

type CountResult = {
  count: number | null;
  error: { message: string } | null;
  data?: Array<{ linked_incident_id: string | null }> | null;
};

function createCountQueryMock(result: CountResult = { count: 0, error: null, data: [] }) {
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

// from() order: 0 resident_medications, 1-2 emar, 3 medication_errors count,
// 4 medication_errors linked incidents, 5 controlled, 6-7 emar, then 8 incidents
// (issued after the linked ids resolve).
const MED_ERROR_REPORTS_INDEX = 3;
const MED_ERROR_LINKED_INDEX = 4;
const CONTROLLED_QUERY_INDEX = 5;
const MED_ERROR_INCIDENTS_INDEX = 8;
const QUERY_COUNT = 9;
const FACILITY_ID = "00000000-0000-4000-8000-0000000000f1";

function mockQueries(results: Partial<Record<number, CountResult>> = {}) {
  const queries = Array.from({ length: QUERY_COUNT }, (_, index) => createCountQueryMock(results[index]));
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
    const queries = Array.from({ length: QUERY_COUNT }, () => createCountQueryMock());
    let queryIndex = 0;
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => queries[queryIndex++]),
    } as never);

    await fetchNurseMedicationBrief("00000000-0000-4000-8000-0000000000f1");

    for (const index of [1, 2, 6]) {
      expect(queries[index]?.gte).toHaveBeenCalledWith(
        "scheduled_time",
        "2026-08-20T04:00:00.000Z",
      );
    }
    expect(queries[7]?.gte).toHaveBeenCalledWith(
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
    mockQueries({ 1: failed, [MED_ERROR_REPORTS_INDEX]: failed });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    expect(brief.emarCompliancePct).toBeNull();
    expect(brief.medErrors7d).toBeNull();
  });
});

describe("fetchNurseMedicationBrief med errors (7d)", () => {
  const LINKED_INCIDENT_ID = "00000000-0000-4000-8000-00000000c001";

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

  it("counts reports filed on the medication error form (medication_errors)", async () => {
    const { queries, tables } = mockQueries({
      [MED_ERROR_REPORTS_INDEX]: { count: 3, error: null },
      [MED_ERROR_INCIDENTS_INDEX]: { count: 0, error: null },
    });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    const reports = queries[MED_ERROR_REPORTS_INDEX]!;
    expect(tables[MED_ERROR_REPORTS_INDEX]).toBe("medication_errors");
    expect(reports.eq).toHaveBeenCalledWith("facility_id", FACILITY_ID);
    expect(reports.gte).toHaveBeenCalledWith("occurred_at", expect.any(String));
    expect(reports.is).toHaveBeenCalledWith("deleted_at", null);
    expect(brief.medErrors7d).toBe(3);
  });

  it("adds medication-error incidents that no report links, without double counting", async () => {
    const { queries, tables } = mockQueries({
      [MED_ERROR_REPORTS_INDEX]: { count: 2, error: null },
      [MED_ERROR_LINKED_INDEX]: {
        count: null,
        error: null,
        data: [{ linked_incident_id: LINKED_INCIDENT_ID }, { linked_incident_id: LINKED_INCIDENT_ID }],
      },
      [MED_ERROR_INCIDENTS_INDEX]: { count: 4, error: null },
    });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    const incidents = queries[MED_ERROR_INCIDENTS_INDEX]!;
    expect(tables[MED_ERROR_INCIDENTS_INDEX]).toBe("incidents");
    expect(incidents.eq).toHaveBeenCalledWith("category", "medication_error");
    expect(incidents.eq).toHaveBeenCalledWith("facility_id", FACILITY_ID);
    expect(incidents.not).toHaveBeenCalledWith("id", "in", `(${LINKED_INCIDENT_ID})`);
    expect(brief.medErrors7d).toBe(6);
  });

  it("returns null, not a partial count, when the incident read fails", async () => {
    mockQueries({
      [MED_ERROR_REPORTS_INDEX]: { count: 2, error: null },
      [MED_ERROR_INCIDENTS_INDEX]: { count: null, error: { message: "boom" } },
    });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    expect(brief.medErrors7d).toBeNull();
  });

  it("returns null when the linked-incident read fails", async () => {
    mockQueries({
      [MED_ERROR_REPORTS_INDEX]: { count: 2, error: null },
      [MED_ERROR_LINKED_INDEX]: { count: null, error: { message: "boom" }, data: null },
    });

    const brief = await fetchNurseMedicationBrief(FACILITY_ID);

    expect(brief.medErrors7d).toBeNull();
  });
});
