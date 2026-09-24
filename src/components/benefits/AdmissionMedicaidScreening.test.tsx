import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdmissionMedicaidScreening, emptyMedicaidDraft, medicaidDraftPayload } from "./AdmissionMedicaidScreening";

const residentId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const gate = { disqualify: ["q_property_non_primary", "q_income_over_limit", "q_assets"], income_limit_cents: 282900, assets_limit_cents: 200000 };
const listing = (over: Record<string, unknown> = {}) => ({ resident_id: residentId, facility_id: caseId, permissions: { can_write: true, can_review: false }, gate, active_case_id: null, open_recheck: null, screenings: [], ...over });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("AdmissionMedicaidScreening", () => {
  it("states 'not asked yet' and shows the printed questions with the rule's income line, nothing pre-selected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(listing())));
    render(<AdmissionMedicaidScreening residentId={residentId} />);
    expect(await screen.findByText("Not asked yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask the Medicaid questions" }));
    expect(screen.getByText("B. Is your income over $2,829.00 per month?")).toBeTruthy();
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
  });
  it("tells staff without Medicaid access who can grant it instead of showing an empty record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ error: "Benefits case or access is unavailable." }, 404)));
    render(<AdmissionMedicaidScreening residentId={residentId} />);
    expect(await screen.findByText(/visible to staff with Medicaid access/)).toBeTruthy();
    expect(screen.queryByText("Not asked yet.")).toBeNull();
  });
  it("blocks a partial answer set and keeps the draft", async () => {
    const fetch = vi.fn().mockImplementation(() => json(listing()));
    vi.stubGlobal("fetch", fetch);
    render(<AdmissionMedicaidScreening residentId={residentId} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask the Medicaid questions" }));
    fireEvent.change(screen.getByLabelText(/Current coverage/), { target: { value: "private_pay" } });
    fireEvent.click(screen.getByRole("button", { name: "Save answers" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Answer all six questions. Unknown is a valid answer.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("saves a complete set and shows the recorded result with a link to the case", async () => {
    let saved = false;
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") { saved = true; return json({ screening_id: caseId, result: "candidate", reasons: [], case_id: caseId, recheck_id: null, recheck_due_on: null }, 201); }
      return json(saved ? listing({ active_case_id: caseId, screenings: [{
        id: caseId, admission_case_id: null, source: "admission", coverage: "private_pay", coverage_plan: null,
        q_property_non_primary: "no", q_income_over_limit: "no", q_life_insurance: "no", q_burial_contract: "no", q_assets: "no", q_power_of_attorney: "no",
        monthly_income_cents: null, assets_cents: null, private_pay_months: null, runway_date: null, answered_by_kind: null, answered_at: "2026-09-24T15:00:00Z",
        notes: null, result: "candidate", reasons: [], created_at: "2026-09-24T15:00:00Z", recorded_by_name: "Jessica Murphy", override: null }] }) : listing());
    });
    vi.stubGlobal("fetch", fetch);
    render(<AdmissionMedicaidScreening residentId={residentId} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask the Medicaid questions" }));
    fireEvent.change(screen.getByLabelText(/Current coverage/), { target: { value: "private_pay" } });
    for (const group of screen.getAllByRole("group")) {
      const no = Array.from(group.querySelectorAll("input[type=radio]")).find((radio) => (radio as HTMLInputElement).value === "no");
      if (no) fireEvent.click(no);
    }
    expect(screen.getByText("If saved now: Candidate: consider applying")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open the Medicaid case" })).toHaveProperty("href", expect.stringContaining(`/admin/benefits/${caseId}`)));
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body as string).screening).toMatchObject({ resident_id: residentId, source: "admission", coverage: "private_pay", q_assets: "no", monthly_income_cents: null });
  });
});

describe("medicaidDraftPayload", () => {
  it("turns dollars into cents and refuses malformed amounts", () => {
    const draft = { ...emptyMedicaidDraft(), coverage: "none" as const, income: "$1,450.00", answers: { q_property_non_primary: "no", q_income_over_limit: "no", q_life_insurance: "no", q_burial_contract: "no", q_assets: "no", q_power_of_attorney: "no" } as const };
    const built = medicaidDraftPayload(draft, { residentId, source: "admission" });
    expect("payload" in built && built.payload.monthly_income_cents).toBe(145000);
    expect(medicaidDraftPayload({ ...draft, income: "12.345" }, { residentId, source: "admission" })).toEqual({ problem: "Enter amounts in dollars and cents, for example 1,450.00." });
  });
});
