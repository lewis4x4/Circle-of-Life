import { NextResponse } from "next/server";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { loadWorkforce } from "@/lib/workforce/load";
export async function GET(request: Request) {
  const access = await requireCurrentApiActor({ scope: "workforce", allowedRoles: ["owner", "org_admin", "facility_admin", "manager"] });
  if ("response" in access) return access.response;
  const facilityId = new URL(request.url).searchParams.get("facility_id");
  if (!facilityId || !/^[0-9a-f-]{36}$/i.test(facilityId)) return NextResponse.json({ error: "Choose a facility." }, { status: 400 });
  const { actor } = access;
  const { data: facility, error } = await actor.client.from("facilities").select("id, name").eq("id", facilityId).eq("organization_id", actor.organizationId).is("deleted_at", null).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not verify facility access." }, { status: 503 });
  if (!facility) return NextResponse.json({ error: "Facility unavailable." }, { status: 403 });
  try {
    return NextResponse.json(await loadWorkforce(actor.client, facility, actor.organizationId), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Workforce could not be loaded. Retry to refresh the source records." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
