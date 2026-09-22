import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecordPaymentDialog } from "./RecordPaymentDialog";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const residents = async () => [{ id: "r-1", name: "Probe, Ada" }];

function fill() {
  fireEvent.change(screen.getByLabelText("Resident"), { target: { value: "r-1" } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1,200.00" } });
  fireEvent.change(screen.getByLabelText("Check number"), { target: { value: "1042" } });
  fireEvent.change(screen.getByLabelText("Photo of the check or confirmation"), {
    target: { files: [new File(["x"], "check.jpg", { type: "image/jpeg" })] },
  });
}

describe("RecordPaymentDialog (COL-594)", () => {
  it("records resident, amount and photo without showing any balance", async () => {
    const record = vi.fn().mockResolvedValue({ kind: "recorded", allocatedCents: 120000, unappliedCents: 0, replayed: false });
    const onRecorded = vi.fn();
    render(<RecordPaymentDialog open onOpenChange={vi.fn()} facilityId="f-1" localDate="2026-09-22" loadResidents={residents} record={record} onRecorded={onRecorded} />);
    await screen.findByRole("option", { name: "Probe, Ada" });
    expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect(await screen.findByText("Payment recorded.")).toBeInTheDocument();
    expect(record).toHaveBeenCalledWith({}, expect.objectContaining({ facilityId: "f-1", residentId: "r-1", amountCents: 120000, method: "check", reference: "1042", paymentDate: "2026-09-22" }));
    expect(onRecorded).toHaveBeenCalled();
    expect(screen.queryByText(/balance due/i)).toBeNull();
  });

  it("asks for a reason only when the server says the amount is not the full balance, and retries with the same payment id", async () => {
    const record = vi.fn()
      .mockResolvedValueOnce({ kind: "reason_required", message: "This is not the full amount due. Say why." })
      .mockResolvedValueOnce({ kind: "recorded", allocatedCents: 100000, unappliedCents: 20000, replayed: false });
    render(<RecordPaymentDialog open onOpenChange={vi.fn()} facilityId="f-1" localDate="2026-09-22" loadResidents={residents} record={record} />);
    await screen.findByRole("option", { name: "Probe, Ada" });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    const reason = await screen.findByLabelText("This is not the full amount due. Say why.");
    expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Overpaid; credit for October." } });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect(await screen.findByText(/is held on the account/)).toBeInTheDocument();
    const [first, second] = record.mock.calls.map((call) => call[1]);
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.mismatchReason).toBe("Overpaid; credit for October.");
  });

  it("names a failure and keeps the form", async () => {
    const record = vi.fn().mockResolvedValue({ kind: "error", message: "Record payment is not switched on for this facility yet" });
    render(<RecordPaymentDialog open onOpenChange={vi.fn()} facilityId="f-1" localDate="2026-09-22" loadResidents={residents} record={record} />);
    await screen.findByRole("option", { name: "Probe, Ada" });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not switched on"));
    expect(screen.getByLabelText("Amount")).toHaveValue("1,200.00");
  });
});
