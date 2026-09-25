import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { ARRIVAL_READ_ROLES, UUID, arrivalErrorResponse, scopeAdmissionCase } from "@/lib/admissions/arrival-api";

/**
 * COL-333: reverse an arrival recorded in error (migration 539). One
 * transaction: the reversal record, the resident back to pending admission,
 * the bed held for the admission again, the approval voided, the referral
 * compensated with its own event, and census and finance review notes on the
 * handoff board. Only an administrator (admissions.arrival_approval_roles),
 * with a reason; the database decides.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApiActor({ allowedRoles: ARRIVAL_READ_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const requestId = typeof body?.request_id === "string" ? body.request_id : "";
  if (!reason) return NextResponse.json({ error: "Say why the arrival is being reversed" }, { status: 400 });
  if (!UUID.test(requestId)) return NextResponse.json({ error: "Reversal request incomplete" }, { status: 400 });
  const scope = await scopeAdmissionCase(auth.actor, id);
  if ("response" in scope) return scope.response;
  const { data, error } = await auth.actor.admin.rpc("admission_arrival_reverse" as never, {
    p_case: id, p_actor_id: auth.actor.id, p_reason: reason, p_request_id: requestId,
  } as never);
  if (error) return arrivalErrorResponse(error, "admin.workflows.admission.arrival-reverse", { admissionCaseId: id, facilityId: scope.facilityId }, "The arrival was not reversed. Retry the same request.");
  return NextResponse.json(data);
}
