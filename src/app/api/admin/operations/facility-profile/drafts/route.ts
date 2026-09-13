import { NextResponse } from "next/server";
import { activityCatalog } from "@/lib/operations/activity-catalog";
import { z } from "zod";
import { requireOperationsActor, revalidateOperationsActor, actorCanAccessFacility } from "@/lib/operations/auth";
import { REQUIREMENT_CENTRAL_ROLES, mapRequirementRpcError } from "@/lib/operations/requirements";
const schema = z.object({ facility_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) }).strict();
export async function POST(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: REQUIREMENT_CENTRAL_ROLES });
  if ("response" in auth) return auth.response;
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || !(await actorCanAccessFacility(current.actor, body.data.facility_id))) return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  const { data, error } = await current.actor.currentActor.client.rpc("prepare_operation_profile_drafts" as never, { p_facility: body.data.facility_id } as never);
  if (error) { const mapped = mapRequirementRpcError(error); return NextResponse.json({ error: mapped.error }, { status: mapped.status }); }
  const value: unknown = data;
  if (!value || typeof value !== "object" || !("results" in value) || !Array.isArray(value.results)) return NextResponse.json({ error: "Draft preparation could not be confirmed; reload before retry" }, { status: 503 });
  const expected = new Set(activityCatalog.entries.flatMap(entry => entry.components.map(component => component.id)));
  const result = value as { results: { activity_id?: unknown }[]; prepared?: unknown; preserved?: unknown; unresolved?: unknown };
  if (result.results.length !== expected.size || !result.results.every(row => typeof row.activity_id === "string" && expected.delete(row.activity_id))
    || ![result.prepared, result.preserved, result.unresolved].every(n => Number.isSafeInteger(n) && Number(n) >= 0)
    || Number(result.prepared) + Number(result.preserved) + Number(result.unresolved) !== result.results.length) return NextResponse.json({ error: "Catalog draft preparation is incomplete; reload before retry" }, { status: 503 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
