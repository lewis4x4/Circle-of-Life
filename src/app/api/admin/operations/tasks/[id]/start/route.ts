import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createClient();
  const { id } = await params;

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check task exists and user can update it
  const { data: task, error: taskError } = await supabase
    .from("operation_task_instances" as never)
    .select("id, status, assigned_to, facility_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (taskError || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Check if user can update (assigned to or admin role)
  if (task.assigned_to !== user.id) {
    const { data: userData } = await supabase
      .from("user_facility_access" as never)
      .select("app_role")
      .eq("user_id", user.id)
      .single();

    const appRole = userData?.app_role;
    const adminRoles = ["owner", "org_admin", "coo", "facility_administrator"];

    if (!adminRoles.includes(appRole)) {
      return NextResponse.json({ error: "Not authorized to start this task" }, { status: 403 });
    }
  }

  // Update task status to in_progress
  const { error: updateError } = await supabase
    .from("operation_task_instances" as never)
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[OCE Task Start] Error:", updateError);
    return NextResponse.json({ error: "Failed to start task" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
