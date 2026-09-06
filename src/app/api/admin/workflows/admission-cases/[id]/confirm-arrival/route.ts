import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
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
    if (result.error)
        return NextResponse.json({ error: result.error.message }, { status: 409 });
    return NextResponse.json({ residentId: result.data });
}
