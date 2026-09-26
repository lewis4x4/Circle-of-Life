import { NextResponse } from "next/server";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { loadAllFacilitiesWorkforce } from "@/lib/workforce/load";

export async function GET() {
  const access = await requireCurrentApiActor({ scope: "workforce", allowedRoles: ["owner", "org_admin", "facility_admin", "manager"] });
  if ("response" in access) return access.response;
  try {
    const snapshot = await loadAllFacilitiesWorkforce(access.actor.client, access.actor.organizationId);
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Workforce could not be loaded. Retry to refresh the source records." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
