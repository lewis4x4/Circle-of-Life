import { NextResponse } from "next/server";

import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";

type Action = "start_review" | "resolve" | "dismiss";

type Body = {
  action?: Action;
  note?: string;
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
    return NextResponse.json({ error: "Only clinical and facility leaders can manage rounding escalations" }, { status: 403 });
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

  const escalationId = (await params).id;
  const { data: escalation, error: escalationError } = await context.admin
    .from("resident_observation_escalations")
    .select("id, organization_id, facility_id, status")
    .eq("id", escalationId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (escalationError) {
    console.error("[rounding/escalations] lookup", escalationError);
  }
  if (escalationError || !escalation) {
    return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, escalation.facility_id);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {
    updated_by: context.userId,
  };

  switch (action) {
    case "start_review":
      if (escalation.status !== "open") {
        return NextResponse.json({ error: `Only open escalations can be started; current status is ${escalation.status}` }, { status: 409 });
      }
      patch.status = "in_progress";
      patch.acknowledged_at = now;
      if (note) patch.resolution_note = note;
      break;
    case "resolve":
      if (escalation.status === "resolved" || escalation.status === "dismissed") {
        return NextResponse.json({ error: `Escalation is already ${escalation.status}` }, { status: 409 });
      }
      patch.status = "resolved";
      if (escalation.status === "open") {
        patch.acknowledged_at = now;
      }
      patch.resolved_at = now;
      patch.resolution_note = note || "Resolved from the Resident Assurance escalation queue.";
      break;
    case "dismiss":
      if (escalation.status === "resolved" || escalation.status === "dismissed") {
        return NextResponse.json({ error: `Escalation is already ${escalation.status}` }, { status: 409 });
      }
      patch.status = "dismissed";
      if (escalation.status === "open") {
        patch.acknowledged_at = now;
      }
      patch.resolved_at = now;
      patch.resolution_note = note || "Dismissed from the Resident Assurance escalation queue.";
      break;
  }

  const { error: updateError } = await context.admin
    .from("resident_observation_escalations")
    .update(patch)
    .eq("id", escalation.id)
    .eq("organization_id", context.organizationId);

  if (updateError) {
    console.error("[rounding/escalations] update", updateError);
    return NextResponse.json({ error: "Could not update escalation" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: escalation.id,
    status: patch.status,
  });
}
