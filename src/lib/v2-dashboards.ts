/**
 * Canonical T1 dashboard payload contract for `/api/v2/dashboards/[id]`.
 *
 * S8 ships deterministic fixtures so the four W1 pages can render via T1 with
 * stable snapshots. The Supabase view migrations 211–214 (S8 follow-up) will
 * replace this fixture surface with live, scope-aware reads from
 * `haven.vw_v2_<dashboard>_*` views per UI-V2-DESIGN-SYSTEM §9 W1 gate.
 */
import type { ActionQueueItem } from "@/design-system/components/ActionQueue";
import type { AlertItem } from "@/design-system/components/PriorityAlertStack";
import type { KPITileProps } from "@/design-system/components/KPITile";
import type { PanelProps } from "@/design-system/components/Panel";
import type { ThresholdMap } from "@/design-system/components/DataTable";

export type V2DashboardId =
  | "command-center"
  | "executive-intelligence"
  | "clinical-quality"
  | "rounding-operations";

export const V2_DASHBOARD_IDS: readonly V2DashboardId[] = [
  "command-center",
  "executive-intelligence",
  "clinical-quality",
  "rounding-operations",
] as const;

/** Row shape that all four W1 dashboard tables share — facility-level rollup.
 *
 * Numeric metrics are nullable: the live view (`haven.vw_v2_facility_rollup`)
 * returns NULL where source aggregates aren't populated yet (e.g.,
 * `occupancy_pct`, `labor_cost_pct`, `survey_readiness_pct` while their owning
 * modules are still in flight). UI renders NULL as "—" so consumers see honest
 * gaps instead of fake numbers.
 */
export type V2DashboardTableRow = {
  id: string;
  name: string;
  occupancyPct: number | null;
  laborCostPct: number | null;
  openIncidents: number;
  surveyReadinessPct: number | null;
};

export type V2DashboardPayload = {
  id: V2DashboardId;
  title: string;
  subtitle: string;
  generatedAt: string;
  kpis: [
    KPITileProps,
    KPITileProps,
    KPITileProps,
    KPITileProps,
    KPITileProps,
    KPITileProps,
  ];
  panels: [PanelProps, PanelProps, PanelProps, PanelProps];
  alerts: AlertItem[];
  actionQueue: ActionQueueItem[];
  tableRows: V2DashboardTableRow[];
  thresholds: ThresholdMap;
};

const FIXED_GENERATED_AT = "2026-04-25T01:00:00-04:00";

const SHARED_FACILITIES: V2DashboardTableRow[] = [
  { id: "oakridge", name: "Oakridge ALF", occupancyPct: 92, laborCostPct: 32, openIncidents: 1, surveyReadinessPct: 88 },
  { id: "homewood", name: "Homewood Lodge", occupancyPct: 70, laborCostPct: 41, openIncidents: 4, surveyReadinessPct: 62 },
  { id: "plantation", name: "Plantation", occupancyPct: 99, laborCostPct: 28, openIncidents: 0, surveyReadinessPct: 95 },
  { id: "rising-oaks", name: "Rising Oaks", occupancyPct: 86, laborCostPct: 36, openIncidents: 2, surveyReadinessPct: 80 },
  { id: "grande-cypress", name: "Grande Cypress", occupancyPct: 64, laborCostPct: 47, openIncidents: 6, surveyReadinessPct: 51 },
];

const SHARED_THRESHOLDS: ThresholdMap = {
  occupancy_pct: { target: 90, direction: "up", warningBandPct: 10 },
  labor_cost_pct: { target: 35, direction: "down", warningBandPct: 10 },
  open_incidents: { target: 0, direction: "down", warningBandPct: 200 },
  survey_readiness_pct: { target: 85, direction: "up", warningBandPct: 10 },
};

