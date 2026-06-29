import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type RoundingOverviewSummary = {
  plans: number;
  activeTasks: number;
  criticalOverdueCount: number;
  onTimeRate: number;
  missedCount: number;
  completedCount: number;
  expectedCount: number;
  pendingApprovals: number;
  openEscalations: number;
  openIntegrityFlags: number;
};

export type RoundingTaskRow = {
  id: string;
  status: string;
  due_at: string;
  grace_ends_at: string;
};

export type RoundingOverviewResult = {
  summary: RoundingOverviewSummary;
  taskRows: RoundingTaskRow[];
  emptyNotice: string | null;
};

export const EMPTY_ROUNDING_SUMMARY: RoundingOverviewSummary = {
  plans: 0,
  activeTasks: 0,
  criticalOverdueCount: 0,
  onTimeRate: 0,
  missedCount: 0,
  completedCount: 0,
  expectedCount: 0,
  pendingApprovals: 0,
  openEscalations: 0,
  openIntegrityFlags: 0,
};

const ACTIVE_TASK_STATUSES = new Set([
  "pending",
  "scheduled",
  "in_progress",
  "overdue",
  "critically_overdue",
]);

function isActiveTaskStatus(status: string): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

export async function fetchRoundingOverviewFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<RoundingOverviewResult> {
  if (!isValidFacilityIdForQuery(selectedFacilityId)) {
    return {
      summary: EMPTY_ROUNDING_SUMMARY,
      taskRows: [],
      emptyNotice: null,
    };
  }

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [plansRes, tasksRes, watchesRes, escalationsRes, integrityRes] = await Promise.all([
    supabase
      .from("resident_observation_plans")
      .select("id")
      .eq("facility_id", selectedFacilityId)
      .eq("status", "active")
      .is("deleted_at", null),
    supabase
      .from("resident_observation_tasks")
      .select("id, status, due_at, grace_ends_at")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .gte("due_at", sinceIso)
      .order("due_at", { ascending: true })
      .limit(200),
    supabase
      .from("resident_watch_instances")
      .select("id, status")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null),
    supabase
      .from("resident_observation_escalations")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("resident_observation_integrity_flags")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", ["open", "in_progress"]),
  ]);

  if (plansRes.error) throw plansRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (watchesRes.error) throw watchesRes.error;
  if (escalationsRes.error) throw escalationsRes.error;
  if (integrityRes.error) throw integrityRes.error;

  const planCount = plansRes.data?.length ?? 0;
  const taskData = (tasksRes.data ?? []) as RoundingTaskRow[];
  const watchRows = watchesRes.data ?? [];
  const completed = taskData.filter((t) => t.status.startsWith("completed"));
  const missed = taskData.filter((t) => t.status === "missed");
  const criticallyOverdue = taskData.filter((t) => t.status === "critically_overdue");
  const active = taskData.filter((t) => isActiveTaskStatus(t.status));
  const expected = taskData.length;
  const pendingApprovals = watchRows.filter((row) => row.status === "pending_approval").length;

  return {
    summary: {
      plans: planCount,
      activeTasks: active.length,
      criticalOverdueCount: criticallyOverdue.length,
      onTimeRate:
        expected > 0
          ? taskData.filter((t) => t.status === "completed_on_time").length / expected
          : 0,
      missedCount: missed.length,
      completedCount: completed.length,
      expectedCount: expected,
      pendingApprovals,
      openEscalations: escalationsRes.count ?? 0,
      openIntegrityFlags: integrityRes.count ?? 0,
    },
    taskRows: taskData,
    emptyNotice: expected === 0 ? "no_rounds" : null,
  };
}
