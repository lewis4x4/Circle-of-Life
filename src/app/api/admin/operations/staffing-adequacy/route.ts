import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user's role and accessible facilities
  const { data: userData, error: userError } = await supabase
    .from("user_facility_access" as any)
    .select("app_role, facility_id")
    .eq("user_id", user.id)
    .single() as { data: { app_role: string; facility_id: string | null } | null; error: any };

  if (userError || !userData) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const appRole = userData.app_role;
  const userFacilityId = userData.facility_id;

  // Parse query params
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facility_id");

  // Use provided facility_id or user's facility
  const targetFacilityId = facilityId || userFacilityId;
  if (!targetFacilityId) {
    return NextResponse.json({ error: "Facility ID required" }, { status: 400 });
  }

  // Check facility access
  if (appRole !== "owner" && appRole !== "org_admin" && appRole !== "coo") {
    if (targetFacilityId !== userFacilityId) {
      return NextResponse.json({ error: "Access denied to this facility" }, { status: 403 });
    }
  }

  // Get facility info for timezone
  const { data: facility, error: facilityError } = await supabase
    .from("facilities" as any)
    .select("name, timezone, total_licensed_beds")
    .eq("id", targetFacilityId)
    .single() as { data: { name: string; timezone: string | null; total_licensed_beds: number } | null; error: any };

  if (facilityError || !facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const timezone = facility.timezone || "America/New_York";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Determine current shift based on facility timezone
  const hourInTz = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(today),
    10
  );

  let currentShift: "day" | "evening" | "night";
  if (hourInTz >= 7 && hourInTz < 15) {
    currentShift = "day";
  } else if (hourInTz >= 15 && hourInTz < 23) {
    currentShift = "evening";
  } else {
    currentShift = "night";
  }

  // Get resident count and acuity
  const { data: residents, error: residentsError } = await supabase
    .from("residents" as any)
    .select("acuity_level")
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .eq("facility_id", targetFacilityId);

  const residentCount = residents?.length || 0;
  const acuityWeightedCount = (residents || []).reduce((sum: number, r: any) => {
    const level = r.acuity_level || "level_1";
    const weight = level === "level_3" ? 2 : level === "level_2" ? 1.5 : 1;
    return sum + weight;
  }, 0);

  // Get scheduled staff count (simplified - actual implementation would use shift schedules)
  const { data: staff, error: staffError } = await supabase
    .from("staff" as any)
    .select("id, primary_role")
    .is("deleted_at", null)
    .eq("employment_status", "active")
    .eq("facility_id", targetFacilityId);

  const scheduledStaffCount = staff?.length || 0;
  const scheduledStaffByRole: Record<string, number> = {};

  (staff || []).forEach((s: any) => {
    const role = s.primary_role || "other";
    scheduledStaffByRole[role] = (scheduledStaffByRole[role] || 0) + 1;
  });

  // Get required ratio from facility_ratio_rules
  const { data: ratioRule } = await supabase
    .from("facility_ratio_rules" as any)
    .select("required_ratio")
    .eq("facility_id", targetFacilityId)
    .is("deleted_at", null)
    .single() as { data: { required_ratio: number } | null; error: any };

  const requiredRatio = ratioRule?.required_ratio || 0.10; // Default 1:10

  // Calculate actual ratio
  const actualRatio = residentCount > 0 ? scheduledStaffCount / residentCount : 0;
  const isCompliant = actualRatio >= requiredRatio;

  // Get pending task count for current shift
  const { data: tasks } = await supabase
    .from("operation_task_instances" as any)
    .select("id, priority, estimated_minutes, status")
    .is("deleted_at", null)
    .eq("facility_id", targetFacilityId)
    .eq("assigned_shift_date", today.toISOString().slice(0, 10))
    .eq("assigned_shift", currentShift)
    .in("status", ["pending", "in_progress"]) as { data: Array<{ id: string; priority: string; estimated_minutes: number; status: string }> | null; error: any };

  const pendingTaskCount = tasks?.filter((t: any) => t.status === "pending").length || 0;
  const highPriorityTaskCount = tasks?.filter((t: any) => t.priority === "critical" || t.priority === "high").length || 0;
  const estimatedCompletionMinutes = tasks?.reduce((sum: number, t: any) => sum + (t.estimated_minutes || 0), 0) || 0;
  const estimatedCompletionHours = estimatedCompletionMinutes / 60;

  // Calculate adequacy score
  // Base score from ratio compliance
  let adequacyScore = 0;

  // Ratio component (50 points max)
  if (isCompliant) {
    adequacyScore += 50;
    // Bonus for better than required ratio
    const ratioExcess = (actualRatio - requiredRatio) / requiredRatio;
    adequacyScore += Math.min(20, ratioExcess * 50);
  } else {
    // Penalty for under-staffing
    const ratioDeficit = (requiredRatio - actualRatio) / requiredRatio;
    adequacyScore -= Math.min(40, ratioDeficit * 100);
  }

  // Task load component (30 points max)
  // Assuming 8-hour shift, can we complete all tasks?
  const staffHours = scheduledStaffCount * 8;
  const taskCoverage = staffHours > 0 ? 1 - (estimatedCompletionHours / staffHours) : 0;
  adequacyScore += Math.min(30, Math.max(0, taskCoverage * 30));

  // Task priority component (20 points max)
  // Fewer high-priority pending = better score
  const highPriorityPenalty = highPriorityTaskCount * 5;
  adequacyScore += Math.max(0, 20 - highPriorityPenalty);

  // Clamp to 0-100
  adequacyScore = Math.max(0, Math.min(100, Math.round(adequacyScore)));

  // Determine rating
  let adequacyRating = "well_staffed";
  if (adequacyScore < 70) adequacyRating = "critical_shortage";
  else if (adequacyScore < 85) adequacyRating = "understaffed";
  else if (adequacyScore < 95) adequacyRating = "minimal";
  else if (adequacyScore < 100) adequacyRating = "adequate";

  // Calculate cannot_cover
  const cannotCoverCount = estimatedCompletionHours > staffHours
    ? Math.ceil((estimatedCompletionHours - staffHours) / 0.5) // Tasks in 30-min blocks
    : 0;

  // Recommended action
  let recommendedAction = "";
  if (cannotCoverCount > 0) {
    recommendedAction = `Call float pool. ${cannotCoverCount} task${cannotCoverCount > 1 ? "s" : ""} cannot be completed with current staffing.`;
  } else if (!isCompliant) {
    recommendedAction = `Ratio violation: need ${Math.ceil(residentCount * requiredRatio) - scheduledStaffCount} more staff to meet ${requiredRatio} ratio.`;
  } else if (highPriorityTaskCount > 3) {
    recommendedAction = `${highPriorityTaskCount} high-priority tasks pending. Consider prioritizing these.`;
  }

  const response = {
    adequacy_score: adequacyScore,
    adequacy_rating: adequacyRating,
    resident_count: residentCount,
    resident_acuity_weighted_count: acuityWeightedCount,
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
    recommended_action: recommendedAction || null,
    current_shift: currentShift,
    facility_name: facility.name,
    facility_timezone: timezone,
  };

  return NextResponse.json(response);
}