const COMMAND_CENTER: V2DashboardPayload = {
  id: "command-center",
  title: "Command Center",
  subtitle: "Portfolio rollup · last 24 hours",
  generatedAt: FIXED_GENERATED_AT,
  kpis: [
    { label: "Open alerts", value: 7, info: "High + medium severity unacked", tone: "warning" },
    {
      label: "eMAR variance",
      value: 14,
      unit: "%",
      tone: "danger",
      info: "Missed/late doses ÷ scheduled",
      trend: { direction: "up", value: 3, unit: "pp", period: "vs prior 7d", goodDirection: "down" },
    },
    {
      label: "Falls (7d)",
      value: 5,
      info: "Reported falls portfolio-wide last 7 days",
      tone: "warning",
    },
    {
      label: "Survey window",
      value: 21,
      unit: "days",
      tone: "regulatory",
      info: "Days until next AHCA 59A-36 survey window",
    },
    { label: "Active admits", value: 4, info: "Admits pending move-in within 7 days" },
    {
      label: "Family msgs awaiting reply",
      value: 8,
      info: "Family Portal threads with unread admin replies",
      tone: "warning",
    },
  ],
  panels: [
    { title: "Census trend", children: null },
    { title: "Top movers", children: null },
    { title: "Compliance burndown", children: null },
    { title: "Recent acknowledgements", children: null },
  ],
  alerts: [
    {
      id: "cc-1",
      severity: "high",
      title: "Fall with injury",
      facilityId: "oakridge",
      organizationId: "col",
      facilityName: "Oakridge ALF",
      body: "Resident fall in Hallway A; suspected hip injury.",
      openedAt: "2026-04-24T15:42:00-04:00",
      status: "new",
      detailsHref: "/admin/incidents/cc-1",
    },
  ],
  actionQueue: [
    { id: "care", label: "Care plan reviews due", count: 5, href: "/admin/care-plans/reviews-due" },
    { id: "certs", label: "Certifications expiring", count: 3, href: "/admin/certifications" },
    { id: "incidents", label: "High-severity incidents unacked", count: 1, href: "/admin/incidents" },
  ],
  tableRows: SHARED_FACILITIES,
  thresholds: SHARED_THRESHOLDS,
};

const EXECUTIVE: V2DashboardPayload = {
  id: "executive-intelligence",
  title: "Executive Intelligence",
  subtitle: "Owner overview · YTD",
  generatedAt: FIXED_GENERATED_AT,
  kpis: [
    {
      label: "Occupancy",
      value: 92,
      unit: "%",
      info: "Census ÷ licensed beds (portfolio rollup)",
      trend: { direction: "up", value: 1.8, unit: "pp", period: "vs prior 7d", goodDirection: "up" },
    },
    {
      label: "Labor cost",
      value: 36,
      unit: "%",
      info: "Labor ÷ revenue, weekly",
      tone: "warning",
      trend: { direction: "up", value: 0.6, unit: "pp", period: "vs prior 7d", goodDirection: "down" },
    },
    {
      label: "Revenue (TTM)",
      value: "$14.2M",
      info: "Trailing twelve months across portfolio",
    },
    {
      label: "Margin",
      value: 18,
      unit: "%",
      info: "Operating margin TTM",
      trend: { direction: "down", value: 0.4, unit: "pp", period: "QoQ", goodDirection: "up" },
    },
    {
      label: "NPS",
      value: 68,
      info: "Family NPS rolling 30d",
      trend: { direction: "down", value: 4, unit: "pts", period: "MoM", goodDirection: "up" },
    },
    {
      label: "Risk score",
      value: 72,
      info: "Composite portfolio risk index (lower = healthier)",
      tone: "warning",
    },
  ],
  panels: [
    { title: "Occupancy trend", children: null },
    { title: "Labor cost burndown", children: null },
    { title: "Revenue mix", children: null },
    { title: "Top-of-mind alerts", children: null },
  ],
  alerts: [],
  actionQueue: [
    { id: "exec-quarterly", label: "Q2 board pack", count: 1, href: "/admin/executive/reports" },
    { id: "exec-bench", label: "Benchmark review", count: 2, href: "/admin/executive/benchmarks" },
  ],
  tableRows: SHARED_FACILITIES,
  thresholds: SHARED_THRESHOLDS,
};

