import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NotesPanel } from "./NotesPanel";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

describe("NotesPanel (COL-595)", () => {
  it("filters notes by type and appends to a note's thread, then closes it", async () => {
    const searchNotes = vi.fn(async (_f: string, type: string) => type === "maintenance"
      ? [{ id: "n-2", note_type: "maintenance", body: "Leak in 12", status: "open", follow_up_date: null, created_at: "2026-09-22T12:00:00Z" }]
      : [{ id: "n-2", note_type: "maintenance", body: "Leak in 12", status: "open", follow_up_date: null, created_at: "2026-09-22T12:00:00Z" },
         { id: "n-3", note_type: "other", body: "Marshal visit", status: "open", follow_up_date: null, created_at: "2026-09-21T12:00:00Z" }]);
    const loadThread = vi.fn().mockResolvedValue([{ id: "u-1", body: "Plumber booked", closed_note: false, created_at: "2026-09-22T13:00:00Z" }]);
    const append = vi.fn().mockResolvedValue({ ok: true });
    render(<NotesPanel facilityId="f-1" currentUserId="me" onTap={[]} searchNotes={searchNotes} loadThread={loadThread} append={append} />);
    expect(await screen.findByText("Marshal visit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Maintenance" }));
    await waitFor(() => expect(screen.queryByText("Marshal visit")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Leak in 12" }));
    expect(await screen.findByText("Plumber booked")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add an update"), { target: { value: "Fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Close it" }));
    await waitFor(() => expect(append).toHaveBeenCalledWith({}, expect.objectContaining({ noteId: "n-2", body: "Fixed", close: true })));
  });
});
