import { describe, expect, it } from "vitest";

import {
  boardCheckClosedSummary,
  boardCheckFixAction,
  boardCheckProgress,
  boardCheckProgressLine,
  boardCheckResultInsert,
  boardCheckResultLabel,
  boardCloseRefusalMessage,
  canRunBoardCheck,
  groupBoardCheckRowsByRoom,
  havenOccupancyLabel,
  isBoardCheckResult,
  sortBoardCheckRows,
  type BoardCheckRow,
  type BoardCheckStateRow,
} from "@/lib/facility-checks/board-check";

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

describe("board check progress", () => {
  it("counts checked beds and open fixes", () => {
    const progress = boardCheckProgress([
      row({ unmarked: false }),
      row({ unmarked: false, fix_open: true }),
      row(),
    ]);
    expect(progress).toMatchObject({ total: 3, checked: 2, fixesOpen: 1, canClose: false });
    expect(boardCheckProgressLine(progress)).toBe("2 of 3 beds checked · 1 fix open");
  });

  it("allows closing only at zero unmarked and zero open", () => {
    expect(boardCheckProgress([row({ unmarked: false }), row({ unmarked: false })]).canClose).toBe(true);
    expect(boardCheckProgress([row({ unmarked: false }), row()]).canClose).toBe(false);
    expect(boardCheckProgress([row({ unmarked: false, fix_open: true })]).canClose).toBe(false);
  });

  it("refuses to call a walk with no beds closable", () => {
    // Closing this would assert the roster matched a board nobody compared.
    expect(boardCheckProgress([]).canClose).toBe(false);
  });

  it("says what is left rather than only that it cannot close", () => {
    expect(boardCloseRefusalMessage({ total: 36, checked: 30, fixesOpen: 2, canClose: false })).toBe(
      "6 beds are still unchecked and 2 fixes are still open. Finish those before closing the check.",
    );
    expect(boardCloseRefusalMessage({ total: 36, checked: 36, fixesOpen: 1, canClose: false })).toBe(
      "1 fix is still open. Finish those before closing the check.",
    );
  });
});

describe("what Haven shows for a bed", () => {
  it("names a bed hold instead of reading as empty", () => {
    expect(havenOccupancyLabel({ haven_resident_status: "hospital_hold", residentName: "Test Resident A" })).toBe(
      "Bed Hold: Hospital",
    );
    expect(havenOccupancyLabel({ haven_resident_status: "loa", residentName: "Test Resident A" })).toBe(
      "Bed Hold: Vacation/Family",
    );
  });

  it("shows the resident for an active bed and Empty for a free one", () => {
    expect(havenOccupancyLabel({ haven_resident_status: "active", residentName: "Test Resident A" })).toBe(
      "Test Resident A",
    );
    expect(havenOccupancyLabel({ haven_resident_status: null, residentName: null })).toBe("Empty");
  });
});

describe("result labels", () => {
  it("uses board words, not column names", () => {
    expect(boardCheckResultLabel("match")).toBe("Matches board");
    expect(boardCheckResultLabel("board_empty_haven_occupied")).toBe("Board empty");
    expect(boardCheckResultLabel("board_occupied_haven_empty")).toBe("Board occupied");
    expect(boardCheckResultLabel("different_occupant")).toBe("Different person");
    expect(boardCheckResultLabel("bed_not_on_board")).toBe("Not on board");
  });

  it("rejects a result the database would refuse", () => {
    expect(isBoardCheckResult("match")).toBe(true);
    expect(isBoardCheckResult("resolved")).toBe(false);
  });
});

