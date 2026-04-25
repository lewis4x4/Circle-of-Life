import { createClient } from "@/lib/supabase/server";

export type V2AnalyticsId =
  | "executive-standup"
  | "facility-deep-dive"
  | "executive-reports"
  | "executive-benchmarks"
  | "finance-hub"
  | "finance-labor"
  | "finance-revenue";

export const V2_ANALYTICS_IDS: readonly V2AnalyticsId[] = [
  "executive-standup",
  "facility-deep-dive",
  "executive-reports",
  "executive-benchmarks",
  "finance-hub",
  "finance-labor",
  "finance-revenue",
] as const;

export function isV2AnalyticsId(value: string): value is V2AnalyticsId {
  return (V2_ANALYTICS_IDS as readonly string[]).includes(value);
}

export type V2AnalyticsRollupRow = {
  facility_id: string;
  facility_name: string;
  occupancy_pct: number | null;
  open_incidents_count: number;
  risk_score: number | null;
  survey_readiness_pct: number | null;
};

export type V2AnalyticsLoad = {
  id: V2AnalyticsId;
  title: string;
  subtitle: string;
  /** Right-most ID segment for prefix-style routes (e.g., facility deep-dive). */
  contextId?: string;
  rollup: V2AnalyticsRollupRow[];
  generatedAt: string;
  source: "live" | "fixture";
};

const TITLES: Record<
  V2AnalyticsId,
  { title: string; subtitle: string }
> = {
  "executive-standup": {
    title: "Executive standup",
    subtitle: "Last 30 days · trends, alerts, and the day's actions",
  },
  "facility-deep-dive": {
    title: "Facility deep-dive",
    subtitle: "Single-facility analytics across clinical, finance, and compliance",
  },
  "executive-reports": {
    title: "Executive reports",
    subtitle: "Saved board packs and recurring exports",
  },
  "executive-benchmarks": {
    title: "Benchmarks",
    subtitle: "Portfolio percentiles vs. peer cohort",
  },
  "finance-hub": {
    title: "Finance hub",
    subtitle: "Cash, revenue, labor cost, and AR snapshots",
  },
  "finance-labor": {
    title: "Labor analytics",
    subtitle: "Hours, premium pay, agency mix, and overtime trends",
  },
  "finance-revenue": {
    title: "Revenue analytics",
    subtitle: "Census × payer mix × rate schedule rollup",
  },
};

const FIXTURE_ROLLUP: V2AnalyticsRollupRow[] = [
  { facility_id: "fix-1", facility_name: "Oakridge ALF", occupancy_pct: null, open_incidents_count: 7, risk_score: 26, survey_readiness_pct: null },
  { facility_id: "fix-2", facility_name: "Rising Oaks ALF", occupancy_pct: null, open_incidents_count: 0, risk_score: 48, survey_readiness_pct: null },
  { facility_id: "fix-3", facility_name: "Plantation ALF", occupancy_pct: null, open_incidents_count: 0, risk_score: 100, survey_readiness_pct: null },
];

type RollupResult = {
  data: V2AnalyticsRollupRow[] | null;
  error: { message: string } | null;
};

export async function loadV2Analytics(
  id: V2AnalyticsId,
  options: { contextId?: string } = {},
): Promise<V2AnalyticsLoad> {
  const meta = TITLES[id];
  const supabase = await createClient();

  const result = (await supabase
    .schema("haven" as never)
    .from("vw_v2_facility_rollup" as never)
    .select(
      "facility_id, facility_name, occupancy_pct, open_incidents_count, risk_score, survey_readiness_pct",
    )
    .order("facility_name" as never, { ascending: true })) as unknown as RollupResult;

  let rollup: V2AnalyticsRollupRow[] | null = null;
  if (!result.error && Array.isArray(result.data) && result.data.length > 0) {
    rollup = result.data;
    if (id === "facility-deep-dive" && options.contextId) {
      rollup = rollup.filter((row) => row.facility_id === options.contextId);
    }
  }

  return {
    id,
    title: meta.title,
    subtitle: meta.subtitle,
    contextId: options.contextId,
    rollup: rollup ?? FIXTURE_ROLLUP,
    generatedAt: new Date().toISOString(),
    source: rollup ? "live" : "fixture",
  };
}
