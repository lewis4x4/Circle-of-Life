import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminIncidentsPageClient } from "@/components/incidents/AdminIncidentsPageClient";
import type { IncidentRow } from "@/lib/incidents/load-incidents";

const HOMEWOOD = "00000000-0000-4000-8000-0000000000a1";

const facilityMock = vi.hoisted(() => ({ selectedFacilityId: null as string | null }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: facilityMock.selectedFacilityId }),
}));

vi.mock("@/components/incidents/IncidentsTodayStrip", () => ({
  IncidentsTodayStrip: () => null,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@/lib/incidents/load-incidents", () => ({
  fetchIncidentsFromSupabase: fetchMock,
}));

function row(incidentNumber: string): IncidentRow {
  return {
    id: incidentNumber,
    incidentNumber,
    residentName: "Resident",
    category: "fall",
    severity: "level_2",
    status: "new",
    reportedAt: "Sep 15, 2026",
    reportedBy: "Staff",
    followupDueStr: "",
    followupDueMs: 0,
    openFollowups: 0,
    overdueFollowups: 0,
    unassignedFollowups: 0,
    escalatedFollowups: 0,
    criticalFollowups: 0,
    openObligations: 0,
    rootCausePending: false,
    carePlanPending: false,
    ahcaReportable: false,
    ahcaReported: false,
    careEventId: null,
    careEventStatus: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("AdminIncidentsPageClient facility scope", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    facilityMock.selectedFacilityId = null;
  });

  it("never paints an all-facilities result that resolves after the selected facility's", async () => {
    const allFacilities = deferred<IncidentRow[]>();
    const homewood = deferred<IncidentRow[]>();
    fetchMock.mockImplementation((facilityId: string | null) =>
      facilityId === HOMEWOOD ? homewood.promise : allFacilities.promise,
    );

    // Server rendered with an error, so the first client load runs for "All facilities".
    const { rerender } = render(
      <AdminIncidentsPageClient initialRows={[]} initialError="x" initialFacilityId={null} />,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(null);

    facilityMock.selectedFacilityId = HOMEWOOD;
    rerender(<AdminIncidentsPageClient initialRows={[]} initialError="x" initialFacilityId={null} />);
    expect(fetchMock).toHaveBeenLastCalledWith(HOMEWOOD);

    await act(async () => {
      homewood.resolve([row("HOM-2026-0002")]);
    });
    await waitFor(() => expect(screen.getByText("HOM-2026-0002")).toBeTruthy());

    await act(async () => {
      allFacilities.resolve([row("HOM-2026-0002"), row("GRA-2026-0001")]);
    });

    expect(screen.queryByText("GRA-2026-0001")).toBeNull();
    expect(screen.getByText("HOM-2026-0002")).toBeTruthy();
  });
});
