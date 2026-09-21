import { REPORT_RUN_UUID_RE } from "./resolve-saved-view-for-run";

export type ReportRunRouteClassification =
  | { kind: "pack"; packId: string }
  | { kind: "saved_view"; viewId: string }
  | { kind: "template"; slug: string }
  | { kind: "invalid_pack" }
  | { kind: "invalid_saved_view" };

/**
 * Classify /admin/reports/run/[sourceType]/[id] params.
 * Ensures saved_view UUIDs are never treated as template slugs (COL-296 / NAV-004).
 */
export function classifyReportRunSource(
  sourceType: string,
  id: string,
): ReportRunRouteClassification {
  const type = (sourceType || "template").toLowerCase();
  const sourceId = id ?? "";

  if (type === "pack") {
    if (!REPORT_RUN_UUID_RE.test(sourceId)) return { kind: "invalid_pack" };
    return { kind: "pack", packId: sourceId };
  }

  if (type === "saved_view") {
    if (!REPORT_RUN_UUID_RE.test(sourceId)) return { kind: "invalid_saved_view" };
    return { kind: "saved_view", viewId: sourceId };
  }

  return { kind: "template", slug: sourceId };
}
