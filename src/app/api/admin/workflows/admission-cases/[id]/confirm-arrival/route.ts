import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";

const TRUSTED_ARRIVAL_ERRORS = new Set([
    "A cancelled or closed admission cannot confirm arrival",
    "Choose an actual arrival date, not a future date",
    "Complete financial, physician-order, bed and rate readiness first",
    "Current Form 1823 and verified evidence are required",
    "Complete resident date of birth and gender before confirming arrival",
    "The selected bed is reserved for another admission",
    "The selected bed is occupied by another resident",
    "The bed is unavailable for arrival",
]);
export async function POST(request: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin", "facility_admin", "manager", "nurse"] });
    if ("response" in auth)
        return auth.response;
    const { actor } = auth;
    const { id } = await params;
    const record = await actor.admin.from("admission_cases").select("facility_id,organization_id").eq("id", id).is("deleted_at", null).maybeSingle();
    if (record.error || !record.data || record.data.organization_id !== actor.organization_id || !(await actorCanAccessFacility(actor, record.data.facility_id)))
        return NextResponse.json({ error: "Admission not found" }, { status: 404 });
    let body: {
        arrival_date?: string;
    };
    try {
        body = await request.json();
    }
    catch {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.arrival_date ?? ""))
        return NextResponse.json({ error: "Choose the actual arrival date" }, { status: 400 });
    const result = await actor.admin.rpc("confirm_admission_arrival_review" as never, { p_case_id: id, p_actor_id: actor.id, p_arrival_date: body.arrival_date } as never);
    if (result.error) {
        logError("admin.workflows.admission.confirm-arrival", result.error, {
            action: "rpc",
            admissionCaseId: id,
            facilityId: record.data.facility_id,
        });
        const error = TRUSTED_ARRIVAL_ERRORS.has(result.error.message)
            ? result.error.message
            : "Arrival could not be confirmed. Review the admission and retry.";
        return NextResponse.json({ error }, { status: 409 });
    }
    return NextResponse.json({ residentId: result.data });
}
