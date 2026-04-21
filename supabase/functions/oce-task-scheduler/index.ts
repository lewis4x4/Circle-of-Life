/**
 * Operations Cadence Engine task scheduler (spec 27).
 *
 * POST body:
 * {
 *   "date_from"?: "YYYY-MM-DD",
 *   "date_to"?: "YYYY-MM-DD",
 *   "dry_run"?: boolean,
 *   "facility_id"?: uuid,
 *   "category"?: string | string[]
 * }
 *
 * Auth: either Authorization bearer token or x-cron-secret must match
 * SUPABASE_SERVICE_ROLE_KEY. This avoids introducing a new per-function secret
 * while keeping the endpoint private to trusted operators / schedulers.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { jsonResponse, getCorsHeaders } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COL_ORG_ID = "00000000-0000-0000-0000-000000000001";

type AppRole =
  | "owner"
  | "org_admin"
  | "facility_admin"
  | "manager"
  | "admin_assistant"
  | "coordinator"
  | "nurse"
  | "med_tech"
  | "caregiver"
  | "dietary"
  | "dietary_aide"
  | "housekeeper"
  | "maintenance_role"
  | "family"
  | "broker";

type TemplateRow = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  name: string;
  category: string;
  cadence_type: string;
  shift_scope: "all" | "day" | "evening" | "night" | null;
  day_of_week: number | null;
  day_of_month: number | null;
  month_of_year: number | null;
  assignee_role: string | null;
  required_role_fallback: string | null;
  escalation_ladder: Array<{ role?: string; sla_minutes?: number; enabled?: boolean }>;
  priority: "critical" | "high" | "normal" | "low";
  license_threatening: boolean;
  estimated_minutes: number | null;
  requires_dual_sign: boolean;
};

type FacilityRow = {
  id: string;
  organization_id: string;
  timezone: string | null;
};

type ProfileRow = {
  id: string;
  organization_id: string;
  app_role: AppRole;
  full_name: string | null;
};

type FacilityAccessRow = {
  user_id: string;
  facility_id: string;
  is_primary: boolean;
};

type CandidateInstance = {
  organization_id: string;
  facility_id: string;
  template_id: string;
  template_name: string;
  template_category: string;
  template_cadence_type: string;
  assigned_shift_date: string;
  assigned_shift: "day" | "evening" | "night" | null;
  assigned_to: string | null;
  assigned_role: string | null;
  assigned_at: string | null;
  status: "pending";
  priority: "critical" | "high" | "normal" | "low";
  license_threatening: boolean;
  estimated_minutes: number | null;
  requires_dual_sign: boolean;
  due_at: string;
};

const assigneeCrosswalk: Record<string, AppRole[]> = {
  coo: ["org_admin", "owner"],
  facility_administrator: ["facility_admin", "manager"],
  don: ["nurse", "manager", "facility_admin"],
  lpn_supervisor: ["nurse", "manager", "facility_admin"],
  medication_aide: ["nurse", "caregiver"],
  cna: ["caregiver", "nurse"],
  dietary_manager: ["dietary", "dietary_aide", "manager"],
  activities_director: ["coordinator", "manager"],
  maintenance: ["maintenance_role", "manager"],
  housekeeping: ["housekeeper", "maintenance_role"],
  staffing_coordinator: ["coordinator", "manager"],
  compliance_officer: ["manager", "facility_admin", "org_admin"],
  finance_manager: ["admin_assistant", "manager", "org_admin"],
  collections_manager: ["admin_assistant", "manager", "org_admin"],
  hr_manager: ["admin_assistant", "manager", "org_admin"],
};

Deno.serve(async (req) => {
  const t = withTiming("oce-task-scheduler");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const sharedSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expectedAuth = `Bearer ${sharedSecret}`;
  const authHeader = req.headers.get("authorization");
  const cronSecret = req.headers.get("x-cron-secret");
  if (!sharedSecret || (authHeader !== expectedAuth && cronSecret !== sharedSecret)) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "service role authorization required" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    t.log({ event: "env_missing", outcome: "error", error_message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" });
    return jsonResponse({ error: "Missing Supabase environment" }, 500, origin);
  }

  let body: {
    date_from?: string;
    date_to?: string;
    dry_run?: boolean;
    facility_id?: string;
    category?: string | string[];
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.facility_id && !UUID_RE.test(body.facility_id)) {
    return jsonResponse({ error: "Invalid facility_id" }, 400, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const dateRange = resolveDateRange(body.date_from, body.date_to);
  const categoryFilter = normalizeCategories(body.category);

  let facilityQuery = admin
    .from("facilities")
    .select("id, organization_id, timezone")
    .eq("organization_id", COL_ORG_ID)
    .eq("status", "active")
    .is("deleted_at", null);

  if (body.facility_id) {
    facilityQuery = facilityQuery.eq("id", body.facility_id);
  }

  const { data: facilityData, error: facilityError } = await facilityQuery;
  const facilities = (facilityData ?? []) as FacilityRow[];
  if (facilityError) {
    t.log({ event: "facility_query_failed", outcome: "error", error_message: facilityError.message });
    return jsonResponse({ error: "Failed to load facilities" }, 500, origin);
  }
  if (facilities.length === 0) {
    return jsonResponse({ ok: true, dry_run: Boolean(body.dry_run), inserted: 0, generated: 0, skipped_existing: 0, preview: [] }, 200, origin);
  }

  let templateQuery = admin
    .from("operation_task_templates")
    .select(`
      id,
      organization_id,
      facility_id,
      name,
      category,
      cadence_type,
      shift_scope,
      day_of_week,
      day_of_month,
      month_of_year,
      assignee_role,
      required_role_fallback,
      escalation_ladder,
      priority,
      license_threatening,
      estimated_minutes,
      requires_dual_sign
    `)
    .eq("organization_id", COL_ORG_ID)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (categoryFilter.length > 0) {
    templateQuery = templateQuery.in("category", categoryFilter);
  }

  const { data: templateData, error: templateError } = await templateQuery;
  const templates = (templateData ?? []) as TemplateRow[];
  if (templateError) {
    t.log({ event: "template_query_failed", outcome: "error", error_message: templateError.message });
    return jsonResponse({ error: "Failed to load templates" }, 500, origin);
  }

  const templateIds = templates.map((template) => template.id);
  const facilityIds = facilities.map((facility) => facility.id);

  const { data: existingData, error: existingError } = await admin
    .from("operation_task_instances")
    .select("organization_id, facility_id, template_id, assigned_shift_date, assigned_shift")
    .eq("organization_id", COL_ORG_ID)
    .gte("assigned_shift_date", dateRange.dateFrom)
    .lte("assigned_shift_date", dateRange.dateTo)
    .in("facility_id", facilityIds)
    .in("template_id", templateIds)
    .is("deleted_at", null);

  if (existingError) {
    t.log({ event: "existing_query_failed", outcome: "error", error_message: existingError.message });
    return jsonResponse({ error: "Failed to load existing task instances" }, 500, origin);
  }

  const existingKeys = new Set(
    (existingData ?? []).map((row) =>
      buildInstanceKey(
        row.organization_id,
        row.facility_id,
        row.template_id,
        row.assigned_shift_date,
        row.assigned_shift,
      )
    ),
  );

  const relevantAppRoles = Array.from(
    new Set(
      Object.values(assigneeCrosswalk)
        .flat()
        .concat(["owner", "org_admin"]),
    ),
  );

  const { data: profileData, error: profileError } = await admin
    .from("user_profiles")
    .select("id, organization_id, app_role, full_name")
    .eq("organization_id", COL_ORG_ID)
    .eq("is_active", true)
    .in("app_role", relevantAppRoles)
    .is("deleted_at", null);

  const profiles = (profileData ?? []) as ProfileRow[];
  if (profileError) {
    t.log({ event: "profile_query_failed", outcome: "error", error_message: profileError.message });
    return jsonResponse({ error: "Failed to load operator profiles" }, 500, origin);
  }

  const profileIds = profiles.map((profile) => profile.id);
  const { data: accessData, error: accessError } = await admin
    .from("user_facility_access")
    .select("user_id, facility_id, is_primary")
    .eq("organization_id", COL_ORG_ID)
    .in("user_id", profileIds)
    .in("facility_id", facilityIds)
    .is("revoked_at", null);

  const facilityAccess = (accessData ?? []) as FacilityAccessRow[];
  if (accessError) {
    t.log({ event: "facility_access_query_failed", outcome: "error", error_message: accessError.message });
    return jsonResponse({ error: "Failed to load facility access rows" }, 500, origin);
  }

  const profileAccessMap = new Map<string, FacilityAccessRow[]>();
  for (const access of facilityAccess) {
    const list = profileAccessMap.get(access.user_id) ?? [];
    list.push(access);
    profileAccessMap.set(access.user_id, list);
  }

  const candidates: CandidateInstance[] = [];
  let skippedExisting = 0;

  for (const facility of facilities) {
    const facilityTimezone = facility.timezone || "America/New_York";
    const facilityTemplates = templates.filter((template) =>
      template.organization_id === facility.organization_id &&
      (template.facility_id === null || template.facility_id === facility.id)
    );

    for (const date of enumerateDateStrings(dateRange.dateFrom, dateRange.dateTo)) {
      for (const template of facilityTemplates) {
        if (!templateMatchesDate(template, date)) continue;

        const shifts = expandTemplateShifts(template);
        for (const shift of shifts) {
          const instanceKey = buildInstanceKey(
            facility.organization_id,
            facility.id,
            template.id,
            date,
            shift,
          );

          if (existingKeys.has(instanceKey)) {
            skippedExisting += 1;
            continue;
          }

          const assignment = resolveAssignee({
            facility,
            template,
            profiles,
            profileAccessMap,
          });

          const baseLocalTime = getBaseLocalTime(shift);
          const dueAt = buildDueAt({
            date,
            timeZone: facilityTimezone,
            shift,
            estimatedMinutes: template.estimated_minutes,
            escalationLadder: template.escalation_ladder,
            fallbackHour: baseLocalTime.hour,
            fallbackMinute: baseLocalTime.minute,
          });

          candidates.push({
            organization_id: facility.organization_id,
            facility_id: facility.id,
            template_id: template.id,
            template_name: template.name,
            template_category: template.category,
            template_cadence_type: template.cadence_type,
            assigned_shift_date: date,
            assigned_shift: shift,
            assigned_to: assignment.assigned_to,
            assigned_role: assignment.assigned_role,
            assigned_at: assignment.assigned_to ? new Date().toISOString() : null,
            status: "pending",
            priority: template.priority,
            license_threatening: template.license_threatening,
            estimated_minutes: template.estimated_minutes,
            requires_dual_sign: template.requires_dual_sign,
            due_at: dueAt.toISOString(),
          });

          existingKeys.add(instanceKey);
        }
      }
    }
  }

  if (body.dry_run) {
    t.log({
      event: "dry_run_complete",
      outcome: "success",
      generated: candidates.length,
      skipped_existing: skippedExisting,
      date_from: dateRange.dateFrom,
      date_to: dateRange.dateTo,
    });
    return jsonResponse({
      ok: true,
      dry_run: true,
      inserted: 0,
      generated: candidates.length,
      skipped_existing: skippedExisting,
      preview: candidates.slice(0, 25),
    }, 200, origin);
  }

  if (candidates.length > 0) {
    const { error: insertError } = await admin
      .from("operation_task_instances")
      .insert(candidates);

    if (insertError) {
      t.log({ event: "insert_failed", outcome: "error", error_message: insertError.message, generated: candidates.length });
      return jsonResponse({ error: "Failed to insert generated task instances" }, 500, origin);
    }
  }

  t.log({
    event: "complete",
    outcome: "success",
    generated: candidates.length,
    inserted: candidates.length,
    skipped_existing: skippedExisting,
    date_from: dateRange.dateFrom,
    date_to: dateRange.dateTo,
  });

  return jsonResponse({
    ok: true,
    dry_run: false,
    inserted: candidates.length,
    generated: candidates.length,
    skipped_existing: skippedExisting,
  }, 200, origin);
});

function resolveDateRange(dateFrom?: string, dateTo?: string) {
  const defaultDate = formatDateInTimeZone(new Date(), "America/New_York");
  const normalizedFrom = normalizeDateOnly(dateFrom) ?? defaultDate;
  const normalizedTo = normalizeDateOnly(dateTo) ?? normalizedFrom;
  return normalizedFrom <= normalizedTo
    ? { dateFrom: normalizedFrom, dateTo: normalizedTo }
    : { dateFrom: normalizedTo, dateTo: normalizedFrom };
}

function normalizeDateOnly(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeCategories(category?: string | string[]) {
  if (Array.isArray(category)) return category.filter(Boolean);
  if (!category) return [];
  return [category];
}

function enumerateDateStrings(dateFrom: string, dateTo: string) {
  const dates: string[] = [];
  let cursor = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function templateMatchesDate(template: TemplateRow, dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const utcMonth = date.getUTCMonth() + 1;
  const utcDay = date.getUTCDate();
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const lastDayOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

  if (template.cadence_type === "daily") return true;
  if (template.cadence_type === "weekly") return template.day_of_week === weekday;
  if (template.cadence_type === "monthly") {
    const dayOfMonth = Math.min(template.day_of_month ?? 1, lastDayOfMonth);
    return utcDay === dayOfMonth;
  }
  if (template.cadence_type === "quarterly") {
    const quarterMonth = utcMonth === 1 || utcMonth === 4 || utcMonth === 7 || utcMonth === 10;
    const dayOfMonth = Math.min(template.day_of_month ?? 1, lastDayOfMonth);
    return quarterMonth && utcDay === dayOfMonth;
  }
  if (template.cadence_type === "yearly") {
    return utcMonth === (template.month_of_year ?? 1) && utcDay === 1;
  }
  return false;
}

function expandTemplateShifts(template: TemplateRow): Array<"day" | "evening" | "night" | null> {
  if (template.cadence_type !== "daily") {
    return [template.shift_scope && template.shift_scope !== "all" ? template.shift_scope : null];
  }

  if (template.shift_scope === "all") {
    return ["day", "evening", "night"];
  }

  return [template.shift_scope ?? "day"];
}

function resolveAssignee(args: {
  facility: FacilityRow;
  template: TemplateRow;
  profiles: ProfileRow[];
  profileAccessMap: Map<string, FacilityAccessRow[]>;
}) {
  const roleSequence = [
    ...(assigneeCrosswalk[args.template.assignee_role ?? ""] ?? []),
    ...(assigneeCrosswalk[args.template.required_role_fallback ?? ""] ?? []),
  ];

  for (const role of roleSequence) {
    const candidates = args.profiles
      .filter((profile) =>
        profile.organization_id === args.facility.organization_id &&
        profile.app_role === role
      )
      .sort((left, right) => (left.full_name || left.id).localeCompare(right.full_name || right.id));

    const primaryScoped = candidates.find((profile) =>
      (args.profileAccessMap.get(profile.id) ?? []).some((row) => row.facility_id === args.facility.id && row.is_primary)
    );
    if (primaryScoped) {
      return {
        assigned_to: primaryScoped.id,
        assigned_role: role,
      };
    }

    const scoped = candidates.find((profile) =>
      (args.profileAccessMap.get(profile.id) ?? []).some((row) => row.facility_id === args.facility.id)
    );
    if (scoped) {
      return {
        assigned_to: scoped.id,
        assigned_role: role,
      };
    }

    const orgWide = candidates.find((profile) => profile.app_role === "owner" || profile.app_role === "org_admin");
    if (orgWide) {
      return {
        assigned_to: orgWide.id,
        assigned_role: role,
      };
    }
  }

  return {
    assigned_to: null,
    assigned_role: args.template.required_role_fallback ?? args.template.assignee_role ?? null,
  };
}

function getBaseLocalTime(shift: "day" | "evening" | "night" | null) {
  if (shift === "day") return { hour: 7, minute: 0 };
  if (shift === "evening") return { hour: 15, minute: 0 };
  if (shift === "night") return { hour: 23, minute: 0 };
  return { hour: 9, minute: 0 };
}

function buildDueAt(args: {
  date: string;
  timeZone: string;
  shift: "day" | "evening" | "night" | null;
  estimatedMinutes: number | null;
  escalationLadder: Array<{ sla_minutes?: number; enabled?: boolean }>;
  fallbackHour: number;
  fallbackMinute: number;
}) {
  const firstStep = args.escalationLadder.find((step) => step.enabled !== false && typeof step.sla_minutes === "number");
  const base = zonedDateTimeToUtc(args.date, args.fallbackHour, args.fallbackMinute, args.timeZone);
  const extraMinutes = firstStep?.sla_minutes ?? Math.max(args.estimatedMinutes ?? 0, 60);
  return new Date(base.getTime() + extraMinutes * 60 * 1000);
}

function buildInstanceKey(
  organizationId: string,
  facilityId: string,
  templateId: string,
  assignedShiftDate: string,
  assignedShift: string | null,
) {
  return `${organizationId}|${facilityId}|${templateId}|${assignedShiftDate}|${assignedShift ?? "all"}`;
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: lookup.get("year") ?? "0000",
    month: lookup.get("month") ?? "01",
    day: lookup.get("day") ?? "01",
    hour: lookup.get("hour") ?? "00",
    minute: lookup.get("minute") ?? "00",
    second: lookup.get("second") ?? "00",
  };
}

function zonedDateTimeToUtc(date: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const zonedGuess = getTimeZoneParts(utcGuess, timeZone);
  const actualUtc = Date.UTC(
    Number(zonedGuess.year),
    Number(zonedGuess.month) - 1,
    Number(zonedGuess.day),
    Number(zonedGuess.hour),
    Number(zonedGuess.minute),
    Number(zonedGuess.second),
  );
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(utcGuess.getTime() + (targetUtc - actualUtc));
}
