import type { CSSProperties } from "react";
import { tokens } from "@/design-system/tokens";
import { COOK_SPLIT, isCookStaffRole } from "@/lib/schedules/week-grid";

/**
 * COL-795 schedule color key. The colors live in design tokens, never in
 * facility settings, so every building prints the same schedule:
 * pink = day, blue = night, green = cooks, black = administrators and managers.
 */
export type ScheduleTone = keyof typeof tokens.color.schedule;
export const SCHEDULE_TONES = tokens.color.schedule;
/** Legend order, as it appears on screen and on paper. */
export const SCHEDULE_TONE_ORDER: readonly ScheduleTone[] = ["day", "night", "cook", "admin"];

/** Staff positions shown in black: administrators and management. */
export const SCHEDULE_ADMIN_STAFF_ROLES: ReadonlySet<string> = new Set([
  "owner", "ceo", "coo", "cfo", "administrator", "assistant_administrator",
]);

type ToneInput = {
  staffRole: string | null | undefined;
  /** Grid value for the cell: a definition ID, "custom", COOK_SPLIT, or null for Off. */
  cellValue: string | null;
  /** First shift in the cell, or undefined when the cell is Off. */
  shift?: { shiftType: string | null; start: string | null };
};

/** Role outranks shift: an administrator on a day shift is black, a cook is green. */
export function scheduleCellTone({ staffRole, cellValue, shift }: ToneInput): ScheduleTone | null {
  if (!shift) return null;
  if (SCHEDULE_ADMIN_STAFF_ROLES.has(staffRole ?? "")) return "admin";
  if (cellValue === COOK_SPLIT || isCookStaffRole(staffRole)) return "cook";
  if (shift.shiftType === "day") return "day";
  if (shift.shiftType === "night") return "night";
  // Evening and custom shifts follow their start: 6a–6p is day, otherwise night.
  const start = shift.start?.slice(0, 5) ?? "";
  if (!start) return "day";
  return start >= "06:00" && start < "18:00" ? "day" : "night";
}

/** Inline style for a toned cell. Print keeps the fill instead of dropping backgrounds. */
export function scheduleToneStyle(tone: ScheduleTone): CSSProperties {
  const { fill, text } = SCHEDULE_TONES[tone];
  return { backgroundColor: fill, color: text, borderColor: fill, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance for a #RRGGBB color. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Expected #RRGGBB, received ${hex}`);
  const [r, g, b] = match.slice(1).map((part) => channel(parseInt(part, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
