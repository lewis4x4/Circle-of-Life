import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { assertRoundingFacilityAccess, getAccessibleRoundingFacilityIds, getRoundingRequestContext, isRoundingManagerRole, revalidateRoundingRequestContext } from "@/lib/rounding/auth";

type Action = "assign" | "start_review" | "resolve" | "dismiss";

type Body = {
  action?: Action;
  note?: string;
  assignedStaffId?: string | null;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getRoundingRequestContext({ managerOnly: true });
  if ("response" in auth) return auth.response;

  let { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can manage integrity flags" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const note = body.note?.trim() ?? "";
  if (note.length > 2000) {
    return NextResponse.json({ error: "note must be 2000 characters or fewer" }, { status: 400 });
  }

  const flagId = (await params).id;
  const accessibleFacilityIds = await getAccessibleRoundingFacilityIds(context);
  const { data: flag, error: flagError } = await context.admin
    .from("resident_observation_integrity_flags")
    .select("id, organization_id, facility_id, status")
    .eq("id", flagId)
    .eq("organization_id", context.organizationId)
    .in("facility_id", accessibleFacilityIds)
    .is("deleted_at", null)
    .maybeSingle();

  if (flagError) {
    logError("rounding.integrity-flags.lookup", flagError, { flagId });
  }
  if (flagError || !flag) {
    return NextResponse.json({ error: "Integrity flag not found" }, { status: 404 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, flag.facility_id);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const patch: Record<string, string | null> = {
    updated_by: context.userId,
    reviewed_by: context.userId,
  };

  switch (action) {
    case "assign": {
      const assignedStaffId = body.assignedStaffId?.trim() || null;
      if (assignedStaffId) {
        const { data: assignee, error: assigneeError } = await context.admin
          .from("staff")
          .select("id")
          .eq("id", assignedStaffId)
          .eq("facility_id", flag.facility_id)
          .eq("organization_id", context.organizationId)
          .eq("employment_status", "active")
          .is("deleted_at", null)
          .maybeSingle();

        if (assigneeError || !assignee) {
          return NextResponse.json({ error: "Assigned staff member not found in this facility" }, { status: 404 });
        }
      }

      patch.assigned_to_staff_id = assignedStaffId;
      patch.assigned_at = assignedStaffId ? new Date().toISOString() : null;
      if (note) patch.disposition_note = note;
      break;
    }
    case "start_review":
      if (flag.status !== "open") {
        return NextResponse.json({ error: `Only open integrity flags can be started; current status is ${flag.status}` }, { status: 409 });
      }
      patch.status = "in_progress";
      if (note) patch.disposition_note = note;
      break;
    case "resolve":
      if (flag.status === "resolved" || flag.status === "dismissed") {
        return NextResponse.json({ error: `Integrity flag is already ${flag.status}` }, { status: 409 });
      }
      patch.status = "resolved";
      patch.disposition_note = note || "Resolved from the Smart Rounding integrity review queue.";
      break;
    case "dismiss":
      if (flag.status === "resolved" || flag.status === "dismissed") {
        return NextResponse.json({ error: `Integrity flag is already ${flag.status}` }, { status: 409 });
      }
      patch.status = "dismissed";
      patch.disposition_note = note || "Dismissed from the Smart Rounding integrity review queue.";
      break;
  }

  const freshAuth = await revalidateRoundingRequestContext(context, { managerOnly: true, facilityId: flag.facility_id });
  if ("response" in freshAuth) return freshAuth.response;
  context = freshAuth.context;
  const { data: updated, error: updateError } = await context.admin.rpc(
    "update_rounding_integrity_flag_review" as never,
    {
      p_flag_id: flag.id,
      p_action: action,
      p_note: note,
      p_assigned_staff_id: body.assignedStaffId?.trim() || null,
      p_actor_id: context.userId,
      p_actor_role: context.appRole,
      p_session_id: context.sessionId,
      p_claim_version: context.authClaimVersion,
      p_organization_id: context.organizationId,
      p_facility_id: flag.facility_id,
    } as never,
  );

  if (updateError) {
    logError("rounding.integrity-flags.update", updateError, { flagId: flag.id, action });
    return NextResponse.json(
      { error: updateError.code === "42501" ? "No longer authorized to update this integrity flag" : "Could not update integrity flag" },
      { status: updateError.code === "42501" ? 403 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: flag.id,
    status: (updated as { status?: string } | null)?.status ?? patch.status,
    assignedToStaffId: (updated as { assigned_staff_id?: string | null } | null)?.assigned_staff_id ?? null,
  });
}
