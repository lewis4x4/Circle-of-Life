/**
 * Board Check — reconciling Haven's roster against the facility's physical
 * census board, bed by bed (COL-361).
 *
 * This module holds the reading of a walk, not the doing of one. Every
 * correction happens in the flow that already owns it: admit, discharge, room
 * move, bed hold, maintenance or offline. What belongs here is which flow a
 * disagreement points at, and what the row says while it still disagrees.
 *
 * Nothing here decides whether a fix is open. `fix_open` arrives from
 * `board_check_state`, which recomputes it from residents and beds on every
 * read. A checkbox that closed an item without the data changing would make a
 * closed session evidence of nothing.
 */

export const BOARD_CHECK_RESULTS = [
  "match",
  "board_empty_haven_occupied",
  "board_occupied_haven_empty",
  "different_occupant",
  "bed_not_on_board",
] as const;

export type BoardCheckResult = (typeof BOARD_CHECK_RESULTS)[number];

export function isBoardCheckResult(value: string): value is BoardCheckResult {
  return (BOARD_CHECK_RESULTS as readonly string[]).includes(value);
}

/** What the administrator saw on the board, in their words rather than the column's. */
const RESULT_LABELS: Record<BoardCheckResult, string> = {
  match: "Matches board",
  board_empty_haven_occupied: "Board empty",
  board_occupied_haven_empty: "Board occupied",
  different_occupant: "Different person",
  bed_not_on_board: "Not on board",
};

export function boardCheckResultLabel(result: BoardCheckResult): string {
  return RESULT_LABELS[result];
}

export type BoardCheckStateRow = {
  bed_id: string;
  room_number: string;
  bed_label: string;
  room_sort_order: number;
  bed_status: string;
  haven_resident_id: string | null;
  haven_resident_status: string | null;
  latest_result: string | null;
  latest_recorded_at: string | null;
  latest_recorded_by: string | null;
  marked_resident_id: string | null;
  unmarked: boolean;
  fix_open: boolean;
};

/** A row with the resident name attached for display. Names are never stored on a result. */
export type BoardCheckRow = BoardCheckStateRow & {
  residentName: string | null;
};

export type BoardCheckProgress = {
  total: number;
  checked: number;
  fixesOpen: number;
  canClose: boolean;
};

export function boardCheckProgress(rows: readonly BoardCheckStateRow[]): BoardCheckProgress {
  const total = rows.length;
  const checked = rows.filter((row) => !row.unmarked).length;
  const fixesOpen = rows.filter((row) => row.fix_open).length;
  return {
    total,
    checked,
    fixesOpen,
    // A walk with no beds is not a finished walk. Closing one would assert the
    // roster matched a board nobody compared it to.
    canClose: total > 0 && checked === total && fixesOpen === 0,
  };
}

export function boardCheckProgressLine(progress: BoardCheckProgress): string {
  const beds = `${progress.checked} of ${progress.total} beds checked`;
  const fixes =
    progress.fixesOpen === 1 ? "1 fix open" : `${progress.fixesOpen} fixes open`;
  return `${beds} · ${fixes}`;
}

/**
 * What Haven currently says about the bed. `hospital_hold` and `loa` keep the
 * bed, so the row has to name the hold rather than read as an empty bed --
 * that confusion is how a bed on hold gets reassigned.
 */
export function havenOccupancyLabel(row: Pick<BoardCheckRow, "haven_resident_status" | "residentName">): string {
  if (!row.haven_resident_status) return "Empty";
  if (row.haven_resident_status === "hospital_hold") return "Bed Hold: Hospital";
  if (row.haven_resident_status === "loa") return "Bed Hold: Vacation/Family";
  return row.residentName ?? "Occupied";
}

export type BoardCheckFixAction =
  | { kind: "admit"; label: string; detail: string }
  | { kind: "discharge"; label: string; detail: string }
  | { kind: "move"; label: string; detail: string }
  | { kind: "bed_hold"; label: string; detail: string }
  | { kind: "retire_bed"; label: string; detail: string };

/**
 * The one thing Haven needs, and the flow that does it. A board resident who is
 * not in Haven is recorded here as "Add resident" against the bed and nothing
 * more: the name goes in through admit, from the admission paperwork, never
 * typed off the board.
 */
