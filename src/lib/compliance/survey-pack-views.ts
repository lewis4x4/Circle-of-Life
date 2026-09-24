/**
 * The one survey page (COL-707, Brian 2026-09-23): /admin/compliance/survey-pack. The print
 * pack, the readiness binder and the evidence bundle were three pages; they are its views.
 */
export const SURVEY_PACK_HREF = "/admin/compliance/survey-pack";

export const SURVEY_PACK_VIEWS = [
  { id: "print", label: "Print pack", href: SURVEY_PACK_HREF },
  { id: "binder", label: "Readiness binder", href: `${SURVEY_PACK_HREF}?tab=binder` },
  { id: "evidence", label: "Evidence bundle", href: `${SURVEY_PACK_HREF}?tab=evidence` },
] as const;

export type SurveyPackView = (typeof SURVEY_PACK_VIEWS)[number]["id"];

export function surveyPackView(tab: string | string[] | undefined | null): SurveyPackView {
  const value = Array.isArray(tab) ? tab[0] : tab;
  return value === "binder" || value === "evidence" ? value : "print";
}
