import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getV2DashboardPayload } from "@/lib/v2-dashboards";

/**
 * `GET /api/v2/dashboards/[id]` — returns a T1Dashboard payload by id.
 *
 * S8 surfaces deterministic fixtures so W1 pages can render. Supabase view
 * migrations 211–214 (S8 follow-up) replace the fixture surface with live,
 * scope-aware reads via `haven.vw_v2_<dashboard>_*` views.
 *
 * The auth check stays in place so the route is gated behind a logged-in
 * user even while the body comes from fixtures — this matches the contract
 * the live version will preserve.
 */
export async function GET(
  _request: Request,
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

  const payload = getV2DashboardPayload(id);
  if (!payload) {
    return NextResponse.json({ error: "Unknown dashboard id" }, { status: 404 });
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
