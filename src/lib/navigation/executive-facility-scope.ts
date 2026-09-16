/**
 * The executive overview (`/admin/executive` exactly) always reports the whole
 * portfolio — see `EXECUTIVE_SCOPE_NOTE` in `ExecutiveOverviewPageClient`. The
 * top-bar facility picker cannot narrow it, so the shell shows the control
 * disabled rather than hiding it: an operator who looks for the picker still
 * finds it, and its greyed state says the choice is unavailable here instead of
 * accepting a selection that changes nothing.
 *
 * Exact match only. Child routes (`/admin/executive/ceo`, `/admin/executive/facility`,
 * …) are facility-scoped surfaces and keep a working picker.
 */
const FACILITY_SCOPE_LOCKED_EXACT = new Set<string>(["/admin/executive"]);

/** Label shown on the disabled picker so the reason is readable, not inferred. */
export const FACILITY_SCOPE_LOCKED_REASON =
  "Facility filter unavailable — the executive overview always covers every facility";

export function isFacilityScopeLockedPath(pathname: string | null | undefined): boolean {
  return FACILITY_SCOPE_LOCKED_EXACT.has(pathname ?? "");
}
