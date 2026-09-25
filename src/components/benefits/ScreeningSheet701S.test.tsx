import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScreeningSheet701S } from "./ScreeningSheet701S";

const caseId = "11111111-1111-4111-8111-111111111111";
const facts = {
  case_id: caseId,
  resident: { first_name: "Anon", middle_name: null, last_name: "Resident", date_of_birth: "1940-02-03", gender: "female", phone: null },
  facility: { name: "Anon House", address_line_1: "1 Probe Way", city: "Probeville", zip: "00000" },
  medicaid_number: null, screening: null, forms_1823: [], active_medication_count: 0,
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("701S screening sheet page", () => {
  it("renders pre-filled answers with sources and leaves the rest blank", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(facts)));
    render(<ScreeningSheet701S caseId={caseId} />);
    expect(await screen.findByText("Anon")).toBeTruthy();
    expect(screen.getAllByText("Source: Facility record").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Blank: ask").length).toBeGreaterThan(20);
    expect(screen.getByText("No diagnoses recorded on a Form 1823 in Haven")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/admin/benefits/cases/${caseId}/701s`);
  });
  it("explains missing Medicaid access instead of showing an empty sheet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ error: "Forbidden" }, 403)));
    render(<ScreeningSheet701S caseId={caseId} />);
    expect(await screen.findByText(/available to staff with Medicaid access/)).toBeTruthy();
  });
});