export function boardCheckFixAction(row: BoardCheckRow): BoardCheckFixAction | null {
  if (!row.fix_open || !row.latest_result || !isBoardCheckResult(row.latest_result)) return null;
  switch (row.latest_result) {
    case "board_empty_haven_occupied":
      return {
        kind: "discharge",
        label: "Record discharge",
        detail:
          "Haven still has this bed held. Record the move-out, or a room move if the resident is elsewhere in the building.",
      };
    case "board_occupied_haven_empty":
      return {
        kind: "admit",
        label: "Add resident",
        detail:
          "The board has someone here that Haven does not. Admit them from the admission paperwork. Do not type a name from the board.",
      };
    case "different_occupant":
      return {
        kind: "move",
        label: "Move room",
        detail: "Haven names someone else in this bed. Move whoever is in the wrong bed to the right one.",
      };
    case "bed_not_on_board":
      return {
        kind: "retire_bed",
        label: "Set maintenance or offline",
        detail:
          "Haven has a bed the board does not. Take it out of service, or mark the bed again if the board was wrong.",
      };
    case "match":
      return null;
  }
}

/** Rooms in the order they are walked: the facility's own order, then room number, then bed. */
export function sortBoardCheckRows<T extends BoardCheckStateRow>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    if (left.room_sort_order !== right.room_sort_order) {
      return left.room_sort_order - right.room_sort_order;
    }
    const byRoom = left.room_number.localeCompare(right.room_number, undefined, { numeric: true });
    if (byRoom !== 0) return byRoom;
    return left.bed_label.localeCompare(right.bed_label, undefined, { numeric: true });
  });
}

export function groupBoardCheckRowsByRoom<T extends BoardCheckStateRow>(
  rows: readonly T[],
): { roomNumber: string; beds: T[] }[] {
  const grouped: { roomNumber: string; beds: T[] }[] = [];
  for (const row of sortBoardCheckRows(rows)) {
    const last = grouped.at(-1);
    if (last && last.roomNumber === row.room_number) {
      last.beds.push(row);
      continue;
    }
    grouped.push({ roomNumber: row.room_number, beds: [row] });
  }
  return grouped;
}

/**
 * The insert for one mark. The snapshot columns record what Haven said at the
 * moment of the mark, which is what `different_occupant` is later measured
 * against. No name is ever part of this row.
 */
export function boardCheckResultInsert(input: {
  organizationId: string;
  sessionId: string;
  row: BoardCheckStateRow;
  result: BoardCheckResult;
  recordedBy: string;
}): {
  organization_id: string;
  session_id: string;
  bed_id: string;
  result: BoardCheckResult;
  haven_resident_id_at_mark: string | null;
  haven_resident_status_at_mark: string | null;
  recorded_by: string;
} {
  return {
    organization_id: input.organizationId,
    session_id: input.sessionId,
    bed_id: input.row.bed_id,
    result: input.result,
    haven_resident_id_at_mark: input.row.haven_resident_id,
    haven_resident_status_at_mark: input.row.haven_resident_status,
    recorded_by: input.recordedBy,
  };
}

/** Roles that can admit and discharge, which is what a board walk resolves into. */
export function canRunBoardCheck(appRole: string): boolean {
  return (
    appRole === "owner" ||
    appRole === "org_admin" ||
    appRole === "facility_admin" ||
    appRole === "med_tech"
  );
}

/**
 * The refusal from close_board_check_session, in operator language. The database
 * raises with both counts so the screen can say what is left rather than only
 * that it cannot close.
 */
export function boardCloseRefusalMessage(progress: BoardCheckProgress): string {
  const parts: string[] = [];
  const unchecked = progress.total - progress.checked;
  if (unchecked > 0) {
    parts.push(unchecked === 1 ? "1 bed is still unchecked" : `${unchecked} beds are still unchecked`);
  }
  if (progress.fixesOpen > 0) {
    parts.push(progress.fixesOpen === 1 ? "1 fix is still open" : `${progress.fixesOpen} fixes are still open`);
  }
  if (parts.length === 0) return "This check is ready to close.";
  return `${parts.join(" and ")}. Finish those before closing the check.`;
}

export function boardCheckClosedSummary(input: {
  closedAt: string;
  closedByName: string | null;
  total: number;
  matched: number;
  formatDateTime: (iso: string) => string;
}): string {
  const who = input.closedByName ? ` by ${input.closedByName}` : "";
  return `Closed ${input.formatDateTime(input.closedAt)}${who} · ${input.matched} of ${input.total} match`;
}
