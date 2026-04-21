import {
  addDays,
  addMonths,
  addQuarters,
  addYears,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";

import type { OperationCalendarCell } from "@/lib/operations/types";

export type OperationRangeView = "week" | "month" | "quarter" | "year";

export type OperationDateRange = {
  dateFrom: string;
  dateTo: string;
  label: string;
};

export function formatDateOnly(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

export function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getRangeForView(view: OperationRangeView, anchor: Date): OperationDateRange {
  if (view === "week") {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    return {
      dateFrom: formatDateOnly(start),
      dateTo: formatDateOnly(end),
      label: `${format(start, "MMM d")} - ${format(end, "MMM d")}`,
    };
  }

  if (view === "month") {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    return {
      dateFrom: formatDateOnly(start),
      dateTo: formatDateOnly(end),
      label: format(anchor, "MMMM yyyy"),
    };
  }

  if (view === "quarter") {
    const start = startOfQuarter(anchor);
    const end = endOfQuarter(anchor);
    return {
      dateFrom: formatDateOnly(start),
      dateTo: formatDateOnly(end),
      label: `Q${Math.floor(anchor.getMonth() / 3) + 1} ${format(anchor, "yyyy")}`,
    };
  }

  const start = startOfYear(anchor);
  const end = endOfYear(anchor);
  return {
    dateFrom: formatDateOnly(start),
    dateTo: formatDateOnly(end),
    label: format(anchor, "yyyy"),
  };
}

export function shiftRangeAnchor(view: OperationRangeView, anchor: Date, direction: "prev" | "next"): Date {
  if (view === "week") return addDays(anchor, direction === "next" ? 7 : -7);
  if (view === "month") return addMonths(anchor, direction === "next" ? 1 : -1);
  if (view === "quarter") return addQuarters(anchor, direction === "next" ? 1 : -1);
  return addYears(anchor, direction === "next" ? 1 : -1);
}

export function buildCalendarCells(anchor: Date): OperationCalendarCell[] {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const today = new Date();

  const cells: OperationCalendarCell[] = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    cells.push({
      date: formatDateOnly(cursor),
      is_current_month: cursor.getMonth() === anchor.getMonth(),
      is_today: isSameDay(cursor, today),
    });
  }

  return cells;
}
