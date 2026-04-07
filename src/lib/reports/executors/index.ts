import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchExecutiveKpiSnapshot } from "@/lib/exec-kpi-snapshot";
import type { Database, Json } from "@/types/database";

export type ReportExecutionResult = {
  summary: { key: string; value: string | number | null }[];
  rows: Record<string, string | number | null>[];
};

type ExecuteParams = {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  facilityId: string | null;
  filters?: Json;
};

type Executor = (params: ExecuteParams) => Promise<ReportExecutionResult>;

async function runExecutiveSnapshot(params: ExecuteParams): Promise<ReportExecutionResult> {
  const kpi = await fetchExecutiveKpiSnapshot(
    params.supabase,
    params.organizationId,
    params.facilityId,
  );

  const summary = [
    { key: "occupiedResidents", value: kpi.census.occupiedResidents },
    { key: "licensedBeds", value: kpi.census.licensedBeds },
    { key: "occupancyPct", value: kpi.census.occupancyPct },
    { key: "openInvoices", value: kpi.financial.openInvoicesCount },
    { key: "balanceDueCents", value: kpi.financial.totalBalanceDueCents },
    { key: "openIncidents", value: kpi.clinical.openIncidents },
    { key: "medicationErrorsMtd", value: kpi.clinical.medicationErrorsMtd },
    { key: "openSurveyDeficiencies", value: kpi.compliance.openSurveyDeficiencies },
    { key: "certificationsExpiring30d", value: kpi.workforce.certificationsExpiring30d },
    { key: "activeOutbreaks", value: kpi.infection.activeOutbreaks },
  ];

  return {
    summary,
    rows: summary.map((item) => ({ metric: item.key, value: item.value })),
  };
}

const EXECUTOR_REGISTRY: Record<string, Executor> = {
  "occupancy-census-summary": runExecutiveSnapshot,
  "facility-operating-scorecard": runExecutiveSnapshot,
  "incident-trend-summary": runExecutiveSnapshot,
  "staffing-coverage-by-shift": runExecutiveSnapshot,
  "overtime-labor-pressure": runExecutiveSnapshot,
  "medication-exception-report": runExecutiveSnapshot,
  "resident-assurance-rounding-compliance": runExecutiveSnapshot,
  "ar-aging-summary": runExecutiveSnapshot,
  "training-certification-expiry": runExecutiveSnapshot,
  "survey-readiness-summary": runExecutiveSnapshot,
  "executive-weekly-operating-pack": runExecutiveSnapshot,
};

export async function executeReportTemplate(
  slug: string,
  params: ExecuteParams,
): Promise<ReportExecutionResult> {
  const executor = EXECUTOR_REGISTRY[slug] ?? runExecutiveSnapshot;
  return executor(params);
}
