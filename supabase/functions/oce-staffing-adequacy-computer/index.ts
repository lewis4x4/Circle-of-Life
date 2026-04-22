/**
 * OCE staffing adequacy computer.
 *
 * POST body:
 * {
 *   "facility_id"?: uuid,
 *   "date"?: "YYYY-MM-DD",
 *   "shift"?: "day" | "evening" | "night",
 *   "dry_run"?: boolean
 * }
 *
 * Auth: x-cron-secret must match OCE_STAFFING_ADEQUACY_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { jsonResponse, getCorsHeaders } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

type FacilityRow = {
  id: string;
  organization_id: string;
  name: string;
  timezone: string | null;
};

type ResidentRow = { acuity_level: string | null };
type StaffRow = { id: string; staff_role: string | null };
type RatioRuleRow = { required_ratio: number };
type TaskRow = {
  status: string;
  priority: "critical" | "high" | "normal" | "low" | null;
  estimated_minutes: number | null;
};

Deno.serve(async (req) => {
  const t = withTiming("oce-staffing-adequacy-computer");
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("OCE_STAFFING_ADEQUACY_SECRET") ?? "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: { facility_id?: string; date?: string; shift?: "day" | "evening" | "night"; dry_run?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  let facilityQuery = admin
    .from("facilities")
    .select("id, organization_id, name, timezone")
    .is("deleted_at", null)
    .eq("status", "active");
  if (body.facility_id) facilityQuery = facilityQuery.eq("id", body.facility_id);

  const { data: facilityData, error: facilityError } = await facilityQuery;
  if (facilityError) {
    t.log({ event: "facility_query_failed", outcome: "error", error_message: facilityError.message });
    return jsonResponse({ error: facilityError.message }, 500, origin);
  }

  const facilities = (facilityData ?? []) as FacilityRow[];
  const results: Array<Record<string, unknown>> = [];

  for (const facility of facilities) {
    const timezone = facility.timezone || "America/New_York";
    const date = body.date ?? currentDateInTimezone(timezone);
    const shift = body.shift ?? currentShiftInTimezone(timezone);

    const [residentRes, staffRes, ratioRes, taskRes] = await Promise.all([
      admin
        .from("residents" as never)
        .select("acuity_level")
        .eq("organization_id", facility.organization_id)
        .eq("facility_id", facility.id)
        .is("deleted_at", null)
        .in("status", ["active", "hospital_hold", "loa"]),
      admin
        .from("staff" as never)
        .select("id, staff_role")
        .eq("organization_id", facility.organization_id)
        .eq("facility_id", facility.id)
        .is("deleted_at", null)
        .eq("employment_status", "active"),
      admin
        .from("facility_ratio_rules" as never)
        .select("required_ratio")
        .eq("organization_id", facility.organization_id)
        .eq("facility_id", facility.id)
        .is("deleted_at", null)
        .maybeSingle(),
      admin
        .from("operation_task_instances" as never)
        .select("status, priority, estimated_minutes")
        .eq("organization_id", facility.organization_id)
        .eq("facility_id", facility.id)
        .eq("assigned_shift_date", date)
        .eq("assigned_shift", shift)
        .is("deleted_at", null)
        .in("status", ["pending", "in_progress"]),
    ]);

    const residents = (residentRes.data ?? []) as unknown as ResidentRow[];
    const staff = (staffRes.data ?? []) as unknown as StaffRow[];
    const ratioRule = ratioRes.data as unknown as RatioRuleRow | null;
    const tasks = (taskRes.data ?? []) as unknown as TaskRow[];

    const residentCount = residents.length;
    const residentAcuityWeightedCount = residents.reduce((sum, resident) => {
      if (resident.acuity_level === "level_3") return sum + 2;
      if (resident.acuity_level === "level_2") return sum + 1.5;
      return sum + 1;
    }, 0);
    const scheduledStaffCount = staff.length;
    const scheduledStaffByRole: Record<string, number> = {};
    for (const member of staff) {
      const role = member.staff_role || "other";
      scheduledStaffByRole[role] = (scheduledStaffByRole[role] || 0) + 1;
    }

    const requiredRatio = ratioRule?.required_ratio || 0.10;
    const actualRatio = residentCount > 0 ? scheduledStaffCount / residentCount : 0;
    const isCompliant = actualRatio >= requiredRatio;
    const pendingTaskCount = tasks.filter((task) => task.status === "pending").length;
    const highPriorityTaskCount = tasks.filter((task) => task.priority === "critical" || task.priority === "high").length;
    const estimatedCompletionHours = tasks.reduce((sum, task) => sum + ((task.estimated_minutes || 0) / 60), 0);

    let adequacyScore = 0;
    if (isCompliant) {
      adequacyScore += 50;
      const ratioExcess = requiredRatio > 0 ? (actualRatio - requiredRatio) / requiredRatio : 0;
      adequacyScore += Math.min(20, ratioExcess * 50);
    } else {
      const ratioDeficit = requiredRatio > 0 ? (requiredRatio - actualRatio) / requiredRatio : 1;
      adequacyScore -= Math.min(40, ratioDeficit * 100);
    }
    const staffHours = scheduledStaffCount * 8;
    const taskCoverage = staffHours > 0 ? 1 - (estimatedCompletionHours / staffHours) : 0;
    adequacyScore += Math.min(30, Math.max(0, taskCoverage * 30));
    adequacyScore += Math.max(0, 20 - (highPriorityTaskCount * 5));
    adequacyScore = Math.max(0, Math.min(100, Math.round(adequacyScore)));

    const adequacyRating =
      adequacyScore < 70 ? "critical_shortage"
        : adequacyScore < 85 ? "understaffed"
          : adequacyScore < 95 ? "minimal"
            : adequacyScore < 100 ? "adequate"
              : "well_staffed";

    const cannotCoverCount = estimatedCompletionHours > staffHours
      ? Math.ceil((estimatedCompletionHours - staffHours) / 0.5)
      : 0;
    const recommendedAction =
      cannotCoverCount > 0
        ? `Call float pool. ${cannotCoverCount} task${cannotCoverCount === 1 ? "" : "s"} cannot be completed with current staffing.`
        : !isCompliant
          ? `Ratio violation: need ${Math.max(1, Math.ceil(residentCount * requiredRatio) - scheduledStaffCount)} more staff.`
          : highPriorityTaskCount > 3
            ? `${highPriorityTaskCount} high-priority tasks pending. Reprioritize the shift.`
            : null;

    const payload = {
      organization_id: facility.organization_id,
      facility_id: facility.id,
      snapshot_date: date,
      shift_type: shift,
      snapshot_period_start: new Date().toISOString(),
      snapshot_period_end: new Date().toISOString(),
      resident_count: residentCount,
      resident_acuity_weighted_count: residentAcuityWeightedCount,
      scheduled_staff_count: scheduledStaffCount,
      scheduled_hours: scheduledStaffCount * 8,
      scheduled_staff_by_role: scheduledStaffByRole,
      required_ratio: requiredRatio,
      actual_ratio: actualRatio,
      is_compliant: isCompliant,
      pending_task_count: pendingTaskCount,
      high_priority_task_count: highPriorityTaskCount,
      estimated_completion_hours: estimatedCompletionHours,
      adequacy_score: adequacyScore,
      adequacy_rating: adequacyRating,
      cannot_cover_count: cannotCoverCount,
      float_pool_required: cannotCoverCount > 0 || !isCompliant,
      recommended_action: recommendedAction,
    };

    if (!body.dry_run) {
      await admin
        .from("staffing_adequacy_snapshots" as never)
        .upsert(payload as never, { onConflict: "facility_id,snapshot_date,shift_type" });
    }

    results.push({
      facility_id: facility.id,
      facility_name: facility.name,
      dry_run: Boolean(body.dry_run),
      ...payload,
    });
  }

  t.log({ event: "complete", outcome: "success", facilities_processed: results.length, dry_run: Boolean(body.dry_run) });
  return jsonResponse({ ok: true, results }, 200, origin);
});

function currentDateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`;
}

function currentShiftInTimezone(timezone: string): "day" | "evening" | "night" {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).format(new Date()));
  if (hour >= 7 && hour < 15) return "day";
  if (hour >= 15 && hour < 23) return "evening";
  return "night";
}
