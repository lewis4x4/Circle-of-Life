import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WitnessTask } from "@/lib/care-events/witness";

const completeWitnessTask = vi.fn();

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/care-events/witness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/care-events/witness")>();
  return { ...actual, completeWitnessTask: (...args: unknown[]) => completeWitnessTask(...args) };
});
vi.mock("@/components/care-events/admin/VoiceNoteButton", () => ({
  VoiceNoteButton: ({ label, onTranscript }: { label: string; onTranscript: (text: string) => void }) => (
    <button type="button" onClick={() => onTranscript("He was on the floor when I came in.")}>
      {label}
    </button>
  ),
}));

const { WitnessTaskCard } = await import("./WitnessTaskCard");

afterEach(() => {
  cleanup();
  completeWitnessTask.mockReset();
});

function task(overrides: Partial<WitnessTask> = {}): WitnessTask {
  return {
    id: "followup-1",
    incidentId: "incident-1",
    incidentNumber: "HOM-2026-0007",
    careEventId: "care-event-1",
    description: "Witness statement for HOM-2026-0007",
    dueAt: "2026-09-16T22:00:00Z",
    assignedTo: "user-1",
    assignedToName: "Staff A",
    completedAt: null,
    completedBy: null,
    choice: null,
    note: null,
    ...overrides,
  };
}

describe("WitnessTaskCard", () => {
  it("offers the three choices and names the incident", () => {
    render(<WitnessTaskCard task={task()} onCompleted={() => {}} />);
    expect(screen.getByRole("heading", { name: "Witness statement for HOM-2026-0007" })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Witness statement for HOM-2026-0007" });
    expect(group).toBeInTheDocument();
    for (const label of ["I saw it", "I did not see it", "I arrived after"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("requires no typing: there is no text box on the card", () => {
    render(<WitnessTaskCard task={task()} onCompleted={() => {}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("sends the choice the caregiver tapped and drops the card", async () => {
    const user = userEvent.setup();
    completeWitnessTask.mockResolvedValue(undefined);
    const onCompleted = vi.fn();
    render(<WitnessTaskCard task={task()} onCompleted={onCompleted} />);

    await user.click(screen.getByText("I did not see it"));

    await waitFor(() => expect(completeWitnessTask).toHaveBeenCalledTimes(1));
    expect(completeWitnessTask.mock.calls[0]?.[1]).toEqual({
      followupId: "followup-1",
      choice: "did_not_see_it",
      note: null,
    });
    expect(onCompleted).toHaveBeenCalledWith("followup-1");
  });

  it("carries an optional voice note along with the choice", async () => {
    const user = userEvent.setup();
    completeWitnessTask.mockResolvedValue(undefined);
    render(<WitnessTaskCard task={task()} onCompleted={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Add a voice note" }));
    expect(screen.getByText(/He was on the floor when I came in\./)).toBeInTheDocument();

    await user.click(screen.getByText("I arrived after"));

    await waitFor(() => expect(completeWitnessTask).toHaveBeenCalledTimes(1));
    expect(completeWitnessTask.mock.calls[0]?.[1]).toEqual({
      followupId: "followup-1",
      choice: "arrived_after",
      note: "He was on the floor when I came in.",
    });
  });

  it("keeps the card and says what happened when the save is refused", async () => {
    const user = userEvent.setup();
    completeWitnessTask.mockRejectedValue(new Error("followup: this task is already complete"));
    const onCompleted = vi.fn();
    render(<WitnessTaskCard task={task()} onCompleted={onCompleted} />);

    await user.click(screen.getByText("I saw it"));

    expect(await screen.findByRole("alert")).toHaveTextContent("That statement is already on file.");
    expect(onCompleted).not.toHaveBeenCalled();
    // The three choices are still there to try again.
    expect(screen.getByText("I saw it")).toBeInTheDocument();
  });

  it("falls back to a plain heading when the incident number is not loaded", () => {
    render(<WitnessTaskCard task={task({ incidentNumber: null })} onCompleted={() => {}} />);
    expect(screen.getByRole("heading", { name: "Witness statement" })).toBeInTheDocument();
  });
});
