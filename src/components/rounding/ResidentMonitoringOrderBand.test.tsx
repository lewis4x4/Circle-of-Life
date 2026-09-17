import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResidentMonitoringOrderBand } from "./ResidentMonitoringOrderBand";

const mocks = vi.hoisted(() => ({
  result: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: () => Promise.resolve(mocks.result),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

const ORDER = {
  id: "order-1",
  interval_minutes: 30,
  starts_at: "2026-09-16T21:00:00.000Z",
  ends_at: null as string | null,
  review_due_at: null as string | null,
  ordered_by_type: "hospital_discharge",
  ordered_by_name: "Discharging hospital",
  order_received_as: "discharge_paperwork",
  reason_category: "post_hospital_return",
  reason_note: "Thirty minute checks for the first day back.",
};

beforeEach(() => {
  mocks.result = { data: [], error: null };
});
afterEach(() => cleanup());

describe("ResidentMonitoringOrderBand", () => {
  it("renders nothing for a resident on the standard cadence", async () => {
    render(<ResidentMonitoringOrderBand residentId="res-1" />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByText(/Monitoring Order/)).not.toBeInTheDocument();
  });

  it("announces an order in force with its interval, reason and ordering party", async () => {
    mocks.result = { data: [ORDER], error: null };
    render(<ResidentMonitoringOrderBand residentId="res-1" />);
    const band = await screen.findByRole("status");
    expect(band).toHaveTextContent("Every 30 minutes");
    expect(band).toHaveTextContent("Back from hospital");
    expect(band).toHaveTextContent("Hospital discharge");
    expect(band).toHaveTextContent("Discharging hospital");
  });

  it("calls it a Monitoring Order and never a watch", async () => {
    mocks.result = { data: [ORDER], error: null };
    render(<ResidentMonitoringOrderBand residentId="res-1" />);
    const band = await screen.findByRole("status");
    expect(band).toHaveTextContent("Monitoring Order");
    expect(band.textContent?.toLowerCase()).not.toContain("watch");
  });

  it("renders no raw enum value and no migration or table name", async () => {
    mocks.result = { data: [ORDER], error: null };
    render(<ResidentMonitoringOrderBand residentId="res-1" />);
    const band = await screen.findByRole("status");
    const text = band.textContent ?? "";
    expect(text).not.toContain("post_hospital_return");
    expect(text).not.toContain("hospital_discharge");
    expect(text).not.toContain("discharge_paperwork");
    expect(text).not.toContain("resident_monitoring_orders");
  });

  it("flags an open ended order whose review date has gone by", async () => {
    mocks.result = {
      data: [{ ...ORDER, review_due_at: new Date(Date.now() - 86_400_000).toISOString() }],
      error: null,
    };
    render(<ResidentMonitoringOrderBand residentId="res-1" />);
    const band = await screen.findByRole("status");
    expect(band).toHaveTextContent(/review was due/i);
    // A review that is overdue is not an expiry. The order is still in force.
    expect(band.textContent?.toLowerCase()).not.toContain("expired");
  });

  it("says what would populate it rather than showing a data-layer error", async () => {
    mocks.result = { data: [], error: { message: "PGRST205 relation not found" } };
    render(<ResidentMonitoringOrderBand residentId="res-1" />);
    const empty = await screen.findByLabelText("Monitoring Order");
    expect(empty).toHaveTextContent("Monitoring Orders are not loading right now");
    expect(empty).toHaveTextContent("interval, reason and remaining window");
    expect(empty.textContent).not.toContain("PGRST205");
  });
});
