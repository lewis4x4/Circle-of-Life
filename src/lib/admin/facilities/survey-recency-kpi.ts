/**
 * AHCA survey cycle context (~15 mo / ~450 d) for days-since-survey KPI tiles.
 */

export function daysSinceLastSurvey(date: string | null | undefined): number | null {
  if (date == null || typeof date !== "string" || date.trim() === "") return null;
  try {
    const diffMs = Date.now() - new Date(`${date.trim()}T12:00:00.000Z`).getTime();
    if (Number.isNaN(diffMs)) return null;
    return Math.max(0, Math.floor(diffMs / 86_400_000));
  } catch {
    return null;
  }
}

export type SurveyRecencyBand = "ok" | "approaching" | "overdue";

export function surveyRecencyBand(days: number | null): SurveyRecencyBand {
  if (days == null) return "ok";
  if (days > 450) return "overdue";
  if (days > 365) return "approaching";
  return "ok";
}

export function surveyRecencyTileCopy(days: number | null): {
  title: string;
  valueLine: string;
  valueClass: string;
  footnote: string | null;
} {
  if (days == null) {
    return {
      title: "Days since last survey",
      valueLine: "—",
      valueClass: "text-muted-foreground",
      footnote: null,
    };
  }

  const band = surveyRecencyBand(days);
  if (band === "overdue") {
    return {
      title: "Survey overdue",
      valueLine: `${days} days`,
      valueClass: "text-amber-600 dark:text-amber-400",
      footnote: null,
    };
  }

  if (band === "approaching") {
    return {
      title: "Days since last survey",
      valueLine: String(days),
      valueClass: "text-muted-foreground",
      footnote: "Approaching renewal window",
    };
  }

  return {
    title: "Days since last survey",
    valueLine: String(days),
    valueClass: "text-muted-foreground",
    footnote: null,
  };
}
