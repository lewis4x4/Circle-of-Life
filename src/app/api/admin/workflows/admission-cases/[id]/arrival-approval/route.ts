import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { ARRIVAL_READ_ROLES, UUID, arrivalErrorResponse, scopeAdmissionCase } from "@/lib/admissions/arrival-api";

/**
 * COL-333: an arrival needs an administrator's approval of the current
 * readiness (migration 538). GET reads the readiness, the approval in force
 * and, after arrival, the receiving handoff and outstanding commitments (540).
 * POST approves the readiness fingerprint the approver was shown; DELETE
 * withdraws the approval with a reason. Who may approve is decided in the
 * database by admissions.arrival_approval_roles.
 */
type Params = { params: Promise<{ id: string }> };

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdminApiActor({ allowedRoles: ARRIVAL_READ_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const scope = await scopeAdmissionCase(auth.actor, id);
  if ("response" in scope) return scope.response;
  const { data, error } = await auth.actor.admin.rpc("admission_arrival_status" as never, { p_case: id, p_actor_id: auth.actor.id } as never);
  if (error) return arrivalErrorResponse(error, "admin.workflows.admission.arrival-status", { admissionCaseId: id, facilityId: scope.facilityId }, "The arrival status could not be read.");
  return NextResponse.json(data);
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdminApiActor({ allowedRoles: ARRIVAL_READ_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readBody(request);
  const fingerprint = typeof body?.fingerprint === "string" ? body.fingerprint : "";
  const requestId = typeof body?.request_id === "string" ? body.request_id : "";
  if (!/^[0-9a-f]{32}$/.test(fingerprint) || !UUID.test(requestId)) return NextResponse.json({ error: "Approval request incomplete" }, { status: 400 });
  const scope = await scopeAdmissionCase(auth.actor, id);
  if ("response" in scope) return scope.response;
  const { data, error } = await auth.actor.admin.rpc("admission_arrival_approve" as never, {
    p_case: id, p_actor_id: auth.actor.id, p_expected_fingerprint: fingerprint, p_request_id: requestId,
  } as never);
  if (error) return arrivalErrorResponse(error, "admin.workflows.admission.arrival-approve", { admissionCaseId: id, facilityId: scope.facilityId }, "The approval was not recorded. Retry the same approval.");
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireAdminApiActor({ allowedRoles: ARRIVAL_READ_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await readBody(request);
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const requestId = typeof body?.request_id === "string" ? body.request_id : "";
  if (!reason) return NextResponse.json({ error: "Say why the approval is withdrawn" }, { status: 400 });
  if (!UUID.test(requestId)) return NextResponse.json({ error: "Approval request incomplete" }, { status: 400 });
  const scope = await scopeAdmissionCase(auth.actor, id);
  if ("response" in scope) return scope.response;
  const { data, error } = await auth.actor.admin.rpc("admission_arrival_approval_withdraw" as never, {
    p_case: id, p_actor_id: auth.actor.id, p_reason: reason, p_request_id: requestId,
  } as never);
  if (error) return arrivalErrorResponse(error, "admin.workflows.admission.arrival-withdraw", { admissionCaseId: id, facilityId: scope.facilityId }, "The approval was not withdrawn. Retry the same request.");
  return NextResponse.json(data);
}
