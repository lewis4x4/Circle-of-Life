import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuickNoteDialog } from "./QuickNoteDialog";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const assignees = async () => ({ people: [{ userId: "u-mo", displayName: "Mo Manager", title: null }], vendors: [{ vendorId: "v-1", displayName: "Probe Plumbing" }] });
const residents = async () => [{ id: "r-1", name: "Probe, Ada" }];

describe("QuickNoteDialog (COL-595)", () => {
  it("needs a type and text; an assignee or date makes it a task", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(<QuickNoteDialog open onOpenChange={vi.fn()} facilityId="f-1" localDate="2026-09-22" loadAssignees={assignees} loadResidents={residents} save={save} onSaved={onSaved} />);
    await screen.findByRole("option", { name: "Probe Plumbing" });
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Maintenance" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Leak under sink in 12" } });
    expect(screen.getByText("This will be a note on the facility.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Assign to (optional)"), { target: { value: "vendor:v-1" } });
    expect(screen.getByText("This will be a task.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith({}, expect.objectContaining({ facilityId: "f-1", noteType: "maintenance", body: "Leak under sink in 12", assignee: "vendor:v-1" }));
  });

  it("keeps the note and names the refusal", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, message: "This is not switched on for this facility yet" });
    render(<QuickNoteDialog open onOpenChange={vi.fn()} facilityId="f-1" localDate="2026-09-22" loadAssignees={assignees} loadResidents={residents} save={save} />);
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Marshal visit went well" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not switched on");
    expect(screen.getByLabelText("Note")).toHaveValue("Marshal visit went well");
  });
});
