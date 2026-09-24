import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { MedicaidPromptsPanel, runwayWords } from "./MedicaidPrompts";

const residentId = "11111111-1111-4111-8111-111111111111";
const facilityId = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const base = { as_of: "2026-09-24", late_signal: [{ facility_id: facilityId, facility_name: "Anon Facility", live: false }], runway: [], late_payments: [] };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });

describe("Medicaid prompts", () => {
  it("words the runway plainly", () => {
    expect(runwayWords(40)).toBe("Private pay runs out in 40 days");
    expect(runwayWords(0)).toBe("Private pay runs out today");
    expect(runwayWords(-1)).toBe("Private pay ran out 1 day ago");
  });
  it("says the late-payment signal is off where payments are not in Haven, instead of flagging everyone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(base)));
    render(<MedicaidPromptsPanel />);
    expect(await screen.findByText("No residents need a Medicaid case started right now.")).toBeTruthy();
    expect(screen.getByText(/Late-payment prompts are off at Anon Facility/)).toBeTruthy();
  });
  it("starts a case from a runway prompt and opens it", async () => {
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ case_id: caseId, already_open: false }, 201)
        : json({ ...base, runway: [{ resident_id: residentId, resident_name: "Anon Resident", facility_id: facilityId, facility_name: "Anon Facility", runway_date: "2026-11-24", days_left: 61, last_result: "not_qualified_now", can_write: true }] }));
    vi.stubGlobal("fetch", fetch);
    render(<MedicaidPromptsPanel />);
    expect(await screen.findByText("Private pay runs out in 61 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start Medicaid case" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/admin/benefits/${caseId}`));
    expect(JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "POST")![1].body as string)).toMatchObject({ resident_id: residentId, kind: "runway" });
  });
  it("setting a prompt aside needs a reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ ...base, runway: [{ resident_id: residentId, resident_name: "Anon Resident", facility_id: facilityId, facility_name: "Anon Facility", runway_date: "2026-11-24", days_left: 61, last_result: "candidate", can_write: true }] })));
    render(<MedicaidPromptsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect((screen.getByRole("button", { name: "Set aside" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("stays out of the way for staff without Medicaid access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ error: "no" }, 404)));
    const { container } = render(<MedicaidPromptsPanel />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
