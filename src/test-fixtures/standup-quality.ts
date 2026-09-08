/** Synthetic report fixture for rendered/export checks; never operational seed data. */
import { STANDUP_METRIC_DEFINITIONS, type StandupMetricRow, type StandupSnapshotDetail } from "@/lib/executive/standup";

export const QUALITY_FIXTURE_TIME = "2026-09-08T14:00:00.000Z";
export const QUALITY_FIXTURE_IDS = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];

export function qualityReference(expected = QUALITY_FIXTURE_IDS, contributing = [QUALITY_FIXTURE_IDS[0]]) {
  return { kind: "source_quality", version: 1, calculated_at: QUALITY_FIXTURE_TIME, source_as_of: null, received_at: null,
    query_complete: true, period_coverage: "unconfirmed", expected_facility_ids: expected, contributing_facility_ids: contributing, basis: "haven_live_v1" };
}

export function standupQualityFixture(weekOf = "2026-09-07"): StandupSnapshotDetail {
  const metrics = (id: string | null): Record<string, StandupMetricRow> => Object.fromEntries(STANDUP_METRIC_DEFINITIONS.map((definition) => {
    const hasValue = definition.key === "current_total_census" && id !== QUALITY_FIXTURE_IDS[1];
    return [definition.key, { ...definition, valueNumeric: hasValue ? 0 : null, valueText: null, freshnessAt: null,
      confidenceBand: "low", overrideNote: null, sourceRefJson: [{ table: "synthetic_fixture" }, qualityReference(id ? [id] : QUALITY_FIXTURE_IDS, hasValue ? [QUALITY_FIXTURE_IDS[0]] : [])] }];
  }));
  return {
    snapshot: { id: "synthetic-snapshot", weekOf, status: "draft", generatedAt: QUALITY_FIXTURE_TIME, generatedById: null, generatedByName: null,
      publishedAt: null, publishedById: null, publishedByName: null, completenessPct: 50, confidenceBand: "low", draftNotes: "Synthetic verification only.",
      reviewNotes: null, publishedVersion: 1, pdfAttachmentPath: null },
    facilities: [
      ...QUALITY_FIXTURE_IDS.map((id, index) => ({ facilityId: id, facilityName: `Synthetic facility ${index + 1}`, metrics: metrics(id), pressureScore: 0, topConcern: "Source review required" })),
      { facilityId: null, facilityName: "Totals", metrics: metrics(null), pressureScore: 0, topConcern: "Partial recorded values" },
    ],
  };
}
