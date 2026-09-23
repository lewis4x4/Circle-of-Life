import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveReportRunState, type ReportRunState } from "@/lib/reports/report-status";
import type { Database, Json } from "@/types/database";

/**
 * Report run history with the names a reader needs (COL-643): which report,
 * which facility, who ran it, and one derived status shared with the hub and
 * the run detail page.
 */
export type ReportRunHistoryItem = {
  id: string;
  sourceType: string;
  reportName: string;
  facilityLabel: string;
  runByLabel: string;
  runKindLabel: string;
  startedAt: string;
  completedAt: string | null;
  state: ReportRunState;
};

type RunRow = {
  id: string;
  source_type: string;
  source_id: string;
  template_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  generated_by_user_id: string | null;
  schedule_id: string | null;
  run_scope_json: Json;
  report_title: string | null;
  scope_label: string | null;
};

function readScope(scope: Json): { facilityId: string | null; scopeLabel: string | null } {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return { facilityId: null, scopeLabel: null };
  const facilityId = typeof scope.facility_id === "string" ? scope.facility_id : null;
  const scopeLabel = typeof scope.scope_label === "string" && scope.scope_label.trim() ? scope.scope_label : null;
  return { facilityId, scopeLabel };
}

const SOURCE_FALLBACK: Record<string, string> = {
  template: "Template report",
  saved_view: "Saved view",
  pack: "Report pack",
};

export function describeReportRun(
  row: RunRow,
  names: { reports: Map<string, string>; facilities: Map<string, string>; users: Map<string, string> },
  now: Date = new Date(),
): ReportRunHistoryItem {
  const scope = readScope(row.run_scope_json);
  const reportName =
    row.report_title?.trim() ||
    (row.template_id ? names.reports.get(row.template_id) : undefined) ||
    names.reports.get(row.source_id) ||
    SOURCE_FALLBACK[row.source_type] ||
    "Report";
  const facilityLabel =
    row.scope_label?.trim() ||
    scope.scopeLabel ||
    (scope.facilityId ? names.facilities.get(scope.facilityId) ?? "Facility not available" : "All facilities");
  const runByLabel = row.generated_by_user_id
    ? names.users.get(row.generated_by_user_id) ?? "Staff member not available"
    : row.schedule_id
      ? "Report scheduler"
      : "Not recorded";
  return {
    id: row.id,
    sourceType: row.source_type,
    reportName,
    facilityLabel,
    runByLabel,
    runKindLabel: row.schedule_id ? "Scheduled" : "Run by hand",
    startedAt: row.started_at,
    completedAt: row.completed_at,
    state: deriveReportRunState(row, now),
  };
}

export async function loadReportRunHistory(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  limit: number,
): Promise<ReportRunHistoryItem[]> {
  const { data, error } = await supabase
    .from("report_runs")
    .select(
      "id, source_type, source_id, template_id, status, started_at, completed_at, generated_by_user_id, schedule_id, run_scope_json, report_title:result_snapshot_json->>title, scope_label:result_snapshot_json->>scopeLabel",
    )
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as RunRow[];
  if (rows.length === 0) return [];

  const reportIds = [...new Set(rows.flatMap((r) => [r.template_id, r.source_id]).filter((v): v is string => !!v))];
  const facilityIds = [
    ...new Set(rows.map((r) => readScope(r.run_scope_json).facilityId).filter((v): v is string => !!v)),
  ];
  const userIds = [...new Set(rows.map((r) => r.generated_by_user_id).filter((v): v is string => !!v))];

  // Name lookups are best effort: a missing name degrades to a named gap, never a failed page.
  const [templates, packs, savedViews, facilities, users] = await Promise.all([
    supabase.from("report_templates").select("id, name").in("id", reportIds),
    supabase.from("report_packs").select("id, name").eq("organization_id", organizationId).in("id", reportIds),
    supabase.from("report_saved_views").select("id, name").eq("organization_id", organizationId).in("id", reportIds),
    facilityIds.length
      ? supabase.from("facilities").select("id, name").eq("organization_id", organizationId).in("id", facilityIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    userIds.length
      ? supabase.from("user_profiles").select("id, full_name").eq("organization_id", organizationId).in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const reports = new Map<string, string>();
  for (const r of [...(templates.data ?? []), ...(packs.data ?? []), ...(savedViews.data ?? [])]) {
    reports.set(r.id, r.name);
  }
  const facilityNames = new Map((facilities.data ?? []).map((f) => [f.id, f.name]));
  const userNames = new Map((users.data ?? []).map((u) => [u.id, u.full_name]));

  const now = new Date();
  return rows.map((row) => describeReportRun(row, { reports, facilities: facilityNames, users: userNames }, now));
}
