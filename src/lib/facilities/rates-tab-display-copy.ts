/**
 * Quiet Operator copy for the facility detail rates tab.
 * Missing published rates and editor attribution name real gaps — never fabricate amounts or staff.
 */

import { formatUsdFromCents } from "@/lib/insurance/format-money";
import {
  THRESHOLDS_TAB_NO_EDITOR_COPY,
  formatThresholdsTabEditorDisplay,
} from "@/lib/facilities/thresholds-tab-display-copy";

export const RATES_TAB_NO_RATE_POSTED_COPY = "No rate posted";
export const RATES_TAB_NO_CHANGES_COPY = "No changes posted";
export const RATES_TAB_NO_ROOMS_POSTED_COPY = "No rooms posted";
export const RATES_TAB_NO_OCCUPIED_COUNT_POSTED_COPY = "No occupied count posted";

/** Published rate amount for a schedule row when no current line exists. */
export function formatRatesTabPublishedRateDisplay(
  rateType: string,
  amountCents: number | null | undefined,
): string {
  if (amountCents == null || !Number.isFinite(amountCents)) return RATES_TAB_NO_RATE_POSTED_COPY;
  const amount = formatUsdFromCents(amountCents);
  if (rateType.includes("daily")) {
    return `${amount} / day`;
  }
  return `${amount} / mo`;
}

/** Editor display on the rates freshness line (truncates long IDs). */
export function formatRatesTabEditorDisplay(editorId: string | null | undefined): string {
  const display = formatThresholdsTabEditorDisplay(editorId);
  if (display === THRESHOLDS_TAB_NO_EDITOR_COPY) return display;
  if (display.length > 8) return `${display.slice(0, 8)}…`;
  return display;
}

/** Per–room-type inventory count when census is not wired for the rates tab. */
export function formatRatesTabRoomCountDisplay(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return RATES_TAB_NO_ROOMS_POSTED_COPY;
  return `${count} rooms`;
}

/** Per–room-type occupied count when census is not wired for the rates tab. */
export function formatRatesTabOccupiedCountDisplay(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return RATES_TAB_NO_OCCUPIED_COUNT_POSTED_COPY;
  return `${count} occupied`;
}

/** Suffix after "Last changed" on an expanded rate category. */
export function formatRatesTabLastChangedSuffix(
  touch: { at: string; by: string } | null,
  formattedTimestamp: string,
): string {
  if (!touch) return RATES_TAB_NO_CHANGES_COPY;
  return `${formattedTimestamp} by ${touch.by}`;
}
