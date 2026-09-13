import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { readAllOperationRows } from "@/lib/operations/read-all";
import { currentReceiptFields, mapReceiptRpcError, payloadProblem } from "@/lib/operations/receipts";
import {
  ASSET_OBSERVATION_SELECT,
  SOURCE_RECORD_ROLES,
  isSourceRecordOutcome,
  listAssetObservationsQuerySchema,
  presentSourceRecordOutcome,
  recordAssetObservationBodySchema,
} from "@/lib/operations/source-records";
import { logError } from "@/lib/observability/logger";

/**
 * Record one staff-observed asset observation (COL-154): a generator test, a
 * carbon-monoxide check or an extinguisher currency check against a named
 * asset. The database refuses an automatic self-test or a photo alone by
 * name, applies the late, on-behalf, future and failed-outcome rules up
 * front, writes the record final and delivers it through the COL-147
 * mechanism in the same transaction. Whether it links is the delivery's
 * verdict, returned as read.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_RECORD_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = recordAssetObservationBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key and an observation", outcome: "validation" }, { status: 400 });
  }
  // The claimed site must be one the actor currently holds; an unheld site is not distinguishable from a missing one.
  if (!(await actorCanAccessFacility(auth.actor, parsed.data.payload.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "record_asset_observation_review" as never,
    { p_request_key: parsed.data.request_key, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.asset-observations.record", error, { action: "rpc", observationKind: parsed.data.payload.observation_kind });
    const mapped = mapReceiptRpcError(error, "source_record");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isSourceRecordOutcome(result)) {
    return NextResponse.json({ error: "Observation could not be confirmed; check the observation list before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json(presentSourceRecordOutcome(result));
}

/**
 * Observations at one site, read through the session so current site
 * authority governs every row. Provider-capped reads are paged to
 * exhaustion; the total is the exact number of rows read, and a failed later
 * page is an explicit failure rather than a shorter list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_RECORD_ROLES });
  if ("response" in auth) return auth.response;
  const query = listAssetObservationsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return NextResponse.json({ error: payloadProblem(query.error) ?? "Provide a facility_id", outcome: "validation" }, { status: 400 });
  if (!(await actorCanAccessFacility(auth.actor, query.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const { data, error } = await readAllOperationRows<Record<string, unknown>>(() => {
    let builder = auth.actor.currentActor.client
      .from("asset_observations" as never)
      .select(ASSET_OBSERVATION_SELECT)
      .eq("organization_id", auth.actor.organizationId)
      .eq("facility_id", query.data.facility_id);
    if (query.data.asset_id) builder = builder.eq("asset_id", query.data.asset_id);
    if (query.data.kind) builder = builder.eq("observation_kind", query.data.kind);
    if (query.data.voided === "true") builder = builder.not("voided_at", "is", null);
    if (query.data.voided === "false") builder = builder.is("voided_at", null);
    return builder.order("observed_at", { ascending: false }).order("id", { ascending: true });
  });
  if (error) {
    logError("admin.operations.asset-observations.list", error, { action: "list", facilityId: query.data.facility_id });
    return NextResponse.json({ error: "Observations unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const observations = data ?? [];
  return NextResponse.json({ observations, total: observations.length, asset_id: query.data.asset_id ?? null, kind: query.data.kind ?? null, voided: query.data.voided ?? null });
}
