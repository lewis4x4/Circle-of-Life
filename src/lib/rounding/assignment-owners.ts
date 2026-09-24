import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency } from "./compliance-day-chunks";
import type { GeneratedTaskInput } from "./types";

/** The SQL resolver owns clinical eligibility. Due times and resident policy are unchanged. */
export async function assignGeneratedTaskOwners(client: Pick<SupabaseClient, "rpc">, facilityId: string, tasks: GeneratedTaskInput[]): Promise<void> {
  const byDue = new Map<string, GeneratedTaskInput[]>();
  for (const task of tasks) byDue.set(task.dueAt, [...(byDue.get(task.dueAt) ?? []), task]);
  await mapWithConcurrency([...byDue], 4, async ([dueAt, dueTasks]) => {
    const residents = [...new Set(dueTasks.map((task) => task.residentId))];
    const owners = await client.rpc("resolve_observation_task_assignees_for_instant", {
      p_facility_id: facilityId, p_at: dueAt, p_resident_ids: residents,
    });
    if (owners.error) throw owners.error;
    const rows = (owners.data ?? []) as { resident_id: string; staff_id: string | null; shift_assignment_id: string | null }[];
    const byResident = new Map(rows.map((owner) => [owner.resident_id, owner]));
    if (rows.length !== residents.length || byResident.size !== residents.length || residents.some((id) => !byResident.has(id))) {
      throw new Error("Incomplete task-owner resolution.");
    }
    for (const task of dueTasks) {
      const owner = byResident.get(task.residentId)!;
      task.assignedStaffId = owner.staff_id;
      task.shiftAssignmentId = owner.shift_assignment_id;
    }
  });
}
