import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OCCURRENCE_COMMAND_ROLES, associateOccurrenceBodySchema, isCommandReceipt, mapOccurrenceRpcError } from "@/lib/operations/occurrences";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Explicit, audited association of early, late or unscheduled work with a
 * scheduled occurrence (COL-139). Immutable relation; neither task's status,
 * identity or snapshot changes, and nothing here implies completion.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: OCCURRENCE_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = associateOccurrenceBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide the work task, an association kind, the occurrence revision you read, a reason and a request key" }, { status: 400 });
  }
  // The session read hides occurrences for sites and subjects without a current grant.
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("operation_task_instances" as never)
    .select("id, facility_id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.occurrences.associate", readError, { action: "read", occurrenceId: id });
    return NextResponse.json({ error: "Occurrence unavailable" }, { status: 503 });
  }
  const target = row as { id: string; facility_id: string; organization_id: string } | null;
  if (!target || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Occurrence not found" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "associate_operation_occurrence_review" as never,
    {
      p_occurrence: id,
      p_work: parsed.data.work_task_id,
      p_kind: parsed.data.association_kind,
      p_expected_revision: parsed.data.expected_revision,
      p_reason: parsed.data.reason,
      p_request_key: parsed.data.request_key,
    } as never,
  );
  if (error) {
    logError("admin.operations.occurrences.associate", error, { action: "rpc", occurrenceId: id });
    const mapped = mapOccurrenceRpcError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!isCommandReceipt(data)) return NextResponse.json({ error: "Association could not be confirmed" }, { status: 500 });
  return NextResponse.json({ association: data });
}
