import { enumLabel } from "@/lib/display/enum-label";
/**
 * The admission and discharge register.
 *
 * Every row here is derived from `resident_status_history`. There is no form
 * that types a register line, and there is deliberately no way to edit one: a
 * wrong row is fixed by correcting the resident's status through the flow that
 * owns it, and the register follows. That is the whole reason this replaces a
 * paper log rather than becoming a second one.
 */

export const REGISTER_EVENT_TYPES = [
  "admission",
  "readmission",
  "discharge",
  "death",
  "hospital_out",
  "hospital_return",
  "leave_out",
  "leave_return",
] as const;

export type RegisterEventType = (typeof REGISTER_EVENT_TYPES)[number];

/** The four a paper admission and discharge log does not list. */
export const BED_HOLD_EVENT_TYPES: RegisterEventType[] = [
  "hospital_out",
  "hospital_return",
  "leave_out",
  "leave_return",
];

export type RegisterRow = {
  eventAt: string;
  eventType: RegisterEventType;
  residentId: string;
  residentDisplayName: string;
  roomNumber: string | null;
  bedLabel: string | null;
  roomAsOf: string;
  fromStatus: string | null;
  toStatus: string;
  admissionSource: string | null;
  dischargeReason: string | null;
  dischargeDestination: string | null;
  recordedByName: string | null;
  /**
   * COL-750: when the row was saved. `eventAt` is when it happened; the two
   * differ when a movement was entered later and dated back.
   */
  recordedAt?: string | null;
  /** save_time, entered (staff gave the time) or admission_date; null before COL-750. */
  effectiveBasis?: string | null;
  lateEntryReason?: string | null;
};

const EVENT_LABELS: Record<RegisterEventType, string> = {
  admission: "Admission",
  readmission: "Readmission",
  discharge: "Discharge",
  death: "Death",
  hospital_out: "To hospital",
  hospital_return: "Back from hospital",
  leave_out: "On leave",
  leave_return: "Back from leave",
};

export function registerEventLabel(event: RegisterEventType): string {
  return EVENT_LABELS[event];
}

/**
 * A held bed is a bed hold, and the reason is either a hospital or a family
 * trip. It is never "memory care": Haven does not run a memory care unit and
 * calling a vacation one would put a level of care on a resident's record that
 * nobody assessed.
 */
const STATUS_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  pending_admission: "Pending admission",
  active: "In house",
  hospital_hold: "Bed Hold: Hospital",
  loa: "Bed Hold: Vacation/Family",
  discharged: "Discharged",
  deceased: "Deceased",
};

export function residentStatusLabel(status: string | null): string {
  if (!status) return "";
  return STATUS_LABELS[status] ?? enumLabel(status);
}

export function isBedHoldEvent(event: RegisterEventType): boolean {
  return BED_HOLD_EVENT_TYPES.includes(event);
}

export function filterRegisterRows(rows: RegisterRow[], includeHolds: boolean): RegisterRow[] {
  return includeHolds ? rows : rows.filter((row) => !isBedHoldEvent(row.eventType));
}

/**
 * The counts line above the table. Only the events that actually occurred are
 * named, so an empty category never reads as a zero somebody has to explain.
 */
export function registerCountsLine(rows: RegisterRow[]): string {
  const order: RegisterEventType[] = [
    "admission",
    "readmission",
    "discharge",
    "death",
    "hospital_out",
    "hospital_return",
    "leave_out",
    "leave_return",
  ];
  const counts = new Map<RegisterEventType, number>();
  for (const row of rows) counts.set(row.eventType, (counts.get(row.eventType) ?? 0) + 1);
  const parts = order
    .filter((event) => (counts.get(event) ?? 0) > 0)
    .map((event) => `${registerCountLabel(event)} ${counts.get(event)}`);
  return parts.join(" · ");
}

function registerCountLabel(event: RegisterEventType): string {
  switch (event) {
    case "admission":
      return "Admissions";
    case "readmission":
      return "Readmissions";
    case "discharge":
      return "Discharges";
    case "death":
      return "Deaths";
    case "hospital_out":
      return "Hospital out";
    case "hospital_return":
      return "Hospital back";
    case "leave_out":
      return "Leave out";
    case "leave_return":
      return "Leave back";
  }
}

/** Room and bed as one cell. A discharged resident has no bed, and says so. */
export function registerRoomLabel(row: Pick<RegisterRow, "roomNumber" | "bedLabel">): string {
  if (!row.roomNumber) return "";
  return row.bedLabel ? `${row.roomNumber}-${row.bedLabel}` : row.roomNumber;
}

export const REGISTER_EMPTY_COPY =
  "No admissions or discharges recorded in Haven for this range.";

/** Default window on screen. The print pack defaults to six months instead. */
export const REGISTER_DEFAULT_DAYS = 30;
export const SURVEY_PACK_DEFAULT_MONTHS = 6;
