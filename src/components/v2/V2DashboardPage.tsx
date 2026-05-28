import { notFound } from "next/navigation";

import { uiV2 } from "@/lib/flags";
import {
  loadV2Dashboard,
  type V2DashboardLoad,
} from "@/lib/v2-dashboard-loader";
import type { V2DashboardId } from "@/lib/v2-dashboards";
import type { V2PaginationInput } from "@/lib/v2-pagination";

import { W1DashboardClient } from "./W1DashboardClient";

export type V2DashboardPageProps = {
  dashboardId: V2DashboardId;
  searchParams?: Promise<V2PaginationInput> | V2PaginationInput;
};

/**
 * Server-side wrapper used by every W1 P0 dashboard page.
 *
 * - Verifies `NEXT_PUBLIC_UI_V2` is on (otherwise the route should never have
 *   been reached via the proxy rewrite — this is a defense-in-depth check).
 * - Loads the T1 payload + accessible facility list under RLS.
 * - Hands off to `W1DashboardClient` which composes T1Dashboard.
 */
export async function V2DashboardPage({
  dashboardId,
  searchParams,
}: V2DashboardPageProps) {
  if (!uiV2()) notFound();

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const load: V2DashboardLoad | null = await loadV2Dashboard(dashboardId, resolvedSearchParams);
  if (!load) notFound();

  return (
    <W1DashboardClient
      payload={load.payload}
      facilities={load.facilities}
      orgFacilityCount={load.orgFacilityCount}
      auditUpdatedAt={load.generatedAt}
      rowsSource={load.rowsSource}
      tablePagination={load.tablePagination}
    />
  );
}
