import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = createClient();

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get request body
  const body = await request.json();
  const { task_ids, completion_notes } = body as {
    task_ids?: string[];
    completion_notes?: string;
  };

  if (!task_ids || !Array.isArray(task_ids) || task_ids.length === 0) {
    return NextResponse.json({ error: "task_ids array is required" }, { status: 400 });
  }

  // Get user's role
  const { data: userData } = await supabase
    .from("user_facility_access" as never)
    .select("app_role")
    .eq("user_id", user.id)
    .single();

  const appRole = userData?.app_role;
  const adminRoles = ["owner", "org_admin", "coo", "facility_administrator", "don"];

  // Check tasks exist and user can update them
  const { data: tasks, error: tasksError } = await supabase
    .from("operation_task_instances" as never)
    .select("id, status, assigned_to, due_at, facility_id")
    .in("id", task_ids)
    .is("deleted_at", null);

  if (tasksError) {
    console.error("[OCE Bulk Complete] Error:", tasksError);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }

  // Filter tasks user can update
  const updatableTasks = tasks.filter((task: any) =>
    task.assigned_to === user.id || adminRoles.includes(appRole)
  );

  if (updatableTasks.length === 0) {
    return NextResponse.json({ error: "No tasks to update" }, { status: 400 });
  }

  // Bulk update tasks
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("operation_task_instances" as never)
    .update({
      status: "completed",
      completed_at: now,
      completion_notes: completion_notes || "End of shift bulk complete",
      verified_by: user.id,
      verified_at: now,
      sla_met: true, // Assume met for bulk complete
      updated_at: now,
      updated_by: user.id,
    })
    .in("id", updatableTasks.map((t: any) => t.id));

  if (updateError) {
    console.error("[OCE Bulk Complete] Error:", updateError);
    return NextResponse.json({ error: "Failed to complete tasks" }, { status: 500 });
  }

  // Write audit log entries for each task
  for (const task of updatableTasks) {
    await supabase.from("operation_audit_log" as never).insert({
      organization_id: null,
      facility_id: task.facility_id,
      task_instance_id: task.id,
      event_type: "completed",
      from_status: task.status,
      to_status: "completed",
      actor_id: user.id,
      event_notes: completion_notes || "Bulk completed (end of shift)",
      event_data: { bulk_complete: true } as never,
    });
  }

  return NextResponse.json({
    success: true,
    completed_count: updatableTasks.length,
    requested_count: task_ids.length,
  });
}
