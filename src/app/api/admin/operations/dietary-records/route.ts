import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { readAllOperationRows } from "@/lib/operations/read-all";
import { currentReceiptFields, mapReceiptRpcError, payloadProblem } from "@/lib/operations/receipts";
import {
  DIETARY_RECORD_SELECT,
  SOURCE_RECORD_ROLES,
  isSourceRecordOutcome,
  listDietaryRecordsQuerySchema,
  presentSourceRecordOutcome,
  recordDietaryRecordBodySchema,
} from "@/lib/operations/source-records";
import { logError } from "@/lib/observability/logger";

/**
 * Record one dietary record (COL-159): a meal-level substitution (service
 * date and meal period, no resident), a dietitian menu approval (labels
 * stored verbatim, optional vault reference) or the emergency food supply
 * check. The database refuses the wrong kind shape, a substitution whose
 * instant is not on its service date, a meal service of another date or
 * period and a failed substitution or approval by name, writes the record
 * final and delivers it through the COL-147 mechanism in the same
 * transaction. Whether it links is the delivery's verdict, returned as read.
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
  const parsed = recordDietaryRecordBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key and a dietary record", outcome: "validation" }, { status: 400 });
  }
  if (!(await actorCanAccessFacility(auth.actor, parsed.data.payload.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "record_dietary_record_review" as never,
    { p_request_key: parsed.data.request_key, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.dietary-records.record", error, { action: "rpc", recordKind: parsed.data.payload.record_kind });
    const mapped = mapReceiptRpcError(error, "source_record");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isSourceRecordOutcome(result)) {
    return NextResponse.json({ error: "Dietary record could not be confirmed; check the dietary record list before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json(presentSourceRecordOutcome(result));
}

/**
 * Dietary records at one site, read through the session so current site
 * authority governs every row; paged to exhaustion with the exact total.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_RECORD_ROLES });
  if ("response" in auth) return auth.response;
  const query = listDietaryRecordsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return NextResponse.json({ error: payloadProblem(query.error) ?? "Provide a facility_id", outcome: "validation" }, { status: 400 });
  if (!(await actorCanAccessFacility(auth.actor, query.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const { data, error } = await readAllOperationRows<Record<string, unknown>>(() => {
    let builder = auth.actor.currentActor.client
      .from("dietary_records" as never)
      .select(DIETARY_RECORD_SELECT)
      .eq("organization_id", auth.actor.organizationId)
      .eq("facility_id", query.data.facility_id);
    if (query.data.kind) builder = builder.eq("record_kind", query.data.kind);
    if (query.data.voided === "true") builder = builder.not("voided_at", "is", null);
    if (query.data.voided === "false") builder = builder.is("voided_at", null);
    return builder.order("performed_at", { ascending: false }).order("id", { ascending: true });
  });
  if (error) {
    logError("admin.operations.dietary-records.list", error, { action: "list", facilityId: query.data.facility_id });
    return NextResponse.json({ error: "Dietary records unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const records = data ?? [];
  return NextResponse.json({ records, total: records.length });
}
