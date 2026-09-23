import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  selectedFacilityId: "facility-a", portfolio: vi.fn(), signals: vi.fn(), history: vi.fn(), ledger: vi.fn(), evidence: vi.fn(),
}));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId, availableFacilities: [] }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}), isBrowserSupabaseConfigured: () => true }));
vi.mock("@/lib/rounding/watchlist-fetch", () => ({
  fetchWatchlistPortfolio: mocks.portfolio, fetchFacilityWatchlist: mocks.signals,
  fetchResidentWatchlistSignals: mocks.history, fetchResidentDispositionLedger: mocks.ledger,
  fetchWatchlistObservationEvidence: mocks.evidence,
}));
vi.mock("../rounding-hub-nav", () => ({ RoundingHubNav: () => null }));
vi.mock("@/components/common/FacilityGate", () => ({ FacilityGateNotice: () => <p>Facility gate</p> }));
vi.mock("@/components/rounding/WatchlistDispositionForm", () => ({ WatchlistDispositionForm: () => null }));
vi.mock("@/components/rounding/WatchlistPortfolioTable", () => ({ WatchlistPortfolioTable: ({ rows }: { rows: unknown[] }) => <p>Portfolio records: {rows.length}</p> }));
vi.mock("@/components/rounding/WatchlistFacilityTable", () => ({ WatchlistFacilityTable: ({ rows }: { rows: Array<{ signal_label: string }> }) => <div>{rows.map((row) => <p key={row.signal_label}>{row.signal_label}</p>)}</div> }));
import WatchlistPage from "./page";
import ResidentWatchlistPage from "./[residentId]/page";
const history = { id: "s1", signal_key: "internal_signal_key", signal_label: "Changes in mood", status: "cleared", first_detected_at: "2026-09-01T12:00:00Z", cleared_at: "2026-09-02T12:00:00Z", evidence: { log_ids: ["log-1"] } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.selectedFacilityId = "facility-a";
  mocks.portfolio.mockResolvedValue([{ facility_id: "facility-a", open_acute_signal_count: 3, residents_on_watchlist: 2, data_quality_signal_count: 1 }]);
  mocks.signals.mockResolvedValue([]); mocks.history.mockResolvedValue([history]); mocks.ledger.mockResolvedValue([]); mocks.evidence.mockResolvedValue([]);
});
afterEach(cleanup);
it("does not show zero metrics or empty boards before the first successful read", async () => {
  mocks.portfolio.mockImplementation(() => new Promise(() => {}));
  render(<WatchlistPage />);
  expect(screen.getByText("Loading the Watchlist…")).toBeTruthy();
  expect(screen.queryByLabelText("Watchlist summary")).toBeNull();
  expect(screen.queryByText("Portfolio records: 0")).toBeNull();
});
it("retains cached metrics and signals after a failed refresh", async () => {
  mocks.signals.mockResolvedValue([{ signal_label: "Needs review" }]);
  render(<WatchlistPage />);
  await screen.findByText("Needs review");
  mocks.portfolio.mockRejectedValue(new Error("read failed"));
  fireEvent.click(screen.getByLabelText("Refresh the Watchlist"));
  await screen.findByRole("alert");
  expect(screen.getByText("Needs review")).toBeTruthy();
  expect(screen.getByLabelText("Watchlist summary")).toHaveTextContent("3");
  expect(screen.getByRole("alert")).toHaveTextContent("last successfully loaded");
});
it("does not show successful empty detail while loading, and reads selected facility evidence with readable labels", async () => {
  let resolve!: (value: unknown[]) => void;
  mocks.history.mockImplementation(() => new Promise((done) => { resolve = done; }));
  mocks.evidence.mockResolvedValue([{ id: "log-1", observed_at: "2026-09-01T12:00:00Z", composed_summary: "Sitting in the common area, pleasant.", note: "Synthetic evidence note" }]);
  const params = Promise.resolve({ residentId: "resident-1" });
  await act(async () => { render(<Suspense><ResidentWatchlistPage params={params} /></Suspense>); });
  expect(screen.getByText("Loading resident record…")).toBeTruthy();
  expect(screen.queryByText("Nothing is open right now.")).toBeNull();
  await act(async () => resolve([history]));
  await screen.findByText("Changes in mood");
  expect(screen.queryByText("internal_signal_key")).toBeNull();
  expect(mocks.history).toHaveBeenCalledWith(expect.anything(), "resident-1", "facility-a");
  expect(mocks.ledger).toHaveBeenCalledWith(expect.anything(), "resident-1", "facility-a");
  expect(mocks.evidence).toHaveBeenCalledWith(expect.anything(), "resident-1", "facility-a", ["log-1"]);
  fireEvent.click(screen.getByText("View underlying observations"));
  expect(screen.getByText("Sitting in the common area, pleasant.")).toBeVisible();
});
it("isolates a switched facility from a superseded resident request", async () => {
  let resolve!: (value: unknown[]) => void;
  mocks.history.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const params = Promise.resolve({ residentId: "resident-1" });
  const view = await act(async () => render(<Suspense><ResidentWatchlistPage params={params} /></Suspense>));
  mocks.selectedFacilityId = "facility-b";
  mocks.history.mockResolvedValue([{ ...history, signal_label: "Building B signal" }]);
  await act(async () => view.rerender(<Suspense><ResidentWatchlistPage params={params} /></Suspense>));
  await screen.findByText("Building B signal");
  await act(async () => resolve([{ ...history, signal_label: "Stale building A" }]));
  await waitFor(() => expect(screen.queryByText("Stale building A")).toBeNull());
  expect(screen.getByText("Building B signal")).toBeTruthy();
});
it("does not read resident records without a selected facility", async () => {
  mocks.selectedFacilityId = "";
  const params = Promise.resolve({ residentId: "resident-1" });
  await act(async () => { render(<Suspense><ResidentWatchlistPage params={params} /></Suspense>); });
  expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.ledger).not.toHaveBeenCalled();
  expect(screen.getByText("Facility gate")).toBeTruthy();
});
