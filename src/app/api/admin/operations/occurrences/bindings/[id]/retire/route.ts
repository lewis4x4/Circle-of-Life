import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { BINDING_COMMAND_ROLES, isBindingRecord, mapOccurrenceRpcError, retireBindingBodySchema } from "@/lib/operations/occurrences";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Close an open binding at an explicit time. Occurrences already generated keep their history. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Binding not found" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: BINDING_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = retireBindingBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Provide an effective end time and a reason" }, { status: 400 });
  // The session read hides bindings for sites and subjects without a current grant.
  const { data: binding, error: readError } = await auth.actor.currentActor.client
    .from("operation_activity_bindings" as never)
    .select("id, facility_id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.occurrences.bindings.retire", readError, { action: "read", bindingId: id });
    return NextResponse.json({ error: "Binding unavailable" }, { status: 503 });
  }
  const target = binding as { id: string; facility_id: string; organization_id: string } | null;
  if (!target || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Binding not found" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "retire_operation_binding_review" as never,
    { p_binding: id, p_effective_to: parsed.data.effective_to, p_reason: parsed.data.reason } as never,
  );
  if (error) {
    logError("admin.operations.occurrences.bindings.retire", error, { action: "rpc", bindingId: id });
    const mapped = mapOccurrenceRpcError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!isBindingRecord(data)) return NextResponse.json({ error: "Binding retirement could not be confirmed" }, { status: 500 });
  return NextResponse.json({ binding: data });
}
