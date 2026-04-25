import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isV2ListId, loadV2List } from "@/lib/v2-lists";

/**
 * `GET /api/v2/lists/[listId]` — unified list endpoint for W2 P0 lists.
 *
 * `listId ∈ { residents, incidents, alerts, admissions }`. Reads come from
 * `haven.vw_v2_<list>_list` views under the caller's RLS. Falls back to a
 * minimal fixture when the view returns 0 rows or errors so the UI always
 * renders something.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  if (!isV2ListId(listId)) {
    return NextResponse.json({ error: "Unknown list id" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const load = await loadV2List(listId);
  return NextResponse.json(load, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
