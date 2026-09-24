import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PacketDetail as Detail, PayrollPacket } from "@/lib/payroll-packets/types";

const state = vi.hoisted(() => ({ facilityId: "facility-a", role: "owner", fetch: vi.fn(), push: vi.fn(), register: vi.fn(() => () => {}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: state.role }) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: (selector: (value: unknown) => unknown) => selector({ registerFacilityChangeGuard: state.register }) }));
vi.mock("@/components/common/FacilityGate", () => ({ FacilityGate: ({ children }: { children: React.ReactNode }) => <>{children}</>, useFacilityGateScope: () => ({ facilityId: state.facilityId }) }));
vi.mock("@/components/layout/navigation-pending", () => ({ registerRouteLeaveGuard: () => () => {} }));

import PacketDetail from "./PacketDetail";
import PacketHub from "./PacketHub";
import PolicyForm from "./PolicyForm";

function detail(status: PayrollPacket["status"] = "draft"): Detail {
  return {
    packet: {
      id: "packet-a", facility_id: "facility-a", version: 1, revision: 3, status,
      period_start: "2026-09-14", period_end: "2026-09-20", check_date: "2026-09-25",
      snapshot: {
        facilityName: "Test facility", employerName: "Test employer", policy: { calculationMode: "reviewed", approvalRole: "central" }, blockers: [], warnings: [],
        rows: [{ staffId: "staff-a", name: "Test Employee", role: "Resident aide", payrollId: "001", payBasis: "hourly", department: "operations", regularMinutes: 2400, overtimeMinutes: 0, holidayMinutes: 0, personalMinutes: 0, trainingMinutes: 0, onCallCents: 0, bonusCents: 0, salaryCents: null, note: "", reason: "Reviewed attendance", reviewed: true, workedMinutes: null, mealMinutes: null, paidMinutes: 2400, issues: [] }],
        totals: { workedMinutes: null, paidMinutes: 2400, overtimeMinutes: 0, onCallCents: 0, bonusCents: 0 },
      },
    } as PayrollPacket,
    events: [], versions: [{ id: "packet-a", version: 1, status }], stale: false,
  };
}
const response = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
beforeEach(() => { state.facilityId = "facility-a"; state.role = "owner"; state.fetch.mockReset(); state.push.mockReset(); vi.stubGlobal("fetch", state.fetch); });

describe("payroll packet review", () => {
  it("blocks approval when timecards changed even with no saved blockers", async () => {
    state.fetch.mockImplementation(() => response({ ...detail(), stale: true }));
    render(<PacketDetail id="packet-a" />);
    expect(await screen.findByText(/Timecards or payroll rules have changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve packet" })).toBeDisabled();
    expect(screen.getByLabelText(/I reviewed the employees/)).toBeDisabled();
  });
  it("clears employee review after changing hours and requires save before approval", async () => {
    state.fetch.mockImplementation(() => response(detail()));
    render(<PacketDetail id="packet-a" />);
    const regular = await screen.findByRole("spinbutton", { name: "Test Employee: Regular" });
    fireEvent.change(regular, { target: { value: "38.5" } });
    expect(screen.getByLabelText(/I reviewed this employee/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Approve packet" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith("/api/admin/payroll-packets/packet-a", expect.objectContaining({ method: "PATCH" })));
    const request = state.fetch.mock.calls.find(([, options]) => options.method === "PATCH");
    const body = JSON.parse(request![1].body);
    expect(body).toMatchObject({ action: "save", expectedRevision: 3, inputs: [{ regularMinutes: 2310, reviewed: false }] });
    expect(body.inputs[0]).not.toHaveProperty("workedMinutes");
  });
  it("saves a corrected draft check date and blocks approval until saved", async () => {
    state.fetch.mockImplementation(() => response(detail()));
    render(<PacketDetail id="packet-a" />);
    const date = await screen.findByLabelText("Check date");
    expect(date).toHaveValue("2026-09-25");
    fireEvent.change(date, { target: { value: "2026-09-26" } });
    expect(screen.getByRole("button", { name: "Approve packet" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "PATCH" })));
    const saved = state.fetch.mock.calls.find(([, options]) => options.method === "PATCH");
    expect(JSON.parse(saved![1].body)).toMatchObject({ action: "save", expectedRevision: 3, checkDate: "2026-09-26" });
  });
  it("approved rows are read only and opening reporting requires actual entry information", async () => {
    state.fetch.mockImplementation(() => response(detail("approved")));
    render(<PacketDetail id="packet-a" />);
    expect(await screen.findByRole("spinbutton", { name: "Test Employee: Regular" })).toBeDisabled();
    expect(screen.queryByLabelText("Check date")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/admin/payroll-packets/packet-a/document?format=pdf");
    fireEvent.click(screen.getByRole("button", { name: "Record phone call / RUN entry" }));
    expect(screen.getByRole("button", { name: "Save record" })).toBeDisabled();
    expect(state.fetch.mock.calls.filter(([, options]) => options.method === "PATCH")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("How was payroll reported?"), { target: { value: "phone" } });
    fireEvent.change(screen.getByLabelText("Confirmation reference / call notes"), { target: { value: "ADP confirmation 123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "report", expectedRevision: 3, method: "phone", reference: "ADP confirmation 123" }) })));
  });
  it("hides previously loaded payroll data immediately when facility scope changes", async () => {
    state.fetch.mockImplementationOnce(() => response(detail())).mockImplementation(() => new Promise(() => {}));
    const view = render(<PacketDetail id="packet-a" />);
    expect(await screen.findByText("Test Employee")).toBeInTheDocument();
    state.facilityId = "facility-b";
    view.rerender(<PacketDetail id="packet-a" />);
    expect(screen.queryByText("Test Employee")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download PDF/ })).not.toBeInTheDocument();
  });
  it("does not offer central approval to facility administrators", async () => {
    state.role = "facility_admin"; state.fetch.mockImplementation(() => response(detail()));
    render(<PacketDetail id="packet-a" />);
    expect(await screen.findByText(/configured payroll approver/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve packet" })).not.toBeInTheDocument();
  });
});

describe("payroll preparation", () => {
  it("does not invent rules when saving an incomplete policy", async () => {
    state.fetch.mockImplementation(() => response({}));
    render(<PolicyForm facilityId="facility-a" policy={null} facilities={[]} onSaved={() => {}} />);
    expect(screen.getByLabelText("Pay frequency")).toHaveValue("");
    expect(screen.getByLabelText("Meal treatment")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm payroll rules" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save rules draft" }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalled());
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ facilityId: "facility-a", config: {}, confirm: false, expectedRevision: 0 });
  });
  it("shows an error rather than a successful empty payroll list after a failed read", async () => {
    state.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Payroll unavailable" }) });
    render(<PacketHub />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Payroll unavailable");
    expect(screen.queryByText("No payroll packets yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare payroll packet" })).toBeDisabled();
  });
});
