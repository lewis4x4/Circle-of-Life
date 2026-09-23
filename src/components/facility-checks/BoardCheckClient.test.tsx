import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardCheckClient } from "./BoardCheckClient";
import type { BoardCheckRow } from "@/lib/facility-checks/board-check";
import type { BoardCheckSession } from "@/lib/facility-checks/load-board-check";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const insertedResults: Record<string, unknown>[] = [];
const rpcCalls: { name: string; args: unknown }[] = [];
let nextState: BoardCheckRow[] = [];
let closeError: { message: string } | null = null;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        if (table === "board_check_results") insertedResults.push(payload);
        return Promise.resolve({ error: null });
      },
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "board_check_state") return Promise.resolve({ data: nextState, error: null });
      if (name === "close_board_check_session") return Promise.resolve({ data: null, error: closeError });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function row(overrides: Partial<BoardCheckRow> = {}): BoardCheckRow {
  return {
    bed_id: "bed-1",
    room_number: "101",
    bed_label: "A",
    room_sort_order: 1,
    bed_status: "available",
    haven_resident_id: null,
    haven_resident_status: null,
    latest_result: null,
    latest_recorded_at: null,
    latest_recorded_by: null,
    marked_resident_id: null,
    unmarked: true,
    fix_open: false,
    residentName: null,
    ...overrides,
  };
}

const session: BoardCheckSession = {
  id: "session-1",
  organizationId: "org-1",
  facilityId: "facility-1",
  startedAt: "2026-09-16T12:00:00Z",
  startedBy: "user-1",
  closedAt: null,
  closedBy: null,
};

