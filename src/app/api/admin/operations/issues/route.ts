import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { ISSUE_SELECT, RECEIPT_COMMAND_ROLES, RECEIPT_VIEW_ROLES, isIssueOutcome, mapReceiptRpcError, payloadProblem, reportIssueBodySchema, withoutRequestHash } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Open issues for a site (COL-142 minimal identity; HFO-14 extends the lifecycle), read through the session. */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: RECEIPT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const facilityId = request.nextUrl.searchParams.get("facility_id");
  const taskId = request.nextUrl.searchParams.get("task_instance_id");
  if (!facilityId || !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is required" }, { status: 400 });
  if (taskId && !UUID.test(taskId)) return NextResponse.json({ error: "task_instance_id is invalid" }, { status: 400 });
  // Facility selection is not an authorization boundary; the current site grant is.
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }
  let query = auth.actor.currentActor.client
    .from("operation_issues" as never)
    .select(ISSUE_SELECT)
    .eq("organization_id", auth.actor.organizationId)
    .eq("facility_id", facilityId);
  if (taskId) query = query.eq("task_instance_id", taskId);
  const { data, error } = await query.order("reported_at", { ascending: false });
  if (error) {
    logError("admin.operations.issues.list", error, { action: "list", facilityId });
    return NextResponse.json({ error: "Issues unavailable" }, { status: 503 });
  }
  return NextResponse.json({ issues: data ?? [] });
}

/**
 * Report a problem or ask for help without pretending the work was performed.
 * Creates an open issue linked to an occurrence or to an activity, site and
 * subject; never changes any occurrence state. Idempotent by request key.
 */
export async function POST(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: RECEIPT_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request", outcome: "validation" }, { status: 400 });
  }
  const parsed = reportIssueBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: payloadProblem(parsed.error) ?? "Provide a request key, an issue kind and a summary for an occurrence or a subject", outcome: "validation" }, { status: 400 });
  }
  const payload = parsed.data.payload;
  let facilityId = payload.facility_id ?? null;
  if (payload.task_instance_id) {
    // The session read hides occurrences for sites and subjects without a current grant.
    const { data: row, error: readError } = await auth.actor.currentActor.client
      .from("operation_task_instances" as never)
      .select("id, facility_id, organization_id")
      .eq("id", payload.task_instance_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (readError) {
      logError("admin.operations.issues.report", readError, { action: "read", taskId: payload.task_instance_id });
      return NextResponse.json({ error: "Occurrence unavailable", outcome: "uncertain" }, { status: 503 });
    }
    const target = row as { id: string; facility_id: string; organization_id: string } | null;
    if (!target || target.organization_id !== auth.actor.organizationId) {
      return NextResponse.json({ error: "Occurrence not found", outcome: "missing" }, { status: 404 });
    }
    facilityId = target.facility_id;
  }
  if (!facilityId || !(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: payload.task_instance_id ? "Occurrence not found" : "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    "report_operation_issue_review" as never,
    { p_request_key: parsed.data.request_key, p_payload: payload } as never,
  );
  if (error) {
    logError("admin.operations.issues.report", error, { action: "rpc", facilityId });
    const mapped = mapReceiptRpcError(error, "issue");
    return NextResponse.json({ error: mapped.error, outcome: mapped.outcome }, { status: mapped.status });
  }
  const result: unknown = data;
  if (!isIssueOutcome(result)) return NextResponse.json({ error: "Issue could not be confirmed", outcome: "uncertain" }, { status: 500 });
  return NextResponse.json({ outcome: "receipt", issue: withoutRequestHash(result.issue), replayed: result.replayed });
}
