import catalog from "./activity-catalog.json";
import type { ResidentReviewFamily } from "./resident-review-sources";

export const RESIDENT_REVIEW_SOURCE_IDS = "AL-D02 AL-D05 AL-D06 AL-D07 AL-D08 AL-D09 AL-D10 AL-D12 AL-D14 AL-D18 AL-D19 AL-W05 AL-W07 AL-W08 AL-M02 AL-M03 AL-M04 AL-A01 AL-A02 AL-A03 AL-A04 AL-A05 AL-A06 AL-A09 AL-N01 AL-N02 AL-N03 AL-N04 AL-N05 AL-N06 AL-N07 AL-N08 AL-N09 AL-C04 AL-C05 AL-C08".split(" ");
const families: Record<string, ResidentReviewFamily[]> = {
  "hfo-al-d07-01": ["rounding"], "hfo-al-a04-01": ["rounding"],
  "hfo-al-d12-01": ["vital_observation"], "hfo-al-a05-02": ["vital_observation"],
  "hfo-al-m03-01": ["form_1823"], "hfo-al-a03-01": ["form_1823"],
  "hfo-al-w07-01": ["form_1823", "resident_contact"], "hfo-al-a05-01": ["form_1823", "resident_contact"],
};
/** Presentation only. Current server eligibility and native authorization always govern. */
export const residentReviewMap = catalog.entries.filter(entry => RESIDENT_REVIEW_SOURCE_IDS.includes(entry.sourceId)).flatMap(entry => entry.components.map(component => ({
  ...component, sourceId: entry.sourceId, questionIds: entry.questionIds,
  families: families[component.key] ?? [],
  fallback: entry.confirmationReason ?? (families[component.key] ? "Selected source context only; full review coverage and required evidence remain the reviewer’s responsibility." : "Use the existing native or manual workflow. This component has no connected source-review family."),
})));
