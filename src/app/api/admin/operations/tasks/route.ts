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

  // Check if user has admin-eligible role
  const adminRoles = [
    "owner", "org_admin", "coo", "facility_administrator",
    "don", "lpn_supervisor", "medication_aide", "cna",
    "dietary_manager", "activities_director", "housekeeping",
    "hr_manager", "staffing_coordinator", "compliance_officer",
    "finance_manager", "collections_manager"
  ];

  if (!adminRoles.includes(appRole)) {
    return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
  }

  // Parse query params
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facility_id");
  const shift = searchParams.get("shift");
  const status = searchParams.get("status");

  // Build query
  let query = supabase
    .from("operation_task_instances" as any)
    .select(`
      id,
      template_id,
      template_name,
      template_category,
      template_cadence_type,
      assigned_shift_date,
      assigned_shift,
      assigned_to,
      assigned_role,
      status,
      due_at,
      priority,
      license_threatening,
      estimated_minutes,
      current_escalation_level,
      facility_id,
      created_at,
      facilities!inner(name),
      assigned_to_profile:profiles!left(first_name, last_name)
    `)
    .is("deleted_at", null);

  // Filter by facility
  if (facilityId) {
    query = query.eq("facility_id", facilityId);
  } else if (userFacilityId && appRole !== "owner" && appRole !== "org_admin" && appRole !== "coo") {
    // Facility-level roles only see their facility
    query = query.eq("facility_id", userFacilityId);
  }

  // Filter by shift
  if (shift && shift !== "all") {
    query = query.eq("assigned_shift", shift);
  }

  // Filter by status
  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  // Filter by date (today for Today view)
  const today = new Date().toISOString().slice(0, 10);
  query = query.gte("assigned_shift_date", today);
  query = query.lte("assigned_shift_date", today);

  // Order: overdue first, then priority, then due time
  query = query.order("status", { ascending: true }); // missed, pending first

  const { data: tasks, error } = await query;

  if (error) {
    console.error("[OCE Tasks] Error:", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }

  // Format response
  const formattedTasks = (tasks || []).map((task: any) => ({
    id: task.id,
    template_id: task.template_id,
    template_name: task.template_name,
    template_category: task.template_category,
    template_cadence_type: task.template_cadence_type,
    assigned_shift_date: task.assigned_shift_date,
    assigned_shift: task.assigned_shift,
    assigned_to: task.assigned_to,
    assigned_to_name: task.assigned_to_profile
      ? `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`.trim()
      : null,
    assigned_role: task.assigned_role,
    status: task.status,
    due_at: task.due_at,
    priority: task.priority,
    license_threatening: task.license_threatening,
    estimated_minutes: task.estimated_minutes,
    current_escalation_level: task.current_escalation_level,
    facility_id: task.facility_id,
    facility_name: task.facilities?.name || "Unknown Facility",
  }));

  return NextResponse.json({
    tasks: formattedTasks,
    pagination: {
      page: 1,
      per_page: formattedTasks.length,
      total: formattedTasks.length,
    },
  });
}