function renderCheck(rows: BoardCheckRow[], overrides: Partial<Parameters<typeof BoardCheckClient>[0]> = {}) {
  return render(
    <BoardCheckClient
      session={session}
      initialRows={rows}
      initialHistory={[]}
      closedByName={null}
      loadError={null}
      facilityId="facility-1"
      organizationId="org-1"
      actorId="user-1"
      residentsHref="/admin/residents"
      onRefresh={() => {}}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  insertedResults.length = 0;
  rpcCalls.length = 0;
  nextState = [];
  closeError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("recording a result", () => {
  it("opens the resident bed-change workflow for a different occupant", () => {
    renderCheck([row({ haven_resident_id: "resident-1", latest_result: "different_occupant", unmarked: false, fix_open: true })]);
    expect(screen.getByRole("link", { name: /move/i })).toHaveAttribute("href", "/admin/residents/resident-1?changeBed=1");
  });
  it.each([
    ["Matches board", "match"],
    ["Board empty", "board_empty_haven_occupied"],
    ["Board occupied", "board_occupied_haven_empty"],
    ["Different person", "different_occupant"],
    ["Not on board", "bed_not_on_board"],
  ])("one tap on %s records %s", async (label, expected) => {
    nextState = [row({ unmarked: false, latest_result: expected })];
    renderCheck([row()]);
    await userEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(insertedResults).toHaveLength(1));
    expect(insertedResults[0]).toMatchObject({ bed_id: "bed-1", result: expected, session_id: "session-1" });
  });

  it("snapshots the resident Haven showed, and sends no name", async () => {
    nextState = [row({ unmarked: false, latest_result: "different_occupant" })];
    renderCheck([
      row({ haven_resident_id: "resident-1", haven_resident_status: "active", residentName: "Test Resident A" }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Different person" }));
    await waitFor(() => expect(insertedResults).toHaveLength(1));
    expect(insertedResults[0]).toMatchObject({
      haven_resident_id_at_mark: "resident-1",
      haven_resident_status_at_mark: "active",
    });
    expect(JSON.stringify(insertedResults[0])).not.toContain("Test Resident A");
  });
});

describe("what the row shows", () => {
  it("lets the result buttons wrap on a phone instead of forcing a 640px table (COL-657)", () => {
    renderCheck([row({})]);
    const table = screen.getByRole("table");
    expect(table.className).not.toMatch(/(^|\s)min-w-\[640px\]/);
    expect(table.className).toContain("sm:min-w-[640px]");
  });

  it("names a bed hold rather than showing an empty bed", () => {
    renderCheck([
      row({ haven_resident_status: "hospital_hold", haven_resident_id: "r1", residentName: "Test Resident A" }),
    ]);
    expect(screen.getByText("Bed Hold: Hospital")).toBeTruthy();
  });

  it("counts progress and open fixes", () => {
    renderCheck([
      row({ bed_id: "b1", unmarked: false, latest_result: "match" }),
      row({ bed_id: "b2", bed_label: "B", unmarked: false, latest_result: "board_occupied_haven_empty", fix_open: true }),
      row({ bed_id: "b3", bed_label: "C" }),
    ]);
    expect(screen.getByTestId("board-check-progress").textContent).toBe("2 of 3 beds checked · 1 fix open");
  });
});

describe("recompute after a flow change", () => {
  it("clears the fix when the database says the bed now agrees", async () => {
    const open = row({
      bed_id: "bed-1",
      unmarked: false,
      latest_result: "board_occupied_haven_empty",
      fix_open: true,
    });
    renderCheck([open]);
    expect(screen.getByText("What Haven needs")).toBeTruthy();

    // The resident was admitted through the admit flow; the state function
    // recomputes fix_open and the row clears without anything being ticked.
    nextState = [
      row({
        bed_id: "bed-1",
        unmarked: false,
        latest_result: "board_occupied_haven_empty",
        fix_open: false,
        haven_resident_id: "resident-9",
        haven_resident_status: "active",
      }),
    ];
    await userEvent.click(screen.getByRole("button", { name: "Board occupied" }));
    await waitFor(() => expect(screen.queryByText("What Haven needs")).toBeNull());
  });

  it("offers admit without asking for a name", () => {
    renderCheck([row({ unmarked: false, latest_result: "board_occupied_haven_empty", fix_open: true })]);
    const fixes = screen.getByText("What Haven needs").closest("section");
    expect(within(fixes as HTMLElement).getByText("Add resident")).toBeTruthy();
    expect(
      within(fixes as HTMLElement).getByText(/Do not type a name from the board/),
    ).toBeTruthy();
  });
});

describe("close gating", () => {
  it("disables close while a bed is unmarked", () => {
    renderCheck([row({ unmarked: false, latest_result: "match" }), row({ bed_id: "bed-2", bed_label: "B" })]);
    expect(screen.getByRole("button", { name: "Close check" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/1 bed is still unchecked/)).toBeTruthy();
  });

  it("disables close while a fix is open", () => {
    renderCheck([row({ unmarked: false, latest_result: "board_empty_haven_occupied", fix_open: true })]);
    expect(screen.getByRole("button", { name: "Close check" }).hasAttribute("disabled")).toBe(true);
  });

  it("enables close at zero unmarked and zero open, and asks the database", async () => {
    renderCheck([row({ unmarked: false, latest_result: "match" })]);
    const close = screen.getByRole("button", { name: "Close check" });
    expect(close.hasAttribute("disabled")).toBe(false);
    await userEvent.click(close);
    await waitFor(() =>
      expect(rpcCalls.some((call) => call.name === "close_board_check_session")).toBe(true),
    );
  });

  it("re-reads and says what is left when the database refuses", async () => {
    closeError = { message: "Board check has 0 unmarked bed(s) and 1 open fix(es)" };
    nextState = [row({ unmarked: false, latest_result: "board_empty_haven_occupied", fix_open: true })];
    renderCheck([row({ unmarked: false, latest_result: "match" })]);
    await userEvent.click(screen.getByRole("button", { name: "Close check" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("1 fix is still open"));
  });
});

describe("a closed check", () => {
  it("renders read only with its summary", () => {
    renderCheck([row({ unmarked: false, latest_result: "match" })], {
      session: { ...session, closedAt: "2026-09-16T19:42:00Z", closedBy: "user-1" },
      closedByName: "Test Admin A",
    });
    expect(screen.getByTestId("board-check-progress").textContent).toContain("1 of 1 match");
    expect(screen.queryByRole("button", { name: "Close check" })).toBeNull();
    // The whole result control is disabled by its fieldset, which is what stops
    // a closed walk being re-marked.
    const control = screen.getByRole("button", { name: "Matches board" }).closest("fieldset");
    expect((control as HTMLFieldSetElement).disabled).toBe(true);
  });
});
