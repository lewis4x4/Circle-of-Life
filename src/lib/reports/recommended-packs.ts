import type { ScheduleFrequency } from "@/lib/reports/pack-ui-metadata";
import type { Phase1TemplateSeed } from "@/lib/reports/templates";

export type RecommendedStarterPack = {
  id: string;
  name: string;
  description: string;
  templateSlugs: string[];
  cadenceLabel: string;
  frequency: ScheduleFrequency;
};

/** Phase 1 opinionated bundles — template slugs must exist in `report_templates`. */
export function buildRecommendedStarterPacks(seed: Phase1TemplateSeed[]): RecommendedStarterPack[] {
  const slug = (s: string) => s;
  return [
    {
      id: "ceo-weekly",
      name: "CEO weekly pack",
      description: "Occupancy, operating scorecard, incident trends, and AR aging.",
      templateSlugs: [
        slug("occupancy-census-summary"),
        slug("facility-operating-scorecard"),
        slug("incident-trend-summary"),
        slug("ar-aging-summary"),
      ],
      cadenceLabel: "Weekly · Monday · 8:00 AM",
      frequency: "weekly",
    },
    {
      id: "compliance-quarterly",
      name: "Compliance quarterly pack",
      description: "Survey readiness, medication exceptions, rounding compliance, and training expiry.",
      templateSlugs: [
        slug("survey-readiness-summary"),
        slug("medication-exception-report"),
        slug("resident-assurance-rounding-compliance"),
        slug("training-certification-expiry"),
      ],
      cadenceLabel: "Quarterly",
      frequency: "quarterly",
    },
    {
      id: "board-monthly",
      name: "Board monthly pack",
      description: "Executive weekly operating bundle plus census, scorecard, and AR snapshot.",
      templateSlugs: [
        slug("executive-weekly-operating-pack"),
        slug("occupancy-census-summary"),
        slug("facility-operating-scorecard"),
        slug("ar-aging-summary"),
      ],
      cadenceLabel: "Monthly",
      frequency: "monthly",
    },
  ].filter((pack) => pack.templateSlugs.every((s) => seed.some((t) => t.slug === s)));
}

/** Survey visit shortcut uses every Phase 1 template (single downloadable bundle UX). */
export function surveyVisitTemplateSlugs(seed: Phase1TemplateSeed[]): string[] {
  return seed.map((t) => t.slug);
}

export const SURVEY_VISIT_PACK_NAME = "Survey visit pack";
