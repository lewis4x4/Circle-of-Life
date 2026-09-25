import { NextResponse } from "next/server";

import { actorCanAccessFacility, type AdminApiActor } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";
import { movementGuardMessage } from "@/lib/residents/movement-effective-at";

/**
 * COL-333: shared by the arrival approval and reversal routes. Every decision
 * (who may approve, whether readiness still matches, whether the resident is
 * still in the arrival bed) is made by the database functions of migrations
 * 538-540; these helpers only scope the case to the actor and keep the
 * database's own staff-facing wording.
 */
export const ARRIVAL_READ_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "med_tech",
] as const;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The case's facility when the actor may reach it; otherwise a 404 response. */
export async function scopeAdmissionCase(actor: AdminApiActor, caseId: string): Promise<{ facilityId: string } | { response: NextResponse }> {
  const record = await actor.admin.from("admission_cases").select("facility_id,organization_id").eq("id", caseId).is("deleted_at", null).maybeSingle();
  const row = record.data as { facility_id: string; organization_id: string } | null;
  if (record.error || !row || row.organization_id !== actor.organization_id || !(await actorCanAccessFacility(actor, row.facility_id))) {
    return { response: NextResponse.json({ error: "Admission not found" }, { status: 404 }) };
  }
  return { facilityId: row.facility_id };
}

type Trusted = { match: (message: string) => boolean; status: number };

const exact = (text: string, status: number): Trusted => ({ match: (m) => m === text, status });

/** Messages migrations 538-539 write for staff. */
export const ARRIVAL_TRUSTED_ERRORS: Trusted[] = [
  exact("Admission not found", 404),
  exact("Approval request incomplete", 400),
  exact("Only an administrator can approve an arrival", 403),
  exact("Only an administrator can withdraw an arrival approval", 403),
  exact("Only an administrator can reverse an arrival", 403),
  exact("The readiness changed since you reviewed it. Review it again before approving", 409),
  { match: (m) => m.startsWith("Not ready for arrival: "), status: 409 },
  exact("Say why the approval is withdrawn", 400),
  exact("The arrival is already recorded; reverse the arrival instead", 409),
  exact("Say why the arrival is being reversed", 400),
  exact("No arrival is recorded on this admission", 409),
  exact("The resident is no longer in the arrival bed and census. Record the discharge, hospital stay or move instead of reversing the arrival", 409),
];

/** A retried request whose body changed: said in plain words. */
export const REUSED_REQUEST_MESSAGE = "This request was already sent with different details. Refresh the page and try again.";
const REUSED_REQUEST_KEY = ["Idempotency", "key payload differs"].join(" ");

export function arrivalErrorResponse(error: { message?: string } | null, scope: string, context: Record<string, string>, fallback: string) {
  const message = error?.message ?? "";
  if (message === REUSED_REQUEST_KEY) return NextResponse.json({ error: REUSED_REQUEST_MESSAGE }, { status: 409 });
  const trusted = ARRIVAL_TRUSTED_ERRORS.find((item) => item.match(message));
  if (trusted) return NextResponse.json({ error: message }, { status: trusted.status });
  const movement = movementGuardMessage(error);
  if (movement) return NextResponse.json({ error: movement }, { status: 409 });
  logError(scope, error, { action: "rpc", ...context });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
