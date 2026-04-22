import { NextResponse } from "next/server";

import { actorCanAccessFacility, actorCanViewOperations, listActorAccessibleFacilityIds, requireOperationsActor } from "@/lib/operations/auth";
import { getCurrentOperationShift, getFacilityLocalDateTimeParts } from "@/lib/operations/server";

export async function GET(request: Request) {
  const actorResult = await requireOperationsActor();
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  if (!actorCanViewOperations(actor)) {
    return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedFacilityId = searchParams.get("facility_id");
  const requestedDate = searchParams.get("date");
  const requestedShift = searchParams.get("shift");
  const accessibleFacilityIds = await listActorAccessibleFacilityIds(actor);
  const targetFacilityId = requestedFacilityId ?? accessibleFacilityIds[0] ?? null;

  if (!targetFacilityId) {
    return NextResponse.json({ error: "Facility ID required" }, { status: 400 });
  }

  const canAccess = await actorCanAccessFacility(actor, targetFacilityId);
  if (!canAccess) {
    return NextResponse.json({ error: "Access denied to this facility" }, { status: 403 });
  }

  const { data: facilityData, error: facilityError } = await actor.admin
    .from("facilities")
    .select("name, timezone, total_licensed_beds")
    .eq("id", targetFacilityId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  const facility = facilityData as { name: string; timezone: string | null; total_licensed_beds: number } | null;
  if (facilityError || !facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const timezone = facility.timezone || "America/New_York";
  const now = new Date();
  const localParts = getFacilityLocalDateTimeParts(now, timezone);
  const snapshotDate = requestedDate || localParts.date;
  const currentShift = requestedShift === "day" || requestedShift === "evening" || requestedShift === "night"
    ? requestedShift
    : getCurrentOperationShift(now, timezone);

  const { data: residentData } = await actor.admin
    .from("residents" as never)
    .select("acuity_level")
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .eq("facility_id", targetFacilityId)
    .eq("organization_id", actor.organizationId);

  const residents = (residentData ?? []) as unknown as Array<{ acuity_level: string | null }>;
  const residentCount = residents.length;
  const residentAcuityWeightedCount = residents.reduce((sum, resident) => {
    const level = resident.acuity_level || "level_1";
    if (level === "level_3") return sum + 2;
    if (level === "level_2") return sum + 1.5;
    return sum + 1;
  }, 0);

  const { data: staffData } = await actor.admin
    .from("staff" as never)
    .select("id, staff_role")
    .is("deleted_at", null)
    .eq("employment_status", "active")
    .eq("facility_id", targetFacilityId)
    .eq("organization_id", actor.organizationId);

  const staff = (staffData ?? []) as unknown as Array<{ id: string; staff_role: string | null }>;
  const scheduledStaffCount = staff.length;
  const scheduledStaffByRole: Record<string, number> = {};
  for (const member of staff) {
    const role = member.staff_role || "other";
    scheduledStaffByRole[role] = (scheduledStaffByRole[role] || 0) + 1;
  }

  const { data: ratioRuleData } = await actor.admin
    .from("facility_ratio_rules" as never)
    .select("required_ratio")
    .eq("facility_id", targetFacilityId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  const ratioRule = ratioRuleData as unknown as { required_ratio: number } | null;
  const requiredRatio = ratioRule?.required_ratio || 0.10;
  const actualRatio = residentCount > 0 ? scheduledStaffCount / residentCount : 0;
  const isCompliant = actualRatio >= requiredRatio;

  const { data: taskData } = await actor.admin
    .from("operation_task_instances" as never)
    .select("status, priority, estimated_minutes")
    .is("deleted_at", null)
    .eq("organization_id", actor.organizationId)
    .eq("facility_id", targetFacilityId)
    .eq("assigned_shift_date", snapshotDate)
    .eq("assigned_shift", currentShift)
    .in("status", ["pending", "in_progress"]);

  const tasks = (taskData ?? []) as unknown as Array<{
    status: string;
    priority: "critical" | "high" | "normal" | "low" | null;
    estimated_minutes: number | null;
  }>;

  const pendingTaskCount = tasks.filter((task) => task.status === "pending").length;
  const highPriorityTaskCount = tasks.filter((task) => task.priority === "critical" || task.priority === "high").length;
  const estimatedCompletionMinutes = tasks.reduce((sum, task) => sum + (task.estimated_minutes || 0), 0);
  const estimatedCompletionHours = estimatedCompletionMinutes / 60;

  let adequacyScore = 0;
  if (isCompliant) {
    adequacyScore += 50;
    const ratioExcess = requiredRatio > 0 ? (actualRatio - requiredRatio) / requiredRatio : 0;
    adequacyScore += Math.min(20, ratioExcess * 50);
  } else {
    const ratioDeficit = requiredRatio > 0 ? (requiredRatio - actualRatio) / requiredRatio : 1;
    adequacyScore -= Math.min(40, ratioDeficit * 100);
  }

  const staffHours = scheduledStaffCount * 8;
  const taskCoverage = staffHours > 0 ? 1 - (estimatedCompletionHours / staffHours) : 0;
  adequacyScore += Math.min(30, Math.max(0, taskCoverage * 30));
  adequacyScore += Math.max(0, 20 - (highPriorityTaskCount * 5));
  adequacyScore = Math.max(0, Math.min(100, Math.round(adequacyScore)));

  let adequacyRating = "well_staffed";
  if (adequacyScore < 70) adequacyRating = "critical_shortage";
  else if (adequacyScore < 85) adequacyRating = "understaffed";
  else if (adequacyScore < 95) adequacyRating = "minimal";
  else if (adequacyScore < 100) adequacyRating = "adequate";

  const cannotCoverCount = estimatedCompletionHours > staffHours
    ? Math.ceil((estimatedCompletionHours - staffHours) / 0.5)
    : 0;

  let recommendedAction: string | null = null;
  if (cannotCoverCount > 0) {
    recommendedAction = `Call float pool. ${cannotCoverCount} task${cannotCoverCount === 1 ? "" : "s"} cannot be completed with current staffing.`;
  } else if (!isCompliant) {
    recommendedAction = `Ratio violation: need ${Math.max(1, Math.ceil(residentCount * requiredRatio) - scheduledStaffCount)} more staff to meet ${requiredRatio} ratio.`;
  } else if (highPriorityTaskCount > 3) {
    recommendedAction = `${highPriorityTaskCount} high-priority tasks pending. Reprioritize this shift queue.`;
  }

  return NextResponse.json({
    adequacy_score: adequacyScore,
    adequacy_rating: adequacyRating,
    resident_count: residentCount,
    resident_acuity_weighted_count: residentAcuityWeightedCount,
    scheduled_staff_count: scheduledStaffCount,
    scheduled_hours: scheduledStaffCount * 8,
    scheduled_staff_by_role: scheduledStaffByRole,
    required_ratio: requiredRatio,
    actual_ratio: actualRatio,
    is_compliant: isCompliant,
    pending_task_count: pendingTaskCount,
    high_priority_task_count: highPriorityTaskCount,
    estimated_completion_hours: estimatedCompletionHours,
    cannot_cover_count: cannotCoverCount,
    float_pool_required: cannotCoverCount > 0 || !isCompliant,
    recommended_action: recommendedAction,
    current_shift: currentShift,
    snapshot_date: snapshotDate,
    facility_name: facility.name,
    facility_timezone: timezone,
  });
}
