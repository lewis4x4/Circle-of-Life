import { beforeEach, describe, expect, it, vi } from "vitest";

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

function createCountQueryMock() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    then: (resolve: (value: { count: number }) => void) => {
      resolve({ count: 0 });
      return Promise.resolve({ count: 0 });
    },
  };
  return chain;
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
