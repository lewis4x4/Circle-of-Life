/**
 * Quiet Operator copy for the facility detail rates metrics strip.
 * Missing schedule and revenue-model values name real gaps — never fabricate MRR.
 */

import { formatLicensingTabYmdDate } from "@/lib/facilities/licensing-tab-display-copy";

export const RATES_STRIP_NO_SCHEDULED_CHANGE_COPY = "No scheduled change";
export const RATES_STRIP_CONTRACTED_MRR_COPY = "Requires census by room type";
export const RATES_STRIP_NO_FULL_CENSUS_MODEL_COPY = "No capacity model posted";

/** Next scheduled rate-change date when no future-dated row exists. */
export function formatRatesStripNextScheduledChange(
  nextScheduledYmd: string | null | undefined,
  timezone: string,
): string {
  if (!nextScheduledYmd) return RATES_STRIP_NO_SCHEDULED_CHANGE_COPY;
  return formatLicensingTabYmdDate(nextScheduledYmd, timezone);
}

export function ratesStripNextScheduledChangeIsMissing(nextScheduledYmd: string | null | undefined): boolean {
  return !nextScheduledYmd;
}
