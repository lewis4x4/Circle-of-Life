import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { loadV2Dashboard } from "@/lib/v2-dashboard-loader";
import { isV2DashboardId } from "@/lib/v2-dashboards";

/**
 * `GET /api/v2/dashboards/[id]` — returns a T1Dashboard payload by id.
 *
 * Reads live facility rows through `loadV2Dashboard`. If the live rollup view is
 * empty or unavailable, the response contains an empty dashboard shell and a
 * rowsSource marker; it never substitutes deterministic fixture rows.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!isV2DashboardId(id)) {
    return NextResponse.json({ error: "Unknown dashboard id" }, { status: 404 });
  }

  const load = await loadV2Dashboard(id, new URL(request.url).searchParams);
  if (!load) {
    return NextResponse.json({ error: "Unknown dashboard id" }, { status: 404 });
  }

  return NextResponse.json({
    ...load.payload,
    rowsSource: load.rowsSource,
    facilities: load.facilities,
    orgFacilityCount: load.orgFacilityCount,
    tablePagination: load.tablePagination,
  }, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
