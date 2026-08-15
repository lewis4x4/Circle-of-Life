/**
 * Quiet Operator copy for the facility detail thresholds tab.
 * Missing editor attribution names real gaps — never fabricate staff names.
 */

export const THRESHOLDS_TAB_NO_EDITOR_COPY = "No editor posted";
export const THRESHOLDS_TAB_NO_CHANGES_COPY = "No changes posted";

/** Editor display on the thresholds freshness line when unset, blank, or a lone em dash. */
export function formatThresholdsTabEditorDisplay(display: string | null | undefined): string {
  if (!display) return THRESHOLDS_TAB_NO_EDITOR_COPY;
  const trimmed = display.trim();
  if (!trimmed || trimmed === "—") return THRESHOLDS_TAB_NO_EDITOR_COPY;
  return trimmed;
}

/** Relative freshness suffix after "Last changed" (time ago + editor, or no-changes copy). */
export function formatThresholdsTabLastChangedSuffix(
  latestSaved: { updated_by_display: string | null | undefined } | null,
  relativeUpdatedAgo: string,
): string {
  if (!latestSaved) return THRESHOLDS_TAB_NO_CHANGES_COPY;
  return `${relativeUpdatedAgo} by ${formatThresholdsTabEditorDisplay(latestSaved.updated_by_display)}`;
}

/** Recently-changed tile on the thresholds metrics strip. */
export function formatThresholdsStripLastChanged(lastChanged: Date | null, formattedRelative: string): string {
  if (lastChanged == null || Number.isNaN(lastChanged.getTime())) return THRESHOLDS_TAB_NO_CHANGES_COPY;
  return formattedRelative;
}

export function thresholdsStripLastChangedIsMissing(lastChanged: Date | null): boolean {
  return lastChanged == null || Number.isNaN(lastChanged.getTime());
}
