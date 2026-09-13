import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";
import { readAllOperationRows } from "@/lib/operations/read-all";
import { payloadProblem } from "@/lib/operations/receipts";
import { DRILL_LOG_SELECT, SOURCE_RECORD_ROLES, listDrillLogsQuerySchema } from "@/lib/operations/source-records";
import { logError } from "@/lib/observability/logger";

/**
 * Drill logs at one site, read through the session so current site authority
 * governs every row (COL-241). This reader exists because the finalize,
 * correct and void commands address one drill log by id: a person cannot act
 * on a draft the legacy form wrote without first seeing it. It reads and
 * nothing else — no state here makes a log final, and a draft row is never
 * presented as satisfying anything. Provider-capped reads are paged to
 * exhaustion; the total is the exact number of rows read, and a failed later
 * page is an explicit failure rather than a shorter list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: SOURCE_RECORD_ROLES });
  if ("response" in auth) return auth.response;
  const query = listDrillLogsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!query.success) return NextResponse.json({ error: payloadProblem(query.error) ?? "Provide a facility_id", outcome: "validation" }, { status: 400 });
  // An unheld site is not distinguishable from a missing one.
  if (!(await actorCanAccessFacility(auth.actor, query.data.facility_id))) {
    return NextResponse.json({ error: "Facility not found", outcome: "missing" }, { status: 404 });
  }
  const { data, error } = await readAllOperationRows<Record<string, unknown>>(() => {
    let builder = auth.actor.currentActor.client
      .from("drill_log" as never)
      .select(DRILL_LOG_SELECT)
      .eq("organization_id", auth.actor.organizationId)
      .eq("facility_id", query.data.facility_id)
      .is("deleted_at", null);
    if (query.data.drill_type) builder = builder.eq("drill_type", query.data.drill_type);
    if (query.data.state === "draft") builder = builder.is("finalized_at", null);
    if (query.data.state === "final") builder = builder.not("finalized_at", "is", null).is("voided_at", null);
    if (query.data.state === "voided") builder = builder.not("voided_at", "is", null);
    return builder.order("drill_date", { ascending: false }).order("drill_time", { ascending: false }).order("id", { ascending: true });
  });
  if (error) {
    logError("admin.operations.drill-logs.list", error, { action: "list", facilityId: query.data.facility_id });
    return NextResponse.json({ error: "Drill logs unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const drill_logs = data ?? [];
  return NextResponse.json({ drill_logs, total: drill_logs.length, drill_type: query.data.drill_type ?? null, state: query.data.state ?? null });
}
