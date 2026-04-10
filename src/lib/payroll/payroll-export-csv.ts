import { csvEscapeCell } from "@/lib/csv-export";

/** Batch line shape from `payroll_export_lines` + staff join (client export only). */
export type PayrollExportLineRow = {
  line_kind: string;
  amount_cents: number | null;
  idempotency_key: string;
  payload: Record<string, unknown> | null;
  staff: { first_name: string | null; last_name: string | null } | null;
};

/** Full vendor handoff: includes raw JSON payload per line (Track D18). */
export function buildPayrollLinesCsvGeneric(lines: PayrollExportLineRow[]): string {
  const header = [
    "idempotency_key",
    "staff_first_name",
    "staff_last_name",
    "line_kind",
    "amount_cents",
    "payload_json",
  ].join(",");
  const body = lines.map((line) => {
    const fn = line.staff?.first_name ?? "";
    const ln = line.staff?.last_name ?? "";
    const payloadJson = JSON.stringify(line.payload ?? {});
    return [
      csvEscapeCell(line.idempotency_key),
      csvEscapeCell(fn),
      csvEscapeCell(ln),
      csvEscapeCell(line.line_kind),
      csvEscapeCell(String(line.amount_cents ?? "")),
      csvEscapeCell(payloadJson),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

function num(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/** Hours total for `time_record_hours` lines; prefers `actual_hours`, else regular + overtime. */
export function flatHoursFromPayload(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const actual = num(payload, "actual_hours");
  const reg = num(payload, "regular_hours") ?? 0;
  const ot = num(payload, "overtime_hours") ?? 0;
  if (actual !== null) return String(actual);
  const sum = reg + ot;
  return sum > 0 ? String(sum) : "";
}

export function flatMilesFromPayload(lineKind: string, payload: Record<string, unknown> | null): string {
  if (lineKind !== "mileage_reimbursement" || !payload) return "";
  const m = num(payload, "miles");
  return m !== null ? String(m) : "";
}

/**
 * Flat columns for vendors that do not ingest JSON — hours and miles extracted from `payload` where possible.
 * Track D59.
 */
function amountUsdFromCents(cents: number | null): string {
  if (cents === null || Number.isNaN(cents)) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Pay period + USD columns for spreadsheet / vendor imports that do not use raw cents (Track D64).
 * ADP/Gusto-proprietary column layouts remain out of scope.
 */
function hoursSplitFromPayload(p: Record<string, unknown> | null): { reg: string; ot: string } {
  if (!p) return { reg: "", ot: "" };
  const r = num(p, "regular_hours");
  const o = num(p, "overtime_hours");
  return {
    reg: r !== null && !Number.isNaN(r) ? String(r) : "",
    ot: o !== null && !Number.isNaN(o) ? String(o) : "",
  };
}

/**
 * Same scope as vendor handoff (period + USD) but **regular** / **overtime** / **total** hours split for
 * `time_record_hours` lines (`total` matches **`flatHoursFromPayload`**). Not a vendor-proprietary layout.
 * Track D69.
 */
export function buildPayrollLinesCsvHoursSplit(
  lines: PayrollExportLineRow[],
  batch: { period_start: string; period_end: string },
): string {
  const header = [
    "period_start",
    "period_end",
    "idempotency_key",
    "staff_first_name",
    "staff_last_name",
    "line_kind",
    "regular_hours",
    "overtime_hours",
    "total_hours",
    "miles",
    "amount_usd",
  ].join(",");
  const body = lines.map((line) => {
    const fn = line.staff?.first_name ?? "";
    const ln = line.staff?.last_name ?? "";
    const p =
      line.payload && typeof line.payload === "object" ? (line.payload as Record<string, unknown>) : null;
    const { reg, ot } =
      line.line_kind === "time_record_hours" ? hoursSplitFromPayload(p) : { reg: "", ot: "" };
    const total =
      line.line_kind === "time_record_hours" ? flatHoursFromPayload(p) : "";
    const miles = flatMilesFromPayload(line.line_kind, p);
    return [
      csvEscapeCell(batch.period_start),
      csvEscapeCell(batch.period_end),
      csvEscapeCell(line.idempotency_key),
      csvEscapeCell(fn),
      csvEscapeCell(ln),
      csvEscapeCell(line.line_kind),
      csvEscapeCell(reg),
      csvEscapeCell(ot),
      csvEscapeCell(total),
      csvEscapeCell(miles),
      csvEscapeCell(amountUsdFromCents(line.amount_cents)),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

export function buildPayrollLinesCsvVendorHandoff(
  lines: PayrollExportLineRow[],
  batch: { period_start: string; period_end: string },
): string {
  const header = [
    "period_start",
    "period_end",
    "idempotency_key",
    "staff_first_name",
    "staff_last_name",
    "line_kind",
    "hours",
    "miles",
    "amount_usd",
  ].join(",");
  const body = lines.map((line) => {
    const fn = line.staff?.first_name ?? "";
    const ln = line.staff?.last_name ?? "";
    const p =
      line.payload && typeof line.payload === "object" ? (line.payload as Record<string, unknown>) : null;
    const hours = line.line_kind === "time_record_hours" ? flatHoursFromPayload(p) : "";
    const miles = flatMilesFromPayload(line.line_kind, p);
    return [
      csvEscapeCell(batch.period_start),
      csvEscapeCell(batch.period_end),
      csvEscapeCell(line.idempotency_key),
      csvEscapeCell(fn),
      csvEscapeCell(ln),
      csvEscapeCell(line.line_kind),
      csvEscapeCell(hours),
      csvEscapeCell(miles),
      csvEscapeCell(amountUsdFromCents(line.amount_cents)),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

export function buildPayrollLinesCsvFlat(lines: PayrollExportLineRow[]): string {
  const header = [
    "idempotency_key",
    "staff_first_name",
    "staff_last_name",
    "line_kind",
    "hours",
    "miles",
    "amount_cents",
  ].join(",");
  const body = lines.map((line) => {
    const fn = line.staff?.first_name ?? "";
    const ln = line.staff?.last_name ?? "";
    const p = line.payload && typeof line.payload === "object" ? (line.payload as Record<string, unknown>) : null;
    const hours = line.line_kind === "time_record_hours" ? flatHoursFromPayload(p) : "";
    const miles = flatMilesFromPayload(line.line_kind, p);
    return [
      csvEscapeCell(line.idempotency_key),
      csvEscapeCell(fn),
      csvEscapeCell(ln),
      csvEscapeCell(line.line_kind),
      csvEscapeCell(hours),
      csvEscapeCell(miles),
      csvEscapeCell(String(line.amount_cents ?? "")),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}
