import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonitoringOrderAction } from "./MonitoringOrderAction";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, message: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

const OPTIONS_ROW = { preset_minutes: [30, 60, 120, 240], min_minutes: 15, max_minutes: 720 };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "monitoring_order_interval_options") {
      return Promise.resolve({ data: [OPTIONS_ROW], error: null });
    }
    return Promise.resolve({ data: "order-1", error: null });
  });
});
afterEach(() => cleanup());

function renderAction(onDone = vi.fn()) {
  render(
    <MonitoringOrderAction
      residentId="res-1"
      residentName="Synthetic Resident"
      facilityId="fac-1"
      onDone={onDone}
    />,
  );
  return onDone;
}

async function openDialog() {
  const user = userEvent.setup();
  renderAction();
  await user.click(screen.getByRole("button", { name: "Monitoring Order" }));
  await screen.findByRole("dialog");
  return user;
}

describe("MonitoringOrderAction", () => {
  it("is called a Monitoring Order, never a watch", async () => {
    await openDialog();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Monitoring Order for Synthetic Resident/)).toBeInTheDocument();
    expect(dialog.textContent?.toLowerCase()).not.toContain("watch");
  });

  it("reads the interval choices from the database rather than carrying them", async () => {
    await openDialog();
    // Asked for this building's presets, not the organization's. The presets
    // and the custom bounds moved into facility_observation_thresholds in
    // migration 432, so a call without a facility reads nothing.
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("monitoring_order_interval_options", { p_facility_id: "fac-1" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Every 30 minutes" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Every 4 hours" })).toBeInTheDocument();
  });

  it("pre-fills only the start time, and leaves every other picker empty", async () => {
    await openDialog();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("button", { name: "Every 30 minutes" });
    expect(within(dialog).getByLabelText(/Their name or facility/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/One line about why/)).toHaveValue("");
    // The end date picker shows the primitive's empty placeholder; the start
    // one carries a date, because a Monitoring Order is already in force when
    // somebody is keying it in. That is the only defensible default here.
    expect(within(dialog).getByLabelText(/^Ends, Eastern/)).toHaveTextContent("MM / DD / YYYY");
    expect(within(dialog).getByLabelText(/^Starts, Eastern/)).not.toHaveTextContent("MM / DD / YYYY");
    expect(within(dialog).getByLabelText(/^Review by, Eastern/)).toHaveTextContent("MM / DD / YYYY");
  });

  it("does not write until the required fields are answered", async () => {
    const user = await openDialog();
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("button", { name: "Every 30 minutes" });
    await user.click(within(dialog).getByRole("button", { name: "Start Monitoring Order" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Say who ordered it.");
    expect(alert).toHaveTextContent(
      "An order with no end date needs a review date, so somebody has to decide about it again.",
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith("create_monitoring_order", expect.anything());
  });

  it("offers no approval step and nothing to submit for review", async () => {
    await openDialog();
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("button", { name: "Every 30 minutes" });
    const text = dialog.textContent?.toLowerCase() ?? "";
    expect(text).not.toContain("approv");
    expect(text).not.toContain("pending");
    expect(text).not.toContain("for review");
    expect(within(dialog).getByRole("button", { name: "Start Monitoring Order" })).toBeInTheDocument();
  });

  it("says what would populate the form when the interval choices do not load", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "monitoring_order_interval_options") {
        return Promise.resolve({ data: null, error: { message: "PGRST205" } });
      }
      return Promise.resolve({ data: null, error: null });
    });
    await openDialog();
    const dialog = screen.getByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the interval choices");
    expect(alert.textContent).not.toContain("PGRST205");
  });
});
