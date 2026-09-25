import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ selectedFacilityId: "11111111-1111-4111-8111-111111111111" as string | null }));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (selector: (state: { selectedFacilityId: string | null; availableFacilities: Array<{ id: string; name: string }> }) => unknown) =>
    selector({ selectedFacilityId: store.selectedFacilityId, availableFacilities: [{ id: "11111111-1111-4111-8111-111111111111", name: "Anon Facility" }] }),
}));

vi.mock("@/components/common/FacilityGate", () => ({ FacilityGateNotice: ({ reason }: { reason: string }) => <p data-testid="facility-gate">{reason}</p> }));

import { MedicaidBoard, boardDate, revenueLabel } from "./MedicaidBoard";

const facilityId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const steps = [["intake_requested", "Intake requested"], ["intake_emailed", "Intake & notice emailed"], ["assessment_complete", "Assessment complete"], ["score", "Score"]].map(([step, label]) => ({ step, label }));
const row = {
  case_id: caseId, revision: 3, status: "open", resident_id: "33333333-3333-4333-8333-333333333333", resident_name: "Anon Resident", next_action: null, due_date: null, assignee_name: null,
  agency_score: null, reapply_on: null, caseworker_id: null, caseworker_name: null, caseworker_phone: null,
  step_dates: { intake_requested: "2026-09-01", intake_emailed: "2026-09-02", assessment_complete: "2026-09-10" }, next_step: "score", waiting_on: "agency", days_since_last_step: 14, stalled: true,
  plan_rate_cents: 160000, revenue_not_collected_cents: 122667,
};
const board = (over: Record<string, unknown> = {}) => ({ as_of: "2026-09-24", facility_id: facilityId, facility_name: "Anon Facility", stalled_days: 14, can_write: true, steps, rows: [row], needs_answers: [], rechecks_due: 0, contacts: [], ...over });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => { vi.unstubAllGlobals(); store.selectedFacilityId = facilityId; });

describe("Medicaid board", () => {
  it("formats dates and dollars, and never shows $0 for an unknown rate", () => {
    expect(boardDate("2026-09-01")).toBe("Sep 1");
    expect(revenueLabel({ revenue_not_collected_cents: 122667, plan_rate_cents: 160000 })).toBe("$1,226.67 not yet collected");
    expect(revenueLabel({ revenue_not_collected_cents: null, plan_rate_cents: null })).toBe("Rate not set");
  });
  it("shows recorded dates, flags a stalled case and offers only the next step", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(board())));
    render(<MedicaidBoard />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Sep 1")).toBeTruthy();
    expect(within(table).getByText("No step in 14 days")).toBeTruthy();
    expect(within(table).getAllByRole("button", { name: "Record" })).toHaveLength(1);
  });
  it("records a score with the case revision and refuses to save without one", async () => {
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? json({ case_id: caseId, revision: 4 }) : json(board()));
    vi.stubGlobal("fetch", fetch);
    render(<MedicaidBoard />);
    fireEvent.click(within(await screen.findByRole("table")).getByRole("button", { name: "Record" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    expect(await within(dialog).findByText("Choose the score the agency gave.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Score the agency gave/), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record" }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe(`/api/admin/benefits/board/${caseId}`);
    expect(JSON.parse(post[1].body as string)).toMatchObject({ action: "record_score", expected_revision: 3, payload: { score: 4 } });
  });
  it("asks for a facility when viewing all facilities", async () => {
    store.selectedFacilityId = null;
    vi.stubGlobal("fetch", vi.fn());
    render(<MedicaidBoard />);
    expect(screen.getByTestId("facility-gate").textContent).toContain("one facility at a time");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("an unexpected reply is an error, not an empty board", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ rows: "nope" })));
    render(<MedicaidBoard />);
    expect(await screen.findByText(/could not be verified/)).toBeTruthy();
  });
});
