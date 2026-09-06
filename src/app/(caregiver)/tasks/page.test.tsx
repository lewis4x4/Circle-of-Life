import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResidentAdlCard } from "@/components/caregiver/ResidentAdlCard";
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
afterEach(cleanup);
const resident = { id: "resident-one", displayName: "Review Resident", roomLabel: "101" } as Parameters<typeof ResidentAdlCard>[0]["resident"];
it("keeps a failed ADL draft and clears only the acknowledged note", async () => {
 const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
 render(<ResidentAdlCard resident={resident} passesToday={2} busy={false} onSubmit={save} />);
 const note = screen.getByPlaceholderText("Optional note (objective, brief)");
 fireEvent.change(note, { target: { value: "Resident requested assistance" } });
 fireEvent.click(screen.getByRole("button", { name: "Log ADL Pass" }));
 await waitFor(() => expect(save).toHaveBeenCalledOnce());
 expect(note).toHaveValue("Resident requested assistance");
 expect(screen.queryByText("Stable")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Log ADL Pass" }));
 await waitFor(() => expect(note).toHaveValue(""));
});
it("saving one resident card preserves another resident's unfinished work", async () => {
 render(<><ResidentAdlCard resident={resident} passesToday={0} busy={false} onSubmit={vi.fn().mockResolvedValue(true)} /><ResidentAdlCard resident={{ ...resident, id: "resident-two" }} passesToday={0} busy={false} onSubmit={vi.fn().mockResolvedValue(true)} /></>);
 const notes = screen.getAllByPlaceholderText("Optional note (objective, brief)");
 fireEvent.change(notes[0], { target: { value: "First resident" } });
 fireEvent.change(notes[1], { target: { value: "Unfinished second resident" } });
 fireEvent.click(screen.getAllByRole("button", { name: "Log ADL Pass" })[0]);
 await waitFor(() => expect(notes[0]).toHaveValue(""));
 expect(notes[1]).toHaveValue("Unfinished second resident");
});
