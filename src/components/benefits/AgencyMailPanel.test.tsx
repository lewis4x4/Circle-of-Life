import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgencyMailPanel } from "./AgencyMailPanel";

const facilityId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const item = { id: "33333333-3333-4333-8333-333333333333", status: "proposed", match_basis: "resident_name", proposed_case_id: caseId, proposed_resident_name: "Anon Resident", proposed_agency: "dcf", proposed_letter_date: "2026-09-12", proposed_due_on: "2026-10-02", from_address: "dcf@example.invalid", subject: "Pending verification", preview: "Return the items", received_at: "2026-09-24T14:00:00Z", attachments: [{ id: "44444444-4444-4444-8444-444444444444", filename: "letter.pdf", content_type: "application/pdf", size_bytes: 10, status: "stored" }] };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("AgencyMailPanel", () => {
  it("says when no inbox is set up", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ can_write: true, inboxes: [], items: [] })));
    render(<AgencyMailPanel facilityId={facilityId} cases={[]} />);
    expect(await screen.findByText("No Medicaid inbox is set up for this facility yet.")).toBeTruthy();
  });
  it("shows the proposal and confirms with what Haven read, prefilled", async () => {
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => init?.method === "POST" ? json({ item_id: item.id, case_id: caseId, event_id: caseId }) : json({ can_write: true, inboxes: [{ email: "homewood-medicaid@example.invalid", purpose: "medicaid_agency" }], items: [item] }));
    vi.stubGlobal("fetch", fetch);
    render(<AgencyMailPanel facilityId={facilityId} cases={[{ case_id: caseId, resident_name: "Anon Resident" }]} />);
    expect(await screen.findByText("Looks like Anon Resident")).toBeTruthy();
    expect(screen.getByRole("link", { name: "letter.pdf" })).toHaveProperty("href", expect.stringContaining(`/api/admin/benefits/mail/attachments/${item.attachments[0]!.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Confirm" }).at(-1)!);
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    expect(JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "POST")![1].body as string)).toMatchObject({ case_id: caseId, agency: "dcf", letter_date: "2026-09-12", due_on: "2026-10-02" });
  });
});
