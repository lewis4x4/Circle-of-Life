import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const HOMEWOOD = "11111111-1111-4111-8111-111111111111";
const OAKRIDGE = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  query: new URLSearchParams(),
  scopeFacilityId: null as string | null,
  fetchPrintFacility: vi.fn(),
  fetchIncidentReportsLog: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.query }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/care-events/print-data", () => ({
  fetchPrintFacility: mocks.fetchPrintFacility,
  fetchIncidentReportsLog: mocks.fetchIncidentReportsLog,
}));
vi.mock("@/components/common/FacilityGate", () => ({
  useFacilityGateScope: () => ({ facilityId: mocks.scopeFacilityId, ready: mocks.scopeFacilityId != null }),
  FacilityGateNotice: ({ title }: { title: string }) => <div data-testid="facility-gate">{title}</div>,
}));
vi.mock("./PrintGate", () => ({ PrintGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./IncidentReportsLogSheet", () => ({
  IncidentReportsLogSheet: ({ facility }: { facility: { name: string } }) => <p>Log for {facility.name}</p>,
}));

const { IncidentReportsLogPageClient } = await import("./IncidentReportsLogPageClient");

afterEach(() => {
  cleanup();
  mocks.query = new URLSearchParams();
  mocks.scopeFacilityId = null;
  mocks.fetchPrintFacility.mockReset();
  mocks.fetchIncidentReportsLog.mockReset();
});

describe("IncidentReportsLogPageClient facility scope (COL-651)", () => {
  it("prints for the header's facility when opened without ?facility=", async () => {
    mocks.scopeFacilityId = HOMEWOOD;
    mocks.fetchPrintFacility.mockResolvedValue({ name: "Homewood Lodge" });
    mocks.fetchIncidentReportsLog.mockResolvedValue([]);

    render(<IncidentReportsLogPageClient />);

    expect(await screen.findByText("Log for Homewood Lodge")).toBeInTheDocument();
    expect(mocks.fetchPrintFacility).toHaveBeenCalledWith(expect.anything(), HOMEWOOD);
  });

  it("a ?facility= link from the board still wins over the header scope", async () => {
    mocks.scopeFacilityId = HOMEWOOD;
    mocks.query = new URLSearchParams({ facility: OAKRIDGE });
    mocks.fetchPrintFacility.mockResolvedValue({ name: "Oakridge ALF" });
    mocks.fetchIncidentReportsLog.mockResolvedValue([]);

    render(<IncidentReportsLogPageClient />);

    await waitFor(() => expect(mocks.fetchPrintFacility).toHaveBeenCalledWith(expect.anything(), OAKRIDGE));
  });

  it("gates with the shared picker under All facilities instead of a dead-end sentence", () => {
    render(<IncidentReportsLogPageClient />);

    expect(screen.getByTestId("facility-gate")).toHaveTextContent("Incident reports log");
    expect(screen.queryByText(/open this page from the incidents board/i)).not.toBeInTheDocument();
    expect(mocks.fetchPrintFacility).not.toHaveBeenCalled();
  });
});
