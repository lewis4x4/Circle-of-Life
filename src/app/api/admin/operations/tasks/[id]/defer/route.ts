import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id } = await params;

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
  const { deferred_until, cancellation_reason } = body as {
    deferred_until?: string;
    cancellation_reason?: string;
  };

  if (!deferred_until) {
    return NextResponse.json({ error: "deferred_until is required" }, { status: 400 });
  }

  // Check task exists
  const { data: task, error: taskError } = await supabase
    .from("operation_task_instances" as any)
    .select("id, status, assigned_to, facility_id, assigned_shift_date")
    .eq("id", id)
    .is("deleted_at", null)
    .single() as { data: { id: string; status: string; assigned_to: string | null; facility_id: string; assigned_shift_date: string; template_id: string; template_name: string; template_category: string; assigned_role: string | null } | null; error: any };

  if (taskError || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Check if user can update (assigned to or admin role)
  if (task.assigned_to !== user.id) {
    const { data: userData } = await supabase
      .from("user_facility_access" as any)
      .select("app_role")
      .eq("user_id", user.id)
      .single() as { data: { app_role: string } | null; error: any };

    const appRole = userData?.app_role || "";
    const adminRoles = ["owner", "org_admin", "coo", "facility_administrator"];

    if (!adminRoles.includes(appRole)) {
      return NextResponse.json({ error: "Not authorized to defer this task" }, { status: 403 });
    }
  }

  // Create new task instance for deferred date
  const { data: newTask, error: newTaskError } = await supabase
    .from("operation_task_instances" as any)
    .insert({
      organization_id: null, // Will be filled by default or from template
      facility_id: task.facility_id,
      template_id: task.template_id,
      template_name: "", // Will be filled from template
      template_category: "",
      template_cadence_type: "on_demand",
      assigned_shift_date: new Date(deferred_until).toISOString().slice(0, 10),
      assigned_shift: "day", // Default for deferred tasks
      assigned_to: task.assigned_to,
      assigned_role: task.assigned_role,
      status: "pending",
      priority: "normal",
      estimated_minutes: 0,
      created_by: user.id,
    })
    .select()
    .single() as { data: { id: string } | null; error: any };

  if (newTaskError || !newTask) {
    console.error("[OCE Task Defer] Error creating new task:", newTaskError);
    return NextResponse.json({ error: "Failed to create deferred task" }, { status: 500 });
  }

  const newTaskId = newTask.id;

  // Update original task to cancelled
  const { error: updateError } = await supabase
    .from("operation_task_instances" as any)
    .update({
      status: "cancelled",
      cancellation_reason: cancellation_reason || "Deferred to new date",
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[OCE Task Defer] Error:", updateError);
    return NextResponse.json({ error: "Failed to defer task" }, { status: 500 });
  }

  // Write to operation audit log
  await supabase.from("operation_audit_log" as any).insert({
    organization_id: null,
    facility_id: task.facility_id,
    task_instance_id: id,
    event_type: "deferred",
    from_status: task.status,
    to_status: "cancelled",
    actor_id: user.id,
    event_notes: `Deferred to ${deferred_until}. New task created: ${newTaskId}`,
    event_data: { deferred_to: deferred_until, new_task_id: newTaskId } as any,
  });

  return NextResponse.json({ success: true, new_task_id: newTaskId });
}
