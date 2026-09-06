export type InsightCitation = { label: string; href?: string; facility_id?: string; kind?: "facility" | "report" | "kb" | "metric" };

/** Shared evidence contract for compact and full Insight responses. */
export function normalizeInsightCitations(value: unknown): InsightCitation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.flatMap((item): InsightCitation[] => {
    if (!item || typeof item !== "object" || typeof item.label !== "string" || !item.label.trim()) return [];
    const href = typeof item.href === "string" && (/^https:\/\//.test(item.href) || /^\/(?!\/)/.test(item.href)) ? item.href : undefined;
    const kind = ["facility", "report", "kb", "metric"].includes(item.kind) ? item.kind as InsightCitation["kind"] : undefined;
    return [{ label: item.label, href, kind, facility_id: typeof item.facility_id === "string" ? item.facility_id : undefined }];
  });
  return result.length ? result : undefined;
}
