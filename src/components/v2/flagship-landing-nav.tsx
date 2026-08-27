"use client";

import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";
import { RoundingHubNav } from "@/app/(admin)/admin/rounding/rounding-hub-nav";
import type { V2AnalyticsId } from "@/lib/v2-analytics";
import type { V2DashboardId } from "@/lib/v2-dashboards";
import type { V2ListId } from "@/lib/v2-lists";

/**
 * V2 is the canonical flagship landing (rewrite on unless NEXT_PUBLIC_UI_V2=false).
 * These navs keep the V1 operational boards reachable from the rewritten URL.
 */
export function FlagshipDashboardHeaderNav({
  dashboardId,
}: {
  dashboardId: V2DashboardId;
}) {
  if (dashboardId === "executive-intelligence") return <ExecutiveHubNav />;
  return null;
}

export function FlagshipDashboardBoardNav({
  dashboardId,
}: {
  dashboardId: V2DashboardId;
}) {
  if (dashboardId === "rounding-operations") return <RoundingHubNav />;
  return null;
}

export function FlagshipAnalyticsLandingNav({
  analyticsId,
}: {
  analyticsId: V2AnalyticsId;
}) {
  if (
    analyticsId === "executive-standup" ||
    analyticsId === "executive-reports" ||
    analyticsId === "executive-benchmarks"
  ) {
    return <ExecutiveHubNav />;
  }
  return null;
}

export function FlagshipListLandingNav({ listId }: { listId: V2ListId }) {
  if (listId === "alerts") return <ExecutiveHubNav />;
  return null;
}
