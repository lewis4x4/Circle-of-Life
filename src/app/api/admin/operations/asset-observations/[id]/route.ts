import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { currentReceiptFields, mapReceiptRpcError, payloadProblem } from "@/lib/operations/receipts";
import { SOURCE_RECORD_ROLES, assetObservationCommandBodySchema, isSourceRecordOutcome, presentSourceRecordOutcome } from "@/lib/operations/source-records";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Correct or void one asset observation (COL-154). A correction restates the
 * record as a new version under the expected version and a reason and is
 * delivered as a COL-147 correction (or, when the asset moved, invalidates
 * the first occurrence's receipt and satisfies the second); a void reverses
 * the source receipt into retained history with an attention row and never
 * closes the issue it opened. The database re-checks site authority and the
 * record's state; a stale expected version is a conflict naming the current
 * one.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Observation not found", outcome: "missing" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_RECORD_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = assetObservationCommandBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key, an action and its payload", outcome: "validation" }, { status: 400 });
  }
  // The session read hides observations at sites without a current grant.
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("asset_observations" as never)
    .select("id, facility_id, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.asset-observations.command", readError, { action: "read", observationId: id });
    return NextResponse.json({ error: "Observation unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const target = row as { id: string; facility_id: string; organization_id: string } | null;
  if (!target || target.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, target.facility_id))) {
    return NextResponse.json({ error: "Observation not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const command = parsed.data;
  const { data, error } =
    command.action === "correct"
      ? await current.actor.currentActor.client.rpc(
          "correct_asset_observation_review" as never,
          { p_id: id, p_request_key: command.request_key, p_expected_version: command.expected_version, p_payload: command.payload } as never,
        )
      : await current.actor.currentActor.client.rpc("void_asset_observation_review" as never, { p_id: id, p_request_key: command.request_key, p_payload: command.payload } as never);
  if (error) {
    logError("admin.operations.asset-observations.command", error, { action: command.action, observationId: id });
    const mapped = mapReceiptRpcError(error, "source_record");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isSourceRecordOutcome(result)) {
    return NextResponse.json({ error: "Observation command could not be confirmed; re-read the observation before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json(presentSourceRecordOutcome(result));
}
