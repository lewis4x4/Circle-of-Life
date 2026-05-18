/**
 * Routes where Survey Visit chrome (dock + compact header toggle) is suppressed —
 * operational meaning is org-wide or aggregate; survey mode stays facility-specific.
 */

const SUPPRESS_SURVEY_PATH_PREFIXES = [
  "/admin/billing",
  "/admin/reports",
  "/admin/executive",
] as const;

/** Owner home aggregate (`/admin` without deeper segment): suppress when exact match only. */
const SUPPRESS_SURVEY_EXACT = new Set<string>(["/admin"]);

export function shouldSuppressSurveyVisitChrome(pathname: string | null | undefined): boolean {
  const p = pathname ?? "";
  if (SUPPRESS_SURVEY_EXACT.has(p)) return true;
  for (const prefix of SUPPRESS_SURVEY_PATH_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return true;
  }
  return false;
}
