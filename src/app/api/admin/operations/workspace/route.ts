import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { WORKSPACE_VIEWS, composeWorkspace, type WorkspaceView } from "@/lib/operations/workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * COL-148 staff work surface (HFO-10): one site's Today, Upcoming or History,
 * composed on the server from the managed occurrences, their governing
 * rules, effective receipts, open issue counts and (Today) legacy tasks. Read
 * through the session so the current subject and site authority governs
 * every row; `mine=1` narrows to the actor's recorder role without hiding
 * unassigned work.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const facilityId = params.get("facility_id");
  const view = params.get("view") ?? "today";
  const cursor = params.get("cursor");
  const mine = params.get("mine");
  if (!facilityId || !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  if (!(WORKSPACE_VIEWS as readonly string[]).includes(view)) return NextResponse.json({ error: "view must be today, upcoming or history" }, { status: 400 });
  if (cursor !== null && (view !== "history" || cursor.length === 0)) return NextResponse.json({ error: "cursor applies to the history view" }, { status: 400 });
  if (mine !== null && mine !== "1" && mine !== "0") return NextResponse.json({ error: "mine must be 1 or 0" }, { status: 400 });
  // Facility selection is not an authorization boundary; the current site grant is.
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  const outcome = await composeWorkspace({ actor: auth.actor, facilityId, view: view as WorkspaceView, cursor, mine: mine === "1" });
  if (outcome.status !== 200) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(outcome.body);
}
