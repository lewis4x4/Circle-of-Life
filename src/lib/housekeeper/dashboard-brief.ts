/**
 * Housekeeper dashboard brief.
 * Room cleaning tasks, priority cleans, hours, completion rate.
 * Task-driven interface for a facility-scoped housekeeping role.
 */

import { createClient } from "@/lib/supabase/client";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";

export type HousekeeperDashboardBrief = {
  roomsAssigned: number;
  roomsCompleted: number;
  priorityCleans: number;
  hoursThisWeek: number;
  completionPct: number;
  tasks: Array<{
    id: string;
    roomNumber: string;
    residentName: string;
    taskType: string;
    status: string;
    isPriority: boolean;
  }>;
};

type TimeRecordRow = { clock_in: string | null; clock_out: string | null };
export async function fetchHousekeepingBrief(): Promise<HousekeeperDashboardBrief> {
 const supabase = createClient();
 const { data: { user } } = await supabase.auth.getUser();
 if (!user) throw new Error("Sign in to load assignments");
 const scope = await loadCaregiverFacilityContext(supabase);
 if (!scope.ok) throw new Error(scope.error);
 const response = await fetch(`/api/admin/operations/tasks?facility_id=${scope.ctx.facilityId}&view=day`);
 const payload = await response.json();
 if (!response.ok) throw new Error(payload.error ?? "Assignments unavailable");
 const tasks = (payload.tasks as Array<{ id: string; template_name: string; assigned_to: string | null; assigned_role: string | null; status: string; priority: string }>).filter((task) => task.assigned_to === user.id || (!task.assigned_to && task.assigned_role === "housekeeper")).map((task) => ({ id: task.id, roomNumber: "", residentName: "", taskType: task.template_name, status: task.status, isPriority: ["high", "critical"].includes(task.priority) }));
 const staff = await supabase.from("staff").select("id").eq("user_id",user.id).is("deleted_at",null).maybeSingle();
 if (staff.error) throw staff.error;
 let minutes=0;
 if (staff.data) {
  const hours = await supabase.from("time_records").select("clock_in, clock_out").eq("staff_id",staff.data.id).eq("facility_id",scope.ctx.facilityId).gte("clock_in",new Date(Date.now()-7*86400000).toISOString()).is("deleted_at",null);
  if (hours.error) throw hours.error;
  for (const record of (hours.data ?? []) as TimeRecordRow[]) if(record.clock_in && record.clock_out) minutes += (new Date(record.clock_out).getTime()-new Date(record.clock_in).getTime())/60000;
 }
 const completed=tasks.filter((task)=>task.status==="completed").length;
 return { roomsAssigned:tasks.length,roomsCompleted:completed,priorityCleans:tasks.filter((task)=>task.isPriority && task.status!=="completed").length,hoursThisWeek:Math.round(minutes/6)/10,completionPct:tasks.length?Math.round(completed/tasks.length*100):0,tasks };
}
