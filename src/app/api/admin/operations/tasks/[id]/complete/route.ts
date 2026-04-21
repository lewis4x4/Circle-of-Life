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
  const { completion_notes, completion_evidence_paths } = body as {
    completion_notes?: string;
    completion_evidence_paths?: string[];
  };

  // Check task exists
  const { data: task, error: taskError } = await supabase
    .from("operation_task_instances" as any)
    .select("id, status, assigned_to, facility_id, template_id, due_at")
    .eq("id", id)
    .is("deleted_at", null)
    .single() as { data: { id: string; status: string; assigned_to: string | null; facility_id: string; template_id: string; due_at: string | null } | null; error: any };

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
      return NextResponse.json({ error: "Not authorized to complete this task" }, { status: 403 });
    }
  }

  // Check if SLA met
  const slaMet = task.due_at ? new Date(task.due_at) >= new Date() : true;

  // Update task status to completed
  const { error: updateError } = await supabase
    .from("operation_task_instances" as any)
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completion_notes: completion_notes || null,
      completion_evidence_paths: completion_evidence_paths || [],
      verified_by: user.id, // Auto-verify for now
      verified_at: new Date().toISOString(),
      sla_met: slaMet,
      sla_miss_reason: !slaMet ? "Completed after due time" : null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[OCE Task Complete] Error:", updateError);
    return NextResponse.json({ error: "Failed to complete task" }, { status: 500 });
  }

  // Write to operation audit log
  await supabase.from("operation_audit_log" as any).insert({
    organization_id: null, // Will be filled by trigger
    facility_id: task.facility_id,
    task_instance_id: id,
    event_type: "completed",
    from_status: task.status,
    to_status: "completed",
    actor_id: user.id,
    event_notes: completion_notes || "Completed via Today view",
    event_data: { sla_met: slaMet, auto_verified: true } as any,
  });

  return NextResponse.json({ success: true });
}
