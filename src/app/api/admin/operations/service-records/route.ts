import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { readAllOperationRows } from "@/lib/operations/read-all";
import { currentReceiptFields, mapReceiptRpcError, payloadProblem } from "@/lib/operations/receipts";
import {
  FACILITY_SERVICE_SELECT,
  SOURCE_RECORD_ROLES,
  isSourceRecordOutcome,
  listFacilityServicesQuerySchema,
  presentSourceRecordOutcome,
  recordFacilityServiceBodySchema,
} from "@/lib/operations/source-records";
import { logError } from "@/lib/observability/logger";

/**
 * Record one facility service (COL-159): an inspection, cleaning or
 * maintenance action on one occasion against the site or a named asset, by
 * a staff member or a site-linked vendor. The database refuses the wrong
 * subject shape, asset type, performer, certificate or instant by name,
 * writes the record final and delivers it through the COL-147 mechanism in
 * the same transaction under the adapter its kind belongs to. A service
 * record never writes an asset's service dates, a building-profile date, a
 * document or a ticket; the stated next-due date is a record column.
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
  const parsed = recordFacilityServiceBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key and a service record", outcome: "validation" }, { status: 400 });
  }
  // The claimed site must be one the actor currently holds; an unheld site is not distinguishable from a missing one.
  if (!(await actorCanAccessFacility(auth.actor, parsed.data.payload.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "record_facility_service_review" as never,
    { p_request_key: parsed.data.request_key, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.service-records.record", error, { action: "rpc", serviceKind: parsed.data.payload.service_kind });
    const mapped = mapReceiptRpcError(error, "source_record");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isSourceRecordOutcome(result)) {
    return NextResponse.json({ error: "Service record could not be confirmed; check the service record list before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json(presentSourceRecordOutcome(result));
}

/**
 * Service records at one site, read through the session so current site
 * authority governs every row. Provider-capped reads are paged to
 * exhaustion; the total is the exact number of rows read, and a failed later
 * page is an explicit failure rather than a shorter list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_RECORD_ROLES });
  if ("response" in auth) return auth.response;
  const query = listFacilityServicesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return NextResponse.json({ error: payloadProblem(query.error) ?? "Provide a facility_id", outcome: "validation" }, { status: 400 });
  if (!(await actorCanAccessFacility(auth.actor, query.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const { data, error } = await readAllOperationRows<Record<string, unknown>>(() => {
    let builder = auth.actor.currentActor.client
      .from("facility_service_records" as never)
      .select(FACILITY_SERVICE_SELECT)
      .eq("organization_id", auth.actor.organizationId)
      .eq("facility_id", query.data.facility_id);
    if (query.data.kind) builder = builder.eq("service_kind", query.data.kind);
    if (query.data.asset_id) builder = builder.eq("asset_id", query.data.asset_id);
    if (query.data.voided === "true") builder = builder.not("voided_at", "is", null);
    if (query.data.voided === "false") builder = builder.is("voided_at", null);
    return builder.order("performed_at", { ascending: false }).order("id", { ascending: true });
  });
  if (error) {
    logError("admin.operations.service-records.list", error, { action: "list", facilityId: query.data.facility_id });
    return NextResponse.json({ error: "Service records unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const records = data ?? [];
  return NextResponse.json({ records, total: records.length });
}
