import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContactLogDialog } from "./ContactLogDialog";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

describe("ContactLogDialog (COL-595)", () => {
  it("logs a voicemail with its note; a letter stays off", async () => {
    const log = vi.fn().mockResolvedValue({ ok: true });
    const onLogged = vi.fn();
    render(<ContactLogDialog open onOpenChange={vi.fn()} residentId="r-1" residentName="Probe, Ada" log={log} onLogged={onLogged} />);
    expect(screen.getByRole("button", { name: /Send a letter/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Left voicemail" }));
    expect(screen.getByText("A call-back is scheduled for the next day.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "No answer at the son's number" } });
    fireEvent.click(screen.getByRole("button", { name: "Log contact" }));
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(log).toHaveBeenCalledWith({}, expect.objectContaining({ residentId: "r-1", kind: "voicemail", note: "No answer at the son's number" }));
  });
});
