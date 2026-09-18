import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WitnessTask } from "@/lib/care-events/witness";

const fetchWitnessTasksForIncident = vi.fn();
const fetchWitnessCandidates = vi.fn();
const addWitness = vi.fn();
const removeWitness = vi.fn();

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/care-events/witness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/care-events/witness")>();
  return {
    ...actual,
    fetchWitnessTasksForIncident: (...args: unknown[]) => fetchWitnessTasksForIncident(...args),
    fetchWitnessCandidates: (...args: unknown[]) => fetchWitnessCandidates(...args),
    addWitness: (...args: unknown[]) => addWitness(...args),
    removeWitness: (...args: unknown[]) => removeWitness(...args),
  };
});

const { CareEventWitnesses } = await import("./CareEventWitnesses");

afterEach(() => {
  cleanup();
  for (const spy of [fetchWitnessTasksForIncident, fetchWitnessCandidates, addWitness, removeWitness]) spy.mockReset();
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

const props = {
  careEventId: "care-event-1",
  incidentId: "incident-1",
  facilityId: "facility-1",
  timeZone: "America/New_York",
  canManage: true,
};

describe("CareEventWitnesses", () => {
  it("says a Note has no witness statement to ask for", async () => {
    render(<CareEventWitnesses {...props} incidentId={null} />);
    expect(await screen.findByText(/A Note has no incident record/)).toBeInTheDocument();
    expect(fetchWitnessTasksForIncident).not.toHaveBeenCalled();
  });

  it("lists who was asked and what they answered, in words", async () => {
    fetchWitnessTasksForIncident.mockResolvedValue([
      task({ completedAt: "2026-09-16T23:04:00Z", choice: "saw_it", note: "She was reaching for the call light." }),
      task({ id: "followup-2", assignedToName: "Staff B" }),
    ]);
    render(<CareEventWitnesses {...props} />);

    expect(await screen.findByText("1 of 2 given.")).toBeInTheDocument();
    expect(screen.getByText("Staff A")).toBeInTheDocument();
    expect(screen.getByText(/^Saw it ·/)).toBeInTheDocument();
    expect(screen.getByText("She was reaching for the call light.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for their answer")).toBeInTheDocument();
    // No raw stored value reaches the screen.
    expect(screen.queryByText(/saw_it/)).not.toBeInTheDocument();
  });

  it("withdraws an unanswered request but offers no control on a given statement", async () => {
    const user = userEvent.setup();
    fetchWitnessTasksForIncident.mockResolvedValue([
      task({ completedAt: "2026-09-16T23:04:00Z", choice: "saw_it" }),
      task({ id: "followup-2", assignedToName: "Staff B" }),
    ]);
    removeWitness.mockResolvedValue(undefined);
    render(<CareEventWitnesses {...props} />);

    const withdraw = await screen.findAllByRole("button", { name: /Withdraw/ });
    expect(withdraw).toHaveLength(1);

    await user.click(withdraw[0]!);
    await waitFor(() => expect(removeWitness).toHaveBeenCalledTimes(1));
    expect(removeWitness.mock.calls[0]?.[1]).toBe("followup-2");
  });

  it("adds a witness the shift roster missed and hides anyone already asked", async () => {
    const user = userEvent.setup();
    fetchWitnessTasksForIncident.mockResolvedValue([task({ assignedTo: "user-1", assignedToName: "Staff A" })]);
    fetchWitnessCandidates.mockResolvedValue([
      { userId: "user-1", name: "A, Staff" },
      { userId: "user-9", name: "C, Staff" },
    ]);
    addWitness.mockResolvedValue(undefined);
    render(<CareEventWitnesses {...props} />);

    await user.click(await screen.findByRole("button", { name: /Add a witness/ }));

    expect(await screen.findByRole("button", { name: "C, Staff" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "A, Staff" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "C, Staff" }));
    await waitFor(() => expect(addWitness).toHaveBeenCalledTimes(1));
    expect(addWitness.mock.calls[0]?.slice(1)).toEqual(["care-event-1", "user-9"]);
  });

  it("shows the list but no controls to a role that may not complete the form", async () => {
    fetchWitnessTasksForIncident.mockResolvedValue([task({ assignedToName: "Staff B" })]);
    render(<CareEventWitnesses {...props} canManage={false} />);

    expect(await screen.findByText("Staff B")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a witness/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it("says plainly when the database refuses the removal", async () => {
    const user = userEvent.setup();
    fetchWitnessTasksForIncident.mockResolvedValue([task({ assignedToName: "Staff B" })]);
    removeWitness.mockRejectedValue(new Error("care_event: a statement that has been given stays on the record"));
    render(<CareEventWitnesses {...props} />);

    await user.click(await screen.findByRole("button", { name: /Withdraw/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A statement that has been given cannot be removed.");
  });
});
