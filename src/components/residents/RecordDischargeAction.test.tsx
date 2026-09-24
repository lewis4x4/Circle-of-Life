import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { RecordDischargeAction } from "./RecordDischargeAction";

const TODAY = todayFacilityDateIso();
const TWO_DAYS_AGO = addFacilityCalendarDays(TODAY, -2);
const TEN_DAYS_AGO = addFacilityCalendarDays(TODAY, -10);

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  getUser: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, message: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      update: mocks.update,
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { facility_id: "fac-1" } }) }) }),
    }),
  }),
}));
// The facility's back-date window (operating rule), as the settings page would set it.
vi.mock("@/lib/operating-rules/operating-rules", () => ({ loadMovementBackdateWindowDays: async () => 3 }));

function open() {
  return userEvent.setup();
}

beforeEach(() => {
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.getUser.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  mocks.eq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "actor-1" } } });
});
afterEach(() => cleanup());

function renderAction(onDone = vi.fn()) {
  render(<RecordDischargeAction residentId="res-1" residentName="Ada Whitlock" onDone={onDone} />);
  return onDone;
}

describe("RecordDischargeAction", () => {
  it("confirms before ending a residency instead of acting on one click", async () => {
    const user = open();
    renderAction();
    expect(mocks.update).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Record discharge — Ada Whitlock/)).toBeInTheDocument();
    // Opening the confirm writes nothing.
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("never pre-fills the discharge date, because it is the billing cutoff", async () => {
    const user = open();
    renderAction();
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    expect(await screen.findByLabelText("Date belongings were removed")).toHaveValue("");
    expect(screen.getByLabelText("Discharge reason")).toHaveValue("");
  });

  it("refuses to write until the date and reason are supplied, and says which is missing", async () => {
    const user = open();
    renderAction();
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Choose the date belongings were removed.");
    expect(alert).toHaveTextContent("Choose the discharge reason.");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("clears bed_id and writes a released status, which is what frees the bed", async () => {
    const user = open();
    const onDone = renderAction();
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date belongings were removed"), TODAY);
    await user.selectOptions(within(dialog).getByLabelText("Discharge reason"), "home");
    await user.type(within(dialog).getByLabelText("Destination"), "Daughter's home");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      status: "discharged",
      discharge_date: TODAY,
      discharge_reason: "home",
      discharge_destination: "Daughter's home",
      bed_id: null,
      updated_by: "actor-1",
    });
    expect(mocks.eq).toHaveBeenCalledWith("id", "res-1");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining("the bed is released"));
  });

  it("records a death as deceased rather than discharged", async () => {
    const user = open();
    renderAction();
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date belongings were removed"), TODAY);
    await user.selectOptions(within(dialog).getByLabelText("Discharge reason"), "death");
    expect(within(dialog).getByText("Recorded as deceased rather than discharged.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    await waitFor(() => expect(mocks.update.mock.calls[0][0]).toMatchObject({ status: "deceased" }));
  });

  it("keeps the confirm open and reports the failure when the write is refused", async () => {
    const user = open();
    const onDone = renderAction();
    mocks.eq.mockResolvedValueOnce({ error: new Error("Row level security denied this update") });
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date belongings were removed"), TODAY);
    await user.selectOptions(within(dialog).getByLabelText("Discharge reason"), "home");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Row level security denied this update");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not write when the session has expired", async () => {
    const user = open();
    renderAction();
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date belongings were removed"), TODAY);
    await user.selectOptions(within(dialog).getByLabelText("Discharge reason"), "home");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Session expired")));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("dates a late-entered discharge when it happened, on its discharge date (COL-750)", async () => {
    const user = open();
    renderAction();
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date belongings were removed"), TWO_DAYS_AGO);
    await user.selectOptions(within(dialog).getByLabelText("Discharge reason"), "home");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the time it happened (Eastern).");
    expect(mocks.update).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Time (Eastern)"), "14:30");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const patch = mocks.update.mock.calls[0][0] as Record<string, string>;
    expect(patch.discharge_date).toBe(TWO_DAYS_AGO);
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(patch.status_effective_at))).toBe(TWO_DAYS_AGO);
    expect(patch).not.toHaveProperty("status_effective_reason");
  });

  it("asks why when the discharge is older than the facility's window", async () => {
    const user = open();
    renderAction();
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date belongings were removed"), TEN_DAYS_AGO);
    await user.type(within(dialog).getByLabelText("Time (Eastern)"), "09:00");
    await user.selectOptions(within(dialog).getByLabelText("Discharge reason"), "home");
    const reason = await within(dialog).findByLabelText("Why is this being entered late?");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Say why this is being entered late.");
    await user.type(reason, "Found on the paper log");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ status_effective_reason: "Found on the paper log" });
  });

  it("shows the database's overlap refusal in its own words", async () => {
    const user = open();
    renderAction();
    const message =
      "This would overlap the resident's last recorded change (to hospital on Sep 22, 2026 3:10 PM). Choose a time after it, or correct that change first.";
    mocks.eq.mockResolvedValueOnce({ error: { code: "23P01", message } });
    await user.click(screen.getByRole("button", { name: "Record discharge" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date belongings were removed"), TODAY);
    await user.selectOptions(within(dialog).getByLabelText("Discharge reason"), "home");
    await user.click(within(dialog).getByRole("button", { name: "Record discharge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
