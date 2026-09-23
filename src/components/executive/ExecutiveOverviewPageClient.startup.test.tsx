import React from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ExecutiveOverviewPageClient } from "./ExecutiveOverviewPageClient";
import type { ExecutiveOverviewData } from "@/lib/executive/load-executive-overview";
import { EMPTY_PRESENCE_CENSUS } from "@/lib/executive/presence-census";

const mocks = vi.hoisted(() => ({ organizationId: "org-old", load: vi.fn(), client: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/executive",
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ organizationId: mocks.organizationId, appRole: "owner", loading: false }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("@/lib/executive/load-executive-overview", () => ({ loadExecutiveOverview: mocks.load }));
vi.mock("@/app/(admin)/executive/executive-hub-nav", () => ({ ExecutiveHubNav: () => null }));

it("discards an old organization's result after a newer request completes", async () => {
  let finishOld!: (data: ExecutiveOverviewData) => void;
  let finishNew!: (data: ExecutiveOverviewData) => void;
  mocks.load
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  const props = {
    initialMetrics: {}, initialAlerts: [], initialFacilities: [],
    initialAssuranceHeatMap: [], initialAssuranceTrends: [],
    initialPresenceCensus: EMPTY_PRESENCE_CENSUS,
    initialOccupancyContext: null,
    initialSnapshot: { kind: "never_recorded" } as const,
  initialResidentDayWindow: null,
    initialMetricChanges: {},
    initialMetricDates: {},
    initialHasServerData: false,
  };
  const data: ExecutiveOverviewData = {
    metrics: { rev_mtd: 50000 }, alerts: [], facilities: [], assuranceHeatMap: [], assuranceTrends: [],
    presenceCensus: EMPTY_PRESENCE_CENSUS, occupancyContext: null,
    snapshot: { kind: "never_recorded" }, metricChanges: {}, metricDates: {},
    todayIsoDate: "2026-09-15",
  };
  const { rerender } = render(<ExecutiveOverviewPageClient {...props} />);
  mocks.organizationId = "org-new";
  rerender(<ExecutiveOverviewPageClient {...props} />);
  await act(async () => finishNew({ ...data, facilities: [{ id: "new", name: "Current facility", metrics: {} }] }));
  expect(screen.getByText("Current facility")).toBeInTheDocument();
  await act(async () => finishOld({ ...data, facilities: [{ id: "old", name: "Stale facility", metrics: {} }] }));
  expect(screen.getByText("Current facility")).toBeInTheDocument();
  expect(screen.queryByText("Stale facility")).not.toBeInTheDocument();
});

it("starts the hand-off panel reads with the overview, not after it (COL-674)", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  mocks.client = { rpc };
  mocks.load.mockImplementationOnce(() => new Promise(() => undefined));
  render(
    <ExecutiveOverviewPageClient
      initialMetrics={{}} initialAlerts={[]} initialFacilities={[]}
      initialAssuranceHeatMap={[]} initialAssuranceTrends={[]}
      initialPresenceCensus={EMPTY_PRESENCE_CENSUS} initialOccupancyContext={null}
      initialSnapshot={{ kind: "never_recorded" }} initialResidentDayWindow={null}
      initialMetricChanges={{}} initialMetricDates={{}} initialHasServerData={false}
    />,
  );
  await act(async () => { await Promise.resolve(); });
  expect(rpc.mock.calls.map(([name]) => name).sort()).toEqual([
    "home_census_notices_for_executive",
    "home_collection_escalations_for_executive",
    "home_escalations_for_executive",
  ]);
  mocks.client = {};
});
