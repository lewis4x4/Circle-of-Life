import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAdmissionsPageClient } from "./AdminAdmissionsPageClient";
import { emptyAdmissionsHubBootstrap } from "@/lib/admissions/admissions-hub-bootstrap";

const mocks = vi.hoisted(() => ({
  facilityState: {
    selectedFacilityId: null as string | null,
    availableFacilities: [] as Array<{ id: string; name: string }>,
  },
  createClientMock: vi.fn(),
  loadBootstrapMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathnameMock,
  useRouter: mocks.useRouterMock,
  useSearchParams: mocks.useSearchParamsMock,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (
    selector: (state: {
      selectedFacilityId: string | null;
      availableFacilities: Array<{ id: string; name: string }>;
    }) => unknown,
  ) => selector(mocks.facilityState),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClientMock,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/admissions/admissions-hub-bootstrap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admissions/admissions-hub-bootstrap")>()),
  loadAdmissionsHubBootstrap: mocks.loadBootstrapMock,
}));

const baseFacilityId = "11111111-1111-1111-1111-111111111111";

const loadedProps = {
  initialBootstrap: emptyAdmissionsHubBootstrap(),
  initialLoadError: null,
  initialFacilityId: baseFacilityId,
  initialScope: "today" as const,
  serverBootstrapped: true,
};

describe("<AdminAdmissionsPageClient /> facility gap copy", () => {
  beforeEach(() => {
    mocks.usePathnameMock.mockReturnValue("/admin/admissions");
    mocks.useRouterMock.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
    mocks.useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
    mocks.facilityState.selectedFacilityId = baseFacilityId;
    mocks.facilityState.availableFacilities = [{ id: baseFacilityId, name: "Demo ALF" }];
    mocks.createClientMock.mockReturnValue({
      from: vi.fn(),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });
    mocks.loadBootstrapMock.mockReset().mockResolvedValue(emptyAdmissionsHubBootstrap());
  });

  it("names the facility gap instead of claiming a facility when none is selected", () => {
    mocks.facilityState.selectedFacilityId = null;

    render(
      <AdminAdmissionsPageClient
        {...loadedProps}
        initialFacilityId={null}
        serverBootstrapped={false}
      />,
    );

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/select a facility in the header to load intake and discharge metrics/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/intake and discharge pipeline\./i)).toBeInTheDocument();
    expect(screen.queryByText("Demo ALF")).not.toBeInTheDocument();
  });

  it("does not claim a facility when the selected id cannot be queried", () => {
    mocks.facilityState.selectedFacilityId = "not-a-uuid";

    render(
      <AdminAdmissionsPageClient
        {...loadedProps}
        initialFacilityId={"not-a-uuid"}
        serverBootstrapped={false}
      />,
    );

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(screen.queryByText("not-a-uuid")).not.toBeInTheDocument();
    expect(
      screen.getByText(/select a facility in the header to load intake and discharge metrics/i),
    ).toBeInTheDocument();
  });

  it("names the selected facility in the hub subtitle once one is selected", () => {
    render(<AdminAdmissionsPageClient {...loadedProps} />);

    expect(screen.getByText("Demo ALF")).toBeInTheDocument();
    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(screen.getByText(/intake and discharge pipeline for/i)).toBeInTheDocument();
  });
});
