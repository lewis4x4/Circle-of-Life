import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/residents/MovementWhenFields", () => ({
  useMovementBackdateWindow: () => 3,
  MovementWhenFields: ({ value, onChange, dateLabel }: { value: { date: string; time: string }; onChange: (v: unknown) => void; dateLabel: string }) => (
    <label>
      {dateLabel}
      <input value={value.date} onChange={(event) => onChange({ ...value, date: event.target.value })} />
    </label>
  ),
}));

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { AdmissionArrivalPanel, type ArrivalStatus } from "./AdmissionArrivalPanel";

const TODAY = todayFacilityDateIso();

const FINGERPRINT = "0123456789abcdef0123456789abcdef";
const base = (over: Partial<ArrivalStatus> = {}): ArrivalStatus => ({
  admission_case_id: "case", status: "bed_reserved", actual_arrival_at: null, actual_arrival_precision: null,
  ready: true, blocked_by: [], fingerprint: FINGERPRINT, approval: null, latest_decision: null, approval_invalid_because: null,
  approval_roles: ["owner", "org_admin", "facility_admin"], can_approve: true, receiving: null, outstanding: [], last_reversal: null, ...over,
});

const fetchMock = vi.fn();
const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body } as Response);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdmissionArrivalPanel (COL-333)", () => {
  it("approves exactly the readiness shown, and confirming stays off until an approval is in force", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return reply(base());
      return reply({ id: "approval", replayed: false });
    });
    render(<AdmissionArrivalPanel caseId="case" facilityId="fac" residentId="res" />);
    expect(await screen.findByText(/Not approved yet\. Approved by: Owner, Org admin, Administrator\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm arrival" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Approve arrival" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/workflows/admission-cases/case/arrival-approval", expect.objectContaining({ method: "POST" })));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body as string)).toMatchObject({ fingerprint: FINGERPRINT });
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("says why an earlier approval no longer counts", async () => {
    fetchMock.mockImplementation(() => reply(base({ approval_invalid_because: "readiness_changed", latest_decision: { decision: "approved", by: "a", by_name: "Admin", at: "2026-09-25T12:00:00Z", reason: null } })));
    render(<AdmissionArrivalPanel caseId="case" facilityId="fac" residentId="res" />);
    expect(await screen.findByText("The readiness changed after it was approved. It needs approval again.")).toBeTruthy();
  });

  it("with an approval in force, confirms the arrival with the date given", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/confirm-arrival")) return reply({ residentId: "res" });
      return reply(base({ approval: { id: "ap", approved_by: "a", approved_by_name: "Pat Admin", approved_role: "facility_admin", approved_at: "2026-09-25T12:00:00Z" } }));
    });
    render(<AdmissionArrivalPanel caseId="case" facilityId="fac" residentId="res" />);
    expect(await screen.findByText(/Approved by Pat Admin \(Administrator\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Actual arrival date"), { target: { value: TODAY } });
    await userEvent.click(screen.getByRole("button", { name: "Confirm arrival" }));
    expect(screen.queryByRole("alert")?.textContent ?? "").toBe("");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/confirm-arrival"))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/confirm-arrival"))!;
    expect(JSON.parse(call[1].body as string)).toMatchObject({ arrival_date: TODAY });
  });

  it("after arrival shows the receiving acknowledgment and what is outstanding, and reversal needs a reason", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/reverse-arrival")) return reply({ id: "rev" });
      return reply(base({
        status: "move_in", actual_arrival_at: "2026-09-24T04:00:00Z", actual_arrival_precision: "date",
        receiving: { note_id: "n", posted_at: "2026-09-24T13:00:00Z", acknowledged_at: null, acknowledged_by: null, acknowledged_by_name: null },
        outstanding: [{ kind: "onboarding", key: "care_plan", label: "Care plan" }, { kind: "document", key: "admission_agreement", label: "Admission Agreement" }],
      }));
    });
    render(<AdmissionArrivalPanel caseId="case" facilityId="fac" residentId="res" />);
    expect(await screen.findByText(/Posted to the handoff board; not yet acknowledged\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Care plan" }).getAttribute("href")).toBe("/admin/residents/res/care-plan");
    expect(screen.getByRole("link", { name: "Admission Agreement" }).getAttribute("href")).toBe("#admission-documents");
    await userEvent.click(screen.getByRole("button", { name: "Reverse this arrival" }));
    const confirm = screen.getByRole("button", { name: "Reverse the arrival" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Why the arrival is being reversed"), "Entered for the wrong day");
    await userEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reverse-arrival"))).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/reverse-arrival"))!;
    expect(JSON.parse(call[1].body as string)).toMatchObject({ reason: "Entered for the wrong day" });
  });

  it("a retried approval reuses its request id, so the server replays it", async () => {
    let attempts = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("network")) : reply({ id: "approval" });
      }
      return reply(base());
    });
    render(<AdmissionArrivalPanel caseId="case" facilityId="fac" residentId="res" />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve arrival" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Approve arrival" }));
    await waitFor(() => expect(attempts).toBe(2));
    const ids = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string).request_id);
    expect(ids[0]).toBe(ids[1]);
  });
});
