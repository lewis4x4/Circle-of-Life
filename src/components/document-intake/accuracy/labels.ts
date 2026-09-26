import type { StatusPillTone as StatusTone } from "@/components/ui/status-pill";
import type { CheckRecommendation, Recommendation } from "@/lib/document-intake/jev-accuracy";
import { formatMargin, formatShare, recommendationLabel } from "@/lib/document-intake/jev-accuracy-report";

export { recommendationLabel };

export function recommendationTone(rec: Recommendation): StatusTone {
  switch (rec.action) {
    case "loosen":
      return "info";
    case "tighten":
      return "warning";
    case "off":
      return "danger";
    default:
      return "muted";
  }
}

/** One short line under the recommendation: what it rests on. */
export function recommendationNote(rec: Recommendation): string {
  switch (rec.action) {
    case "collect":
      return `${rec.needed - rec.evaluated} more checked documents before a call`;
    case "keep":
      return rec.cleared ? `${formatShare(rec.accuracy)} right above ${formatMargin(rec.margin)}, ${rec.cleared} documents` : "No documents cleared the margin yet";
    case "loosen":
    case "tighten":
      return `${rec.cleared} documents would clear; lower bound ${formatShare(rec.lower_bound)}`;
    case "off":
      return rec.reason;
  }
}

export const CHECK_ACTION_LABELS: Record<CheckRecommendation["action"], string> = {
  collect: "Collect",
  keep: "Keep",
  reword: "Reword",
};

export function checkTone(action: CheckRecommendation["action"]): StatusTone {
  return action === "reword" ? "warning" : "muted";
}

/** Jev's destination answer: the candidate key, or the explicit none option. */
export function jevChoiceLabel(choice: string | null): string {
  if (choice == null) return "No pick";
  if (choice === "none") return "None of these";
  const m = /^c(\d+)$/.exec(choice);
  return m ? `Option ${Number(m[1]) + 1}` : choice;
}