describe("the flow a disagreement points at", () => {
  it("offers nothing while no fix is open", () => {
    expect(boardCheckFixAction(row({ latest_result: "match", unmarked: false }))).toBeNull();
    expect(boardCheckFixAction(row({ latest_result: "different_occupant", unmarked: false }))).toBeNull();
  });

  it("sends a board resident Haven does not have into admit, and asks for no name", () => {
    const action = boardCheckFixAction(
      row({ latest_result: "board_occupied_haven_empty", unmarked: false, fix_open: true }),
    );
    expect(action?.kind).toBe("admit");
    expect(action?.label).toBe("Add resident");
    expect(action?.detail).toContain("Do not type a name from the board");
  });

  it("maps each remaining result to its own flow", () => {
    expect(
      boardCheckFixAction(row({ latest_result: "board_empty_haven_occupied", unmarked: false, fix_open: true }))?.kind,
    ).toBe("discharge");
    expect(
      boardCheckFixAction(row({ latest_result: "different_occupant", unmarked: false, fix_open: true }))?.kind,
    ).toBe("move");
    expect(
      boardCheckFixAction(row({ latest_result: "bed_not_on_board", unmarked: false, fix_open: true }))?.kind,
    ).toBe("retire_bed");
  });
});

describe("recording a mark", () => {
  it("snapshots what Haven said and carries no name", () => {
    const insert = boardCheckResultInsert({
      organizationId: "org-1",
      sessionId: "session-1",
      row: row({ haven_resident_id: "resident-1", haven_resident_status: "active", residentName: "Test Resident A" }),
      result: "different_occupant",
      recordedBy: "user-1",
    });
    expect(insert).toEqual({
      organization_id: "org-1",
      session_id: "session-1",
      bed_id: "bed-1",
      result: "different_occupant",
      haven_resident_id_at_mark: "resident-1",
      haven_resident_status_at_mark: "active",
      recorded_by: "user-1",
    });
    expect(JSON.stringify(insert)).not.toContain("Test Resident A");
  });
});

describe("walk order", () => {
  const rows: BoardCheckStateRow[] = [
    row({ bed_id: "b", room_number: "10", bed_label: "B", room_sort_order: 2 }),
    row({ bed_id: "a", room_number: "10", bed_label: "A", room_sort_order: 2 }),
    row({ bed_id: "c", room_number: "2", bed_label: "A", room_sort_order: 1 }),
  ];

  it("follows the facility's room order, then room number, then bed", () => {
    expect(sortBoardCheckRows(rows).map((r) => r.bed_id)).toEqual(["c", "a", "b"]);
  });

  it("orders room numbers the way a building is walked, not alphabetically", () => {
    const numeric = sortBoardCheckRows([
      row({ bed_id: "r10", room_number: "10", room_sort_order: 0 }),
      row({ bed_id: "r2", room_number: "2", room_sort_order: 0 }),
    ]);
    expect(numeric.map((r) => r.bed_id)).toEqual(["r2", "r10"]);
  });

  it("groups beds under their room", () => {
    const grouped = groupBoardCheckRowsByRoom(rows);
    expect(grouped.map((group) => group.roomNumber)).toEqual(["2", "10"]);
    expect(grouped[1]?.beds.map((bed) => bed.bed_label)).toEqual(["A", "B"]);
  });
});

describe("who may run a board check", () => {
  it("matches the roles that can admit and discharge", () => {
    for (const role of ["owner", "org_admin", "facility_admin", "med_tech"]) {
      expect(canRunBoardCheck(role)).toBe(true);
    }
    for (const role of ["caregiver", "cook", "dietary", "maintenance_role", "family", "broker", "nurse"]) {
      expect(canRunBoardCheck(role)).toBe(false);
    }
  });
});

describe("a closed check", () => {
  it("reads as the proof it is", () => {
    expect(
      boardCheckClosedSummary({
        closedAt: "2026-09-16T19:42:00Z",
        closedByName: "Test Admin A",
        total: 36,
        matched: 36,
        formatDateTime: () => "Sep 16, 3:42 p.m.",
      }),
    ).toBe("Closed Sep 16, 3:42 p.m. by Test Admin A · 36 of 36 match");
  });
});
