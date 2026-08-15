/**
 * Quiet Operator copy for dietary hub therapeutic-context batch stats (`/admin/dietary`).
 * Loading and missing states name real gaps — never fabricate percentages.
 */

export type DietaryBatchStatMetric = "thickened" | "swallow" | "allergy" | "texture";

export const DIETARY_BATCH_STAT_LOADING_COPY: Record<DietaryBatchStatMetric, string> = {
  thickened: "Loading thickened share…",
  swallow: "Loading swallow share…",
  allergy: "Loading allergy share…",
  texture: "Loading texture share…",
};

export const DIETARY_BATCH_STAT_NO_DATA_COPY: Record<DietaryBatchStatMetric, string> = {
  thickened: "No thickened share posted",
  swallow: "No swallow share posted",
  allergy: "No allergy share posted",
  texture: "No texture share posted",
};

export const DIETARY_HUB_NO_UPDATED_AT_COPY = "No update time posted";

function isFiniteBatchStatPct(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Therapeutic-context share chip — loading copy, real 0% when posted, explicit gap when missing. */
export function formatDietaryBatchStatPct(
  metric: DietaryBatchStatMetric,
  pct: number | null | undefined,
  loading: boolean,
): string {
  if (loading) return DIETARY_BATCH_STAT_LOADING_COPY[metric];
  if (!isFiniteBatchStatPct(pct)) return DIETARY_BATCH_STAT_NO_DATA_COPY[metric];
  return `${pct}%`;
}

/** Progress bar width for a batch stat — 0 while loading or when pct is missing. */
export function dietaryBatchStatBarWidthPct(
  pct: number | null | undefined,
  loading: boolean,
): number {
  if (loading || !isFiniteBatchStatPct(pct)) return 0;
  return pct;
}

/** Compact relative "Updated" label on attention cards — never a silent em dash. */
export function formatDietaryHubRelativeUpdatedAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return DIETARY_HUB_NO_UPDATED_AT_COPY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return DIETARY_HUB_NO_UPDATED_AT_COPY;
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}
