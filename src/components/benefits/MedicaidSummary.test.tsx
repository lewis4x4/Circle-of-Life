import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedicaidSummary, moneyOrUnknown, whatIf } from "./MedicaidSummary";

const facilityId = "11111111-1111-4111-8111-111111111111";
const card = {
  facility_id: facilityId, facility_name: "Anon Facility", licensed_beds: 52, census: 48, medicaid_residents: 20, goal_medicaid_residents: null,
  open_cases: 3, by_step: { intake_requested: 1, app_requested: 1 }, awaiting_first_payment: 1, approved_this_month: 1,
  revenue_not_collected_cents: null, cases_without_rate: 2, medicaid_payments_this_month_cents: null, sweep_started_at: null, sweep_answered: 0,
};
const steps = [{ step: "intake_requested", label: "Intake requested" }, { step: "app_requested", label: "App requested" }];
const summary = (over: Record<string, unknown> = {}) => ({ as_of: "2026-09-24", month_start: "2026-09-01", can_set_goals: true, steps, facilities: [card], ...over });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("Medicaid owner summary", () => {
  it("never shows an unknown amount as $0", () => {
    expect(moneyOrUnknown(null)).toBe("Unknown");
    expect(moneyOrUnknown(0)).toBe("$0.00");
  });
  it("computes the what-if only from entered values", () => {
    expect(whatIf("2", "4000", "1600")).toEqual({ plan_monthly_cents: 320000, private_monthly_cents: 800000, difference_cents: -480000 });
    expect(whatIf("", "4000", "1600")).toBeNull();
    expect(whatIf("2", "", "1600")).toBeNull();
  });
  it("shows census, unknowns and where applications are", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(summary())));
    render(<MedicaidSummary />);
    expect(await screen.findByText("48 in census of 52 licensed beds (holds count as occupied).")).toBeTruthy();
    expect(screen.getByText("Not in Haven billing yet")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("2 cases with no rate set")).toBeTruthy();
    expect(screen.getByText("Where applications are: Intake requested 1 · App requested 1")).toBeTruthy();
  });
  it("saves a goal as an effective-dated rule, keeping other facilities' goals", async () => {
    const other = { ...card, facility_id: "22222222-2222-4222-8222-222222222222", facility_name: "Other", goal_medicaid_residents: 10 };
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? json({ id: "x" }, 201) : json(summary({ facilities: [card, other] })));
    vi.stubGlobal("fetch", fetch);
    render(<MedicaidSummary />);
    const panel = (await screen.findByText("Anon Facility")).closest("section") ?? document.body;
    fireEvent.change(within(panel as HTMLElement).getAllByLabelText(/Goal \(Medicaid residents\)/)[0], { target: { value: "25" } });
    fireEvent.click(within(panel as HTMLElement).getAllByRole("button", { name: "Set goal" })[0]);
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body as string)).toMatchObject({ rule_key: "summary.goals", effective_from: "2026-09-24", value: [{ facility_id: other.facility_id, medicaid_residents: 10 }, { facility_id: facilityId, medicaid_residents: 25 }] });
  });
  it("hides goal editing from facility executives and explains a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(summary({ can_set_goals: false }))));
    render(<MedicaidSummary />);
    await screen.findByText("Anon Facility");
    expect(screen.queryByRole("button", { name: "Set goal" })).toBeNull();
  });
});
