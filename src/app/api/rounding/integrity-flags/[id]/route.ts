import { NextResponse } from "next/server";

import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";

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
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
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
  const { data: flag, error: flagError } = await context.admin
    .from("resident_observation_integrity_flags")
    .select("id, organization_id, facility_id, status")
    .eq("id", flagId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (flagError) {
    console.error("[rounding/integrity-flags] lookup", flagError);
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
      patch.disposition_note = note || "Resolved from the Resident Assurance integrity review queue.";
      break;
    case "dismiss":
      if (flag.status === "resolved" || flag.status === "dismissed") {
        return NextResponse.json({ error: `Integrity flag is already ${flag.status}` }, { status: 409 });
      }
      patch.status = "dismissed";
      patch.disposition_note = note || "Dismissed from the Resident Assurance integrity review queue.";
      break;
  }

  const { error: updateError } = await context.admin
    .from("resident_observation_integrity_flags")
    .update(patch)
    .eq("id", flag.id)
    .eq("organization_id", context.organizationId);

  if (updateError) {
    console.error("[rounding/integrity-flags] update", updateError);
    return NextResponse.json({ error: "Could not update integrity flag" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: flag.id,
    status: patch.status,
    assignedToStaffId: patch.assigned_to_staff_id ?? null,
  });
}
