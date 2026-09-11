import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { currentReceiptFields, mapReceiptRpcError, payloadProblem } from "@/lib/operations/receipts";
import { SOURCE_EVENT_RECONCILE_ROLES, isSourceDeliveryOutcome, presentSourceOutcome, reconcileSourceEventBodySchema } from "@/lib/operations/source-links";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reconcile one pending source delivery (COL-147): retry the predicate
 * against the live source, select one of its current candidates, or dismiss
 * with a reason. The database requires the expected event revision, the
 * broad operations scope at the site and, for a chosen occurrence, current
 * recording authority; it never widens the predicate.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Source delivery not found", outcome: "missing" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_EVENT_RECONCILE_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = reconcileSourceEventBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key, the expected revision and an action", outcome: "validation" }, { status: 400 });
  }
  // The session read hides deliveries for sites, occurrences and subjects without a current grant.
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("operation_source_events" as never)
    .select("id, facility_id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.source-events.reconcile", readError, { action: "read", eventId: id });
    return NextResponse.json({ error: "Source delivery unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const target = row as { id: string; facility_id: string; organization_id: string } | null;
  if (!target || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Source delivery not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "reconcile_operation_source_event_review" as never,
    { p_event: id, p_request_key: parsed.data.request_key, p_expected_revision: parsed.data.expected_revision, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.source-events.reconcile", error, { action: "rpc", eventId: id });
    const mapped = mapReceiptRpcError(error, "reconcile");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isSourceDeliveryOutcome(result)) {
    return NextResponse.json({ error: "Reconcile could not be confirmed; re-read the delivery before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json(presentSourceOutcome(result));
}
