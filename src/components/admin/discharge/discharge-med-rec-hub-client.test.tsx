import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DischargeMedRecHubClient } from "./discharge-med-rec-hub-client";

const mocks = vi.hoisted(() => ({
  useFacilityStoreMock: vi.fn(),
  createClientMock: vi.fn(),
  loadBootstrapMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: mocks.useRouterMock,
  useSearchParams: mocks.useSearchParamsMock,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: mocks.useFacilityStoreMock,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClientMock,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/discharge/load-discharge-hub-bootstrap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discharge/load-discharge-hub-bootstrap")>()),
  loadDischargeHubBootstrap: mocks.loadBootstrapMock,
}));

const baseFacilityId = "11111111-1111-1111-1111-111111111111";

const loadedProps = {
  hubBasePath: "/admin/discharge",
  initialRows: [],
  initialLoadFailed: false,
  initialIsRowsCapped: false,
  initialFacilityId: baseFacilityId,
  initialScope: "month" as const,
  serverBootstrapped: true,
};

describe("<DischargeMedRecHubClient /> facility gap copy", () => {
  beforeEach(() => {
    mocks.useRouterMock.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
    mocks.useSearchParamsMock.mockReturnValue(new URLSearchParams("scope=month"));
    mocks.useFacilityStoreMock.mockReturnValue({
      selectedFacilityId: baseFacilityId,
      availableFacilities: [{ id: baseFacilityId, name: "Demo ALF" }],
    });
    mocks.createClientMock.mockReturnValue({
      from: vi.fn(),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });
    mocks.loadBootstrapMock.mockReset().mockResolvedValue({ rows: [], isRowsCapped: false });
  });

  it("names the facility gap instead of claiming a facility when none is selected", () => {
    mocks.useFacilityStoreMock.mockReturnValue({
      selectedFacilityId: null,
      availableFacilities: [{ id: baseFacilityId, name: "Demo ALF" }],
    });

    render(
      <DischargeMedRecHubClient
        {...loadedProps}
        initialFacilityId={null}
        serverBootstrapped={false}
      />,
    );

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/select a facility in the header to load medication reconciliation for that site/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/queue and workflow\./i)).toBeInTheDocument();
    expect(screen.queryByText("Demo ALF")).not.toBeInTheDocument();
  });

  it("does not claim a facility when the selected id cannot be queried", () => {
    mocks.useFacilityStoreMock.mockReturnValue({
      selectedFacilityId: "not-a-uuid",
      availableFacilities: [{ id: baseFacilityId, name: "Demo ALF" }],
    });

    render(
      <DischargeMedRecHubClient
        {...loadedProps}
        initialFacilityId={"not-a-uuid"}
        serverBootstrapped={false}
      />,
    );

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(screen.queryByText("not-a-uuid")).not.toBeInTheDocument();
    expect(
      screen.getByText(/select a facility in the header to load medication reconciliation for that site/i),
    ).toBeInTheDocument();
  });

  it("names the selected facility in the hub subtitle once one is selected", () => {
    render(<DischargeMedRecHubClient {...loadedProps} />);

    expect(screen.getByText("Demo ALF")).toBeInTheDocument();
    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(screen.getByText(/queue and workflow for/i)).toBeInTheDocument();
  });
});
