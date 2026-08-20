/**
 * Canonical T1 dashboard shell contract for `/api/v2/dashboards/[id]`.
 *
 * This module intentionally does not ship deterministic facility metrics. Live
 * rows are supplied by `loadV2Dashboard()` from `haven.vw_v2_facility_rollup`.
 * When a live source is empty or unavailable, the UI renders honest empty/gap
 * states instead of old COL sample data.
 */
import type { ActionQueueItem } from "@/design-system/components/ActionQueue";
import type { AlertItem } from "@/design-system/components/PriorityAlertStack";
import type { KPITileProps } from "@/design-system/components/KPITile";
import type { PanelProps } from "@/design-system/components/Panel";
import type { ThresholdMap } from "@/design-system/components/DataTable";

import {
  V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL,
  V2_DASHBOARD_KPI_GAP_VALUES,
} from "./v2/v2-dashboard-kpi-display-copy";

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
 * returns NULL where source aggregates aren't populated yet. UI renders NULL as
 * named Quiet Operator gaps instead of fake numbers or silent em dashes.
 */
export type V2DashboardTableRow = {
  id: string;
  name: string;
  occupancyPct: number | null;
  laborCostPct: number | null;
  openIncidents: number | null;
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

const LIVE_SOURCE_PENDING = "Live source pending; no value is shown yet.";

const SHARED_THRESHOLDS: ThresholdMap = {
  occupancy_pct: { target: 90, direction: "up", warningBandPct: 10 },
  labor_cost_pct: { target: 35, direction: "down", warningBandPct: 10 },
  open_incidents: { target: 0, direction: "down", warningBandPct: 200 },
  survey_readiness_pct: { target: 85, direction: "up", warningBandPct: 10 },
};

const KPI_LABELS: Record<
  V2DashboardId,
  readonly [string, string, string, string, string, string]
> = {
  "command-center": [
    "Open alerts",
    "eMAR variance",
    "Falls (7d)",
    "Survey window",
    "Active admits",
    V2_DASHBOARD_FAMILY_PORTAL_NOTES_LABEL,
  ],
  "executive-intelligence": [
    "Occupancy",
    "Labor cost",
    "Revenue (TTM)",
    "Margin",
    "NPS",
    "Risk score",
  ],
  "clinical-quality": [
    "eMAR variance",
    "Falls per 1k bed-days",
    "Pressure injuries",
    "Readmissions",
    "Care plans on time",
    "Infection rate",
  ],
  "rounding-operations": [
    "Rounds today",
    "Rounds overdue",
    "Watches active",
    "Escalations open",
    "Plan changes today",
    "Integrity score",
  ],
};

const PANEL_TITLES: Record<
  V2DashboardId,
  readonly [string, string, string, string]
> = {
  "command-center": [
    "Census trend",
    "Top movers",
    "Compliance burndown",
    "Recent acknowledgements",
  ],
  "executive-intelligence": [
    "Occupancy trend",
    "Labor cost burndown",
    "Revenue mix",
    "Top-of-mind alerts",
  ],
  "clinical-quality": [
    "eMAR variance trend",
    "Fall heatmap by wing",
    "Pressure-injury matrix",
    "Readmission cohorts",
  ],
  "rounding-operations": [
    "Round cadence by wing",
    "Watches expiring soon",
    "Escalation pipeline",
    "Top issues raised",
  ],
};

const TITLES: Record<V2DashboardId, { title: string; subtitle: string }> = {
  "command-center": {
    title: "Command Center",
    subtitle: "Portfolio rollup · live sources only",
  },
  "executive-intelligence": {
    title: "Executive Intelligence",
    subtitle: "Owner overview · live sources only",
  },
  "clinical-quality": {
    title: "Quality Metrics",
    subtitle: "Clinical KPIs · live sources only",
  },
  "rounding-operations": {
    title: "Smart Rounding",
    subtitle: "Live rounding ops · live sources only",
  },
};

function buildKpis(
  id: V2DashboardId,
  labels: readonly [string, string, string, string, string, string],
): V2DashboardPayload["kpis"] {
  const gapValues = V2_DASHBOARD_KPI_GAP_VALUES[id];
  return labels.map((label, index) => ({
    label,
    value: gapValues[index],
    info: LIVE_SOURCE_PENDING,
  })) as V2DashboardPayload["kpis"];
}

function buildPanels(
  titles: readonly [string, string, string, string],
): V2DashboardPayload["panels"] {
  return titles.map((title) => ({
    title,
    subtitle: LIVE_SOURCE_PENDING,
    children: null,
  })) as V2DashboardPayload["panels"];
}

function buildPayload(id: V2DashboardId): V2DashboardPayload {
  return {
    id,
    title: TITLES[id].title,
    subtitle: TITLES[id].subtitle,
    generatedAt: "",
    kpis: buildKpis(id, KPI_LABELS[id]),
    panels: buildPanels(PANEL_TITLES[id]),
    alerts: [],
    actionQueue: [],
    tableRows: [],
    thresholds: SHARED_THRESHOLDS,
  };
}

const PAYLOADS: Record<V2DashboardId, V2DashboardPayload> = {
  "command-center": buildPayload("command-center"),
  "executive-intelligence": buildPayload("executive-intelligence"),
  "clinical-quality": buildPayload("clinical-quality"),
  "rounding-operations": buildPayload("rounding-operations"),
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