const QUALITY: V2DashboardPayload = {
  id: "clinical-quality",
  title: "Quality Metrics",
  subtitle: "Clinical KPIs · last 30 days",
  generatedAt: FIXED_GENERATED_AT,
  kpis: [
    {
      label: "eMAR variance",
      value: 14,
      unit: "%",
      tone: "danger",
      info: "Missed/late doses ÷ scheduled",
    },
    {
      label: "Falls per 1k bed-days",
      value: 6.2,
      info: "Resident falls per 1,000 bed-days, trailing 30d",
      tone: "warning",
    },
    {
      label: "Pressure injuries",
      value: 1.1,
      info: "New stage ≥2 pressure injuries per 1k bed-days",
    },
    {
      label: "Readmissions",
      value: 12,
      unit: "%",
      info: "30-day hospital readmissions for Medicare residents",
      tone: "warning",
    },
    {
      label: "Care plans on time",
      value: 94,
      unit: "%",
      info: "Care plans signed within 14d of admit (FAC 59A-36)",
    },
    {
      label: "Infection rate",
      value: 2.4,
      unit: "%",
      info: "Active infections per resident-month",
    },
  ],
  panels: [
    { title: "eMAR variance trend", children: null },
    { title: "Fall heatmap by wing", children: null },
    { title: "Pressure-injury matrix", children: null },
    { title: "Readmission cohorts", children: null },
  ],
  alerts: [
    {
      id: "q-1",
      severity: "medium",
      title: "eMAR variance trending up",
      facilityId: "homewood",
      organizationId: "col",
      facilityName: "Homewood Lodge",
      body: "3 missed doses in 24h on Resident A.",
      openedAt: "2026-04-24T14:11:00-04:00",
      status: "action",
      detailsHref: "/admin/medications/errors",
    },
  ],
  actionQueue: [
    { id: "qa-cap", label: "QAPI corrective actions due", count: 2, href: "/admin/quality" },
    { id: "qa-rev", label: "Care plan reviews", count: 5, href: "/admin/care-plans/reviews-due" },
  ],
  tableRows: SHARED_FACILITIES,
  thresholds: SHARED_THRESHOLDS,
};

const ROUNDING: V2DashboardPayload = {
  id: "rounding-operations",
  title: "Smart Rounding",
  subtitle: "Live rounding ops · today",
  generatedAt: FIXED_GENERATED_AT,
  kpis: [
    { label: "Rounds today", value: 142, info: "Completed rounds across portfolio today" },
    {
      label: "Rounds overdue",
      value: 3,
      info: "Rounds past their scheduled window",
      tone: "warning",
    },
    {
      label: "Watches active",
      value: 11,
      info: "Active resident watches (post-fall, post-discharge, etc.)",
    },
    {
      label: "Escalations open",
      value: 1,
      info: "Escalations awaiting clinical review",
      tone: "danger",
    },
    { label: "Plan changes today", value: 4, info: "Care-plan revisions captured during rounds today" },
    {
      label: "Integrity score",
      value: 96,
      unit: "%",
      info: "Rounding-record completeness score (last 24h)",
    },
  ],
  panels: [
    { title: "Round cadence by wing", children: null },
    { title: "Watches expiring soon", children: null },
    { title: "Escalation pipeline", children: null },
    { title: "Top issues raised", children: null },
  ],
  alerts: [
    {
      id: "r-1",
      severity: "high",
      title: "Rounding overdue: Wing C",
      facilityId: "homewood",
      organizationId: "col",
      facilityName: "Homewood Lodge",
      body: "Last completed round 3h ago on Wing C; threshold = 2h.",
      openedAt: "2026-04-24T15:00:00-04:00",
      status: "new",
      detailsHref: "/admin/rounding/escalations",
    },
  ],
  actionQueue: [
    { id: "round-watch", label: "Watches expiring today", count: 4, href: "/admin/rounding/watches" },
    { id: "round-esc", label: "Escalations awaiting MD", count: 1, href: "/admin/rounding/escalations" },
  ],
  tableRows: SHARED_FACILITIES,
  thresholds: SHARED_THRESHOLDS,
};

const PAYLOADS: Record<V2DashboardId, V2DashboardPayload> = {
  "command-center": COMMAND_CENTER,
  "executive-intelligence": EXECUTIVE,
  "clinical-quality": QUALITY,
  "rounding-operations": ROUNDING,
};

export function getV2DashboardPayload(id: string): V2DashboardPayload | null {
  if (!isV2DashboardId(id)) return null;
  return PAYLOADS[id];
}

export function isV2DashboardId(id: string): id is V2DashboardId {
  return (V2_DASHBOARD_IDS as readonly string[]).includes(id);
}

export function listV2DashboardIds(): readonly V2DashboardId[] {
  return V2_DASHBOARD_IDS;
}
