import { NextResponse } from "next/server";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";
import { calculateObservationTaskStatus } from "@/lib/rounding/update-task-status";

type BreakdownEntry = {
  key: string;
  label: string;
  expected: number;
  completed: number;
  onTime: number;
  late: number;
  missed: number;
};

function initBreakdown(label: string): BreakdownEntry {
  return {
    key: label,
    label,
    expected: 0,
    completed: 0,
    onTime: 0,
    late: 0,
    missed: 0,
  };
}

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can view completion reports" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  if (!facilityId || !from || !to) {
    return NextResponse.json({ error: "facilityId, from, and to are required" }, { status: 400 });
  }

  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ error: "from and to must be valid ISO date strings" }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data, error } = await context.admin
    .from("resident_observation_tasks")
    .select(`
      id,
      status,
      due_at,
      grace_ends_at,
      residents(first_name, last_name, preferred_name),
      staff!resident_observation_tasks_assigned_staff_id_fkey(first_name, last_name, preferred_name),
      shift_assignments(shift_type)
    `)
    .eq("organization_id", context.organizationId)
    .eq("facility_id", facilityId)
    .gte("due_at", from)
    .lte("due_at", to)
    .is("deleted_at", null);

  if (error) {
    console.error("[rounding/reports/completion] get", error);
    return NextResponse.json({ error: "Could not load completion report" }, { status: 500 });
  }

  const byShift = new Map<string, BreakdownEntry>();
  const byStaff = new Map<string, BreakdownEntry>();
  const byResident = new Map<string, BreakdownEntry>();

  let expected = 0;
  let completed = 0;
  let onTime = 0;
  let late = 0;
  let missed = 0;
  let totalDelayMinutes = 0;
  let totalDelayRows = 0;

  for (const task of data ?? []) {
    const terminalStatus = task.status?.startsWith("completed")
      ? task.status
      : calculateObservationTaskStatus({ dueAt: task.due_at, graceEndsAt: task.grace_ends_at });
    const shiftLabel = task.shift_assignments?.shift_type ?? "unassigned";
    const staffLabel = [
      task.staff?.preferred_name ?? task.staff?.first_name ?? null,
      task.staff?.last_name ?? null,
    ]
      .filter(Boolean)
      .join(" ") || "Unassigned";
    const residentLabel = [
      task.residents?.preferred_name ?? task.residents?.first_name ?? null,
      task.residents?.last_name ?? null,
    ]
      .filter(Boolean)
      .join(" ") || "Resident";

    expected += 1;
    if (!byShift.has(shiftLabel)) byShift.set(shiftLabel, initBreakdown(shiftLabel));
    if (!byStaff.has(staffLabel)) byStaff.set(staffLabel, initBreakdown(staffLabel));
    if (!byResident.has(residentLabel)) byResident.set(residentLabel, initBreakdown(residentLabel));

    for (const entry of [
      byShift.get(shiftLabel)!,
      byStaff.get(staffLabel)!,
      byResident.get(residentLabel)!,
    ]) {
      entry.expected += 1;
    }

    if (terminalStatus === "completed_on_time" || terminalStatus === "completed_late") {
      completed += 1;
      for (const entry of [
        byShift.get(shiftLabel)!,
        byStaff.get(staffLabel)!,
        byResident.get(residentLabel)!,
      ]) {
        entry.completed += 1;
      }
    }

    if (terminalStatus === "completed_on_time") {
      onTime += 1;
      byShift.get(shiftLabel)!.onTime += 1;
      byStaff.get(staffLabel)!.onTime += 1;
      byResident.get(residentLabel)!.onTime += 1;
    } else if (terminalStatus === "completed_late") {
      late += 1;
      byShift.get(shiftLabel)!.late += 1;
      byStaff.get(staffLabel)!.late += 1;
      byResident.get(residentLabel)!.late += 1;
      const graceMs = new Date(task.grace_ends_at).getTime();
      const dueMs = new Date(task.due_at).getTime();
      if (!Number.isNaN(graceMs) && !Number.isNaN(dueMs)) {
        totalDelayMinutes += Math.max(0, Math.round((graceMs - dueMs) / (60 * 1000)));
        totalDelayRows += 1;
      }
    } else if (terminalStatus === "missed") {
      missed += 1;
      byShift.get(shiftLabel)!.missed += 1;
      byStaff.get(staffLabel)!.missed += 1;
      byResident.get(residentLabel)!.missed += 1;
    }
  }

  return NextResponse.json({
    summary: {
      expected,
      completed,
      onTime,
      late,
      missed,
      completionRate: expected > 0 ? completed / expected : 0,
      onTimeRate: expected > 0 ? onTime / expected : 0,
      missedRate: expected > 0 ? missed / expected : 0,
      averageCompletionDelayMinutes: totalDelayRows > 0 ? totalDelayMinutes / totalDelayRows : 0,
    },
    breakdowns: {
      byShift: Array.from(byShift.values()),
      byStaff: Array.from(byStaff.values()),
      byResident: Array.from(byResident.values()),
    },
  });
}
