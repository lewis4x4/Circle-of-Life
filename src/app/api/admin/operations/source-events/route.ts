import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { readAllOperationRows } from "@/lib/operations/read-all";
import { currentReceiptFields, mapReceiptRpcError, payloadProblem } from "@/lib/operations/receipts";
import {
  SOURCE_EVENT_DELIVER_ROLES,
  SOURCE_EVENT_SELECT,
  SOURCE_EVENT_VIEW_ROLES,
  deliverSourceEventBodySchema,
  isSourceDeliveryOutcome,
  listSourceEventsQuerySchema,
  presentSourceOutcome,
} from "@/lib/operations/source-links";
import { logError } from "@/lib/observability/logger";

/**
 * Deliver one final or voided source record version through the session
 * (COL-147). The database reads the source live through its allowlisted
 * reader, matches activity, site, subject, period and rule, satisfies exactly
 * one occurrence once (or corrects, invalidates, or records a refusal or a
 * pending row), and converges replays and concurrent deliveries on one ledger
 * row. No domain is connected here; the adapter must already be allowlisted
 * by migration.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_EVENT_DELIVER_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = deliverSourceEventBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key and a source record identity", outcome: "validation" }, { status: 400 });
  }
  // The claimed site must be one the actor currently holds; an unheld site is not distinguishable from a missing one.
  if (!(await actorCanAccessFacility(auth.actor, parsed.data.payload.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "deliver_operation_source_event_review" as never,
    { p_request_key: parsed.data.request_key, p_payload: parsed.data.payload } as never,
  );
  if (error) {
    logError("admin.operations.source-events.deliver", error, { action: "rpc", sourceKey: parsed.data.payload.source_key });
    const mapped = mapReceiptRpcError(error, "deliver");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome, ...currentReceiptFields(mapped) }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isSourceDeliveryOutcome(result)) {
    return NextResponse.json({ error: "Source delivery could not be confirmed; check the delivery ledger before retrying", outcome: "uncertain" }, { status: 500 });
  }
  return NextResponse.json(presentSourceOutcome(result));
}

/**
 * The delivery ledger for one site, read through the session so current site,
 * occurrence and subject authority governs every row. Defaults to the rows
 * that need attention (pending reconciliation) unless a state is named.
 * Provider-capped reads are
 * paged to exhaustion; the total is the exact number of rows read, and a
 * failed later page is an explicit failure rather than a shorter list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_EVENT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const query = listSourceEventsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return NextResponse.json({ error: payloadProblem(query.error) ?? "Provide a facility_id", outcome: "validation" }, { status: 400 });
  if (!(await actorCanAccessFacility(auth.actor, query.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  // Without a state filter the list is the pending-reconciliation queue; with one, attention is a filter only when asked for.
  const attention = query.data.attention === undefined ? (query.data.state ? null : true) : query.data.attention === "true";
  const { data, error } = await readAllOperationRows<Record<string, unknown>>(() => {
    let builder = auth.actor.currentActor.client
      .from("operation_source_events" as never)
      .select(SOURCE_EVENT_SELECT)
      .eq("organization_id", auth.actor.organizationId)
      .eq("facility_id", query.data.facility_id);
    if (attention !== null) builder = builder.eq("attention", attention);
    if (query.data.state) builder = builder.eq("state", query.data.state);
    return builder.order("delivered_at", { ascending: true }).order("id", { ascending: true });
  });
  if (error) {
    logError("admin.operations.source-events.list", error, { action: "list", facilityId: query.data.facility_id });
    return NextResponse.json({ error: "Source deliveries unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const events = (data ?? []).map((row) => {
    const { request_hash: _hash, ...rest } = row as Record<string, unknown> & { request_hash?: unknown };
    void _hash;
    return rest;
  });
  return NextResponse.json({ events, total: events.length, attention, state: query.data.state ?? null });
}
