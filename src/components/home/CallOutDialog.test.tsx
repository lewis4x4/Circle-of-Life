import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CallOutDialog } from "./CallOutDialog";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const before = {
  localDate: "2026-09-22",
  shifts: [
    { assignmentId: "sa-ann", staffId: "s-ann", staffName: "Probe, Ann", shiftType: "day", status: "assigned", uncovered: false },
    { assignmentId: "sa-ben", staffId: "s-ben", staffName: "Probe, Ben", shiftType: "day", status: "confirmed", uncovered: false },
  ],
  staff: [{ staffId: "s-ann", staffName: "Probe, Ann" }, { staffId: "s-ben", staffName: "Probe, Ben" }, { staffId: "s-cy", staffName: "Probe, Cy" }],
};
const after = { ...before, shifts: [{ ...before.shifts[0], status: "called_out", uncovered: true }, before.shifts[1]] };

describe("CallOutDialog (COL-596)", () => {
  it("records who and why in a few taps, then offers only people not already on that shift to cover", async () => {
    const load = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after);
    const record = vi.fn().mockResolvedValue({ ok: true });
    const cover = vi.fn().mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<CallOutDialog open onOpenChange={vi.fn()} facilityId="f-1" load={load} record={record} cover={cover} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Probe, Ann/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Sick" }));
    fireEvent.click(screen.getByRole("button", { name: "Record call-out" }));
    expect(await screen.findByRole("dialog", { name: "Cover the shift" })).toBeInTheDocument();
    expect(record).toHaveBeenCalledWith({}, expect.objectContaining({ assignmentId: "sa-ann", reason: "sick" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Pick a replacement", "Probe, Cy"]);
    fireEvent.change(screen.getByLabelText("Who is covering?"), { target: { value: "s-cy" } });
    fireEvent.click(screen.getByRole("button", { name: "Cover it" }));
    await waitFor(() => expect(cover).toHaveBeenCalledWith({}, expect.objectContaining({ assignmentId: "sa-ann", staffId: "s-cy" })));
    expect(await screen.findByText(/Covered/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("names a refusal and keeps the choice", async () => {
    const record = vi.fn().mockResolvedValue({ ok: false, message: "This is not switched on for this facility yet" });
    render(<CallOutDialog open onOpenChange={vi.fn()} facilityId="f-1" load={async () => before} record={record} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Probe, Ben/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Family" }));
    fireEvent.click(screen.getByRole("button", { name: "Record call-out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not switched on");
    expect(screen.getByRole("radio", { name: /Probe, Ben/ })).toHaveAttribute("aria-checked", "true");
  });
});
