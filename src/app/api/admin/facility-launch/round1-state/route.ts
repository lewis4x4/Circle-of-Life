import { NextResponse } from "next/server";

import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import type { AppRole } from "@/lib/rbac";

// Internal Homewood launch data (legal entities, gates, decisions). It used to sit under
// public/, which Netlify serves from the CDN with nothing in front of it; it is now bundled
// into this handler and released only to the roles that may open /facility-launch.
import round1State from "../../../../../../facility-launch-center/data/homewood-round1-state.json";

export const dynamic = "force-dynamic";

const FACILITY_LAUNCH_ROLES: readonly AppRole[] = ["owner", "org_admin"];

export async function GET() {
  const result = await requireCurrentApiActor({
    allowedRoles: FACILITY_LAUNCH_ROLES,
    scope: "api.admin.facility-launch.round1-state",
  });
  if ("response" in result) return result.response;

  return NextResponse.json(round1State, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
