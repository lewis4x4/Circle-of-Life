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
 * Auth: x-cron-secret must match OCE_TASK_SCHEDULER_SECRET.
 *
 * COL-137: occurrence dates and due instants come from the shared schedule
 * evaluator (src/lib/operations/schedule-evaluator.ts), the same module the
 * task list, history and exception views use. Legacy template cadence
 * columns are translated into a version-1 rule that preserves the recorded
 * timing; templates without a recurrence (on-demand, event-driven, weekly
 * without a weekday) are reported as unknown schedules and never receive an
 * invented date.
 *
 * COL-139: confirmed, applicable site configurations generate subject-scoped
 * occurrences through the database command generate_operation_occurrences_service,
 * which expands bindings, pins the governing versions at each due instant and
 * converges duplicates. The scheduler evaluates the rule with the shared
 * evaluator and reports the database's per-run outcomes truthfully; it never
 * writes a managed row directly. A legacy template whose activity has such a
 * configuration in force at a site is superseded there.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { jsonResponse, getCorsHeaders } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { addDays, legacyTemplateRule, listOccurrenceDates, localDateOf, MAX_ENUMERATION_DAYS, parseDateOnly, resolveOccurrence, SCHEDULE_EVALUATOR_VERSION, validateScheduleRule } from "../../../src/lib/operations/schedule-evaluator.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COL_ORG_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_TIMEZONE = "America/New_York";
const CONFIGURATION_PAGE_SIZE = 200;
/** Existing legacy rows of the range; below PostgREST's default max_rows so no page is truncated. */
const EXISTING_PAGE_SIZE = 500;

type ExistingRow = {
  organization_id: string;
  facility_id: string;
  template_id: string;
  activity_id: string | null;
  assigned_shift_date: string;
  assigned_shift: string | null;
};
/** The generation command accepts at most this many evaluator outputs per call. */
const GENERATION_BATCH_SIZE = 400;

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
  activity_id: string | null;
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

type ConfigurationRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  activity_id: string;
  requirement_version_id: string | null;
  effective_from: string;
  effective_to: string | null;
  schedule_rule: unknown;
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

type UnknownSchedule = { template_id?: string; configuration_id?: string; facility_id: string; shift: string | null; reason: string };

type ManagedOccurrenceInput = {
  occurrence_date: string;
  period: { start_date: string; end_date: string };
  due_at: string;
  grace_ends_at: string | null;
  remind_at: string | null;
  timezone: string;
  adjustments: string[];
};

type ManagedCandidate = { configuration: ConfigurationRow; rule: unknown; occurrences: ManagedOccurrenceInput[] };

type GenerationCounts = {
  created: number;
  existing: number;
  conflict: number;
  no_binding: number;
  binding_not_current: number;
  configuration_not_in_force: number;
  invalid: number;
};

const GENERATION_COUNT_KEYS: Array<keyof GenerationCounts> = ["created", "existing", "conflict", "no_binding", "binding_not_current", "configuration_not_in_force", "invalid"];

type ManagedSummary = GenerationCounts & {
  configurations: number;
  occurrences_evaluated: number;
  rpc_failed: number;
  rpc_failures: Array<{ configuration_id: string; facility_id: string; reason: string }>;
  event_rules_awaiting_source: number;
  superseded_templates: number;
  reconciled: { facilities: number; bindings_closed: number; occurrences_cancelled: number; failed: number };
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

  const schedulerSecret = Deno.env.get("OCE_TASK_SCHEDULER_SECRET") ?? "";
  const cronSecret = req.headers.get("x-cron-secret");
  if (!schedulerSecret || cronSecret !== schedulerSecret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "scheduler secret mismatch" });
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

  const dateRange = resolveDateRange(body.date_from, body.date_to);
  if (addDays(dateRange.dateFrom, MAX_ENUMERATION_DAYS - 1) < dateRange.dateTo) {
    return jsonResponse({ error: `Date range not schedulable: range exceeds ${MAX_ENUMERATION_DAYS} days` }, 400, origin);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const categoryFilter = normalizeCategories(body.category);
  const runId = `oce-${dateRange.dateFrom}-${dateRange.dateTo}-${crypto.randomUUID()}`;
  const emptyManaged = (): ManagedSummary => ({
    configurations: 0, occurrences_evaluated: 0, created: 0, existing: 0, conflict: 0, no_binding: 0, binding_not_current: 0, configuration_not_in_force: 0, invalid: 0,
    rpc_failed: 0, rpc_failures: [], event_rules_awaiting_source: 0, superseded_templates: 0,
    reconciled: { facilities: 0, bindings_closed: 0, occurrences_cancelled: 0, failed: 0 },
  });

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
    return jsonResponse({ ok: true, dry_run: Boolean(body.dry_run), run_id: runId, inserted: 0, generated: 0, skipped_existing: 0, unknown_schedules: 0, preview: [], managed: emptyManaged() }, 200, origin);
  }
  const facilityIds = facilities.map((facility) => facility.id);
  const facilityTimezoneById = new Map(facilities.map((facility) => [facility.id, facility.timezone || DEFAULT_TIMEZONE]));

  // ---------------------------------------------------------------------------
  // COL-139 managed configurations: every published, applicable, confirmed site
  // configuration whose window touches the range, read to the last page.
  // ---------------------------------------------------------------------------
  const configurations: ConfigurationRow[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * CONFIGURATION_PAGE_SIZE;
    const { data, error } = await admin
      .from("operation_facility_requirements")
      .select("id, organization_id, facility_id, activity_id, requirement_version_id, effective_from, effective_to, schedule_rule")
      .eq("organization_id", COL_ORG_ID)
      .eq("status", "published")
      .eq("applicability", "applicable")
      .eq("schedule_status", "confirmed")
      .in("facility_id", facilityIds)
      .order("id", { ascending: true })
      .range(from, from + CONFIGURATION_PAGE_SIZE - 1);
    if (error) {
      t.log({ event: "configuration_query_failed", outcome: "error", error_message: error.message });
      return jsonResponse({ error: "Failed to load facility configurations" }, 500, origin);
    }
    const rows = (data ?? []) as ConfigurationRow[];
    configurations.push(...rows);
    if (rows.length < CONFIGURATION_PAGE_SIZE) break;
  }

  const managed = emptyManaged();
  const unknownSchedules: UnknownSchedule[] = [];
  const managedCandidates: ManagedCandidate[] = [];
  /**
   * facility|activity → local date intervals in which a confirmed, valid,
   * non-event configuration is in force. A legacy template is superseded only
   * for dates inside such an interval; a catch-up range before the
   * configuration took effect still generates from the template.
   */
  const supersededIntervals = new Map<string, Array<{ from: string; to: string }>>();

  for (const configuration of configurations) {
    const window = configurationWindow(configuration, dateRange, facilityTimezoneById.get(configuration.facility_id) ?? DEFAULT_TIMEZONE);
    if (!window) continue;
    const validated = validateScheduleRule(configuration.schedule_rule);
    if (!validated.ok) {
      unknownSchedules.push({ configuration_id: configuration.id, facility_id: configuration.facility_id, shift: null, reason: validated.problems[0] ?? "schedule rule is invalid" });
      continue;
    }
    if (validated.rule.recurrence.kind === "event") {
      // Occurrences exist only from a source event instant; no adapter supplies one here.
      managed.event_rules_awaiting_source += 1;
      continue;
    }
    // The rule's own timezone decides which local dates the window covers; a
    // configuration counts only when its window touches the range.
    const clipped = clipToWindow(window, validated.rule.timezone);
    if (!clipped) continue;
    managed.configurations += 1;
    const supersessionKey = `${configuration.facility_id}|${configuration.activity_id}`;
    supersededIntervals.set(supersessionKey, [...(supersededIntervals.get(supersessionKey) ?? []), { from: clipped.dateFrom, to: clipped.dateTo }]);
    const listed = listOccurrenceDates(validated.rule, clipped.dateFrom, clipped.dateTo);
    if (listed.kind === "unresolved") {
      unknownSchedules.push({ configuration_id: configuration.id, facility_id: configuration.facility_id, shift: null, reason: listed.reason });
      continue;
    }
    for (const entry of listed.unresolved) {
      unknownSchedules.push({ configuration_id: configuration.id, facility_id: configuration.facility_id, shift: null, reason: `${entry.date}: ${entry.reason}` });
    }
    const occurrences: ManagedOccurrenceInput[] = [];
    for (const date of listed.dates) {
      const occurrence = resolveOccurrence(validated.rule, date);
      if (occurrence.kind === "unresolved") {
        unknownSchedules.push({ configuration_id: configuration.id, facility_id: configuration.facility_id, shift: null, reason: `${date}: ${occurrence.reason}` });
        continue;
      }
      occurrences.push({
        occurrence_date: occurrence.occurrence_date,
        period: occurrence.period,
        due_at: occurrence.due_at,
        grace_ends_at: occurrence.grace_ends_at,
        remind_at: occurrence.remind_at,
        timezone: occurrence.timezone,
        adjustments: occurrence.adjustments,
      });
    }
    managed.occurrences_evaluated += occurrences.length;
    if (occurrences.length > 0) managedCandidates.push({ configuration, rule: validated.rule, occurrences });
  }

  // ---------------------------------------------------------------------------
  // Legacy templates (COL-137 translation), keyed on the stable activity so a
  // revised template never duplicates a period already generated.
  // ---------------------------------------------------------------------------
  let templateQuery = admin
    .from("operation_task_templates")
    .select(`
      id,
      organization_id,
      facility_id,
      activity_id,
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

  // Every legacy row of the range counts, including rows generated by a
  // superseded template revision of the same activity. Paged to the last short
  // page: a truncated list would silently drop the activity-keyed guarantee
  // that the template-keyed database index does not back.
  // Bounded to the loaded templates' stable activities (every template carries
  // one since 336); the template-id bound is kept only for a template without one.
  const activityIds = Array.from(new Set(templates.map((template) => template.activity_id).filter((id): id is string => Boolean(id))));
  const templateIds = templates.map((template) => template.id);
  const existingData: ExistingRow[] = [];
  for (let page = 0; templates.length > 0; page += 1) {
    const from = page * EXISTING_PAGE_SIZE;
    let existingQuery = admin
      .from("operation_task_instances")
      .select("organization_id, facility_id, template_id, activity_id, assigned_shift_date, assigned_shift")
      .eq("organization_id", COL_ORG_ID)
      .gte("assigned_shift_date", dateRange.dateFrom)
      .lte("assigned_shift_date", dateRange.dateTo)
      .in("facility_id", facilityIds);
    existingQuery = templates.every((template) => Boolean(template.activity_id)) ? existingQuery.in("activity_id", activityIds) : existingQuery.in("template_id", templateIds);
    const { data, error: existingError } = await existingQuery
      .not("template_id", "is", null)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, from + EXISTING_PAGE_SIZE - 1);
    if (existingError) {
      t.log({ event: "existing_query_failed", outcome: "error", error_message: existingError.message });
      return jsonResponse({ error: "Failed to load existing task instances" }, 500, origin);
    }
    const rows = (data ?? []) as ExistingRow[];
    existingData.push(...rows);
    if (rows.length < EXISTING_PAGE_SIZE) break;
  }

  const existingKeys = new Set(
    existingData.map((row) =>
      buildInstanceKey(
        row.organization_id,
        row.facility_id,
        row.activity_id ?? row.template_id,
        row.assigned_shift_date,
        row.assigned_shift,
      )
    ),
  );

  const candidates: CandidateInstance[] = [];
  let skippedExisting = 0;

  for (const facility of facilities) {
    const facilityTimezone = facility.timezone || DEFAULT_TIMEZONE;
    const facilityTemplates = templates.filter((template) =>
      template.organization_id === facility.organization_id &&
      (template.facility_id === null || template.facility_id === facility.id)
    );

    for (const template of facilityTemplates) {
      const supersededOn = template.activity_id ? supersededIntervals.get(`${facility.id}|${template.activity_id}`) : undefined;
      let supersededDates = 0;
      for (const shift of expandTemplateShifts(template)) {
        const translated = legacyTemplateRule(template, shift, facilityTimezone);
        if (translated.kind === "unresolved") {
          unknownSchedules.push({ template_id: template.id, facility_id: facility.id, shift, reason: translated.reason });
          continue;
        }

        const listed = listOccurrenceDates(translated.rule, dateRange.dateFrom, dateRange.dateTo);
        if (listed.kind === "unresolved") {
          return jsonResponse({ error: `Date range not schedulable: ${listed.reason}` }, 400, origin);
        }
        for (const entry of listed.unresolved) {
          unknownSchedules.push({ template_id: template.id, facility_id: facility.id, shift, reason: `${entry.date}: ${entry.reason}` });
        }

        for (const date of listed.dates) {
          if (supersededOn?.some((interval) => date >= interval.from && date <= interval.to)) {
            // Managed generation owns this activity at this site on this date.
            supersededDates += 1;
            continue;
          }
          const instanceKey = buildInstanceKey(facility.organization_id, facility.id, template.activity_id ?? template.id, date, shift);
          if (existingKeys.has(instanceKey)) {
            skippedExisting += 1;
            continue;
          }

          const occurrence = resolveOccurrence(translated.rule, date);
          if (occurrence.kind === "unresolved") {
            unknownSchedules.push({ template_id: template.id, facility_id: facility.id, shift, reason: `${date}: ${occurrence.reason}` });
            continue;
          }

          const assignment = resolveAssignee(template);
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
            due_at: occurrence.due_at,
          });

          existingKeys.add(instanceKey);
        }
      }
      if (supersededDates > 0) managed.superseded_templates += 1;
    }
  }

  candidates.sort((left, right) =>
    left.facility_id.localeCompare(right.facility_id) ||
    left.assigned_shift_date.localeCompare(right.assigned_shift_date) ||
    left.template_id.localeCompare(right.template_id) ||
    (left.assigned_shift ?? "").localeCompare(right.assigned_shift ?? "")
  );

  const managedPreview = managedCandidates.flatMap((candidate) =>
    candidate.occurrences.map((occurrence) => ({
      configuration_id: candidate.configuration.id,
      facility_id: candidate.configuration.facility_id,
      activity_id: candidate.configuration.activity_id,
      occurrence_date: occurrence.occurrence_date,
      period: occurrence.period,
      due_at: occurrence.due_at,
    }))
  );

  if (body.dry_run) {
    t.log({
      event: "dry_run_complete",
      outcome: "success",
      generated: candidates.length,
      skipped_existing: skippedExisting,
      unknown_schedules: unknownSchedules.length,
      managed_configurations: managed.configurations,
      managed_occurrences: managed.occurrences_evaluated,
      evaluator_version: SCHEDULE_EVALUATOR_VERSION,
      date_from: dateRange.dateFrom,
      date_to: dateRange.dateTo,
    });
    return jsonResponse({
      ok: true,
      dry_run: true,
      run_id: runId,
      inserted: 0,
      generated: candidates.length,
      skipped_existing: skippedExisting,
      unknown_schedules: unknownSchedules.length,
      evaluator_version: SCHEDULE_EVALUATOR_VERSION,
      preview: candidates.slice(0, 25),
      unknown_schedule_preview: unknownSchedules.slice(0, 25),
      managed,
      managed_preview: managedPreview.slice(0, 25),
    }, 200, origin);
  }

  // ---------------------------------------------------------------------------
  // Managed generation: one command per configuration batch. A failing command
  // is counted and reported; it never aborts the run or the legacy pass.
  // ---------------------------------------------------------------------------
  for (const candidate of managedCandidates) {
    for (let offset = 0; offset < candidate.occurrences.length; offset += GENERATION_BATCH_SIZE) {
      const batch = candidate.occurrences.slice(offset, offset + GENERATION_BATCH_SIZE);
      const { data, error } = await admin.rpc("generate_operation_occurrences_service", {
        p_facility: candidate.configuration.facility_id,
        p_configuration: candidate.configuration.id,
        p_occurrences: batch,
        // The stored column is sent back verbatim: the database asserts jsonb
        // equality with the rule it holds, which the evaluator's normalised
        // copy (dropped null keys, sorted months) would not satisfy.
        p_run: { run_id: runId, evaluator_version: SCHEDULE_EVALUATOR_VERSION, rule: candidate.configuration.schedule_rule, date_from: dateRange.dateFrom, date_to: dateRange.dateTo },
      });
      if (error) {
        managed.rpc_failed += 1;
        managed.rpc_failures.push({ configuration_id: candidate.configuration.id, facility_id: candidate.configuration.facility_id, reason: error.message });
        t.log({ event: "managed_generation_failed", outcome: "error", error_message: error.message, configuration_id: candidate.configuration.id });
        continue;
      }
      const counts = (data as { counts?: Partial<GenerationCounts> } | null)?.counts ?? {};
      for (const key of GENERATION_COUNT_KEYS) {
        managed[key] += Number(counts[key] ?? 0);
      }
    }
  }

  // Native retirement or transfer is reconciled by the service after
  // generation: open bindings close, only future pending work is cancelled.
  for (const facility of facilities) {
    const { data, error } = await admin.rpc("reconcile_operation_occurrences_service", { p_facility: facility.id, p_run: { run_id: runId } });
    if (error) {
      managed.reconciled.failed += 1;
      t.log({ event: "managed_reconciliation_failed", outcome: "error", error_message: error.message, facility_id: facility.id });
      continue;
    }
    // The command returns the closed/cancelled ids as arrays and the numbers under counts.
    const result = (data as { counts?: { bindings_closed?: number; occurrences_cancelled?: number } } | null)?.counts ?? {};
    managed.reconciled.facilities += 1;
    managed.reconciled.bindings_closed += Number(result.bindings_closed ?? 0);
    managed.reconciled.occurrences_cancelled += Number(result.occurrences_cancelled ?? 0);
  }

  let inserted = 0;
  if (candidates.length > 0) {
    const outcome = await insertLegacyCandidates(admin, candidates);
    if (outcome.error) {
      // Row-by-row convergence runs as separate statements, so rows inserted
      // before the failure stay; report them so the run is never misread as empty.
      t.log({ event: "insert_failed", outcome: "error", error_message: outcome.error, generated: candidates.length, inserted: outcome.inserted, skipped_existing: skippedExisting + outcome.converged });
      return jsonResponse({ error: "Failed to insert generated task instances", run_id: runId, inserted: outcome.inserted, skipped_existing: skippedExisting + outcome.converged, managed }, 500, origin);
    }
    inserted = outcome.inserted;
    skippedExisting += outcome.converged;
  }

  t.log({
    event: "complete",
    outcome: "success",
    generated: candidates.length,
    inserted,
    skipped_existing: skippedExisting,
    unknown_schedules: unknownSchedules.length,
    managed_created: managed.created,
    managed_existing: managed.existing,
    managed_conflict: managed.conflict,
    managed_rpc_failed: managed.rpc_failed,
    evaluator_version: SCHEDULE_EVALUATOR_VERSION,
    date_from: dateRange.dateFrom,
    date_to: dateRange.dateTo,
  });

  return jsonResponse({
    ok: true,
    dry_run: false,
    run_id: runId,
    inserted,
    generated: candidates.length,
    skipped_existing: skippedExisting,
    unknown_schedules: unknownSchedules.length,
    evaluator_version: SCHEDULE_EVALUATOR_VERSION,
    managed,
  }, 200, origin);
});

/**
 * PostgREST cannot target the legacy generation index (it is an expression
 * index over COALESCE(assigned_shift,'all')), so an upsert with on_conflict is
 * not available. The batch insert is attempted once; when a concurrent legacy
 * run has already created some of the rows (23505), each candidate is inserted
 * on its own and duplicates are counted as converged, never as a failure.
 */
type LegacyInsertClient = { from(table: "operation_task_instances"): { insert(rows: CandidateInstance[]): PromiseLike<{ error: { code?: string; message: string } | null }> } };

async function insertLegacyCandidates(admin: LegacyInsertClient, candidates: CandidateInstance[]) {
  const batch = await admin.from("operation_task_instances").insert(candidates);
  if (!batch.error) return { inserted: candidates.length, converged: 0, error: null };
  if (batch.error.code !== "23505") return { inserted: 0, converged: 0, error: batch.error.message };
  let inserted = 0;
  let converged = 0;
  for (const candidate of candidates) {
    const single = await admin.from("operation_task_instances").insert([candidate]);
    if (!single.error) inserted += 1;
    else if (single.error.code === "23505") converged += 1;
    else return { inserted, converged, error: single.error.message };
  }
  return { inserted, converged, error: null };
}

function resolveDateRange(dateFrom?: string, dateTo?: string) {
  const defaultDate = localDateOf(new Date(), DEFAULT_TIMEZONE);
  const normalizedFrom = normalizeDateOnly(dateFrom) ?? defaultDate;
  const normalizedTo = normalizeDateOnly(dateTo) ?? normalizedFrom;
  return normalizedFrom <= normalizedTo
    ? { dateFrom: normalizedFrom, dateTo: normalizedTo }
    : { dateFrom: normalizedTo, dateTo: normalizedFrom };
}

function normalizeDateOnly(value?: string) {
  if (!value) return null;
  if (parseDateOnly(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeCategories(category?: string | string[]) {
  if (Array.isArray(category)) return category.filter(Boolean);
  if (!category) return [];
  return [category];
}

/** The configuration window as instants, or null when it cannot touch the range in the facility zone. */
function configurationWindow(configuration: ConfigurationRow, range: { dateFrom: string; dateTo: string }, facilityTimezone: string) {
  const from = new Date(configuration.effective_from);
  const to = configuration.effective_to ? new Date(configuration.effective_to) : null;
  if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) return null;
  // The window is intersected with the range only in the rule's own zone
  // (clipToWindow); a facility-zone pre-check could drop a configuration whose
  // rule-local start date is the range's last day. The facility zone is kept
  // for the operator-facing reason wording only.
  void facilityTimezone;
  return { from, to, range };
}

function clipToWindow(window: { from: Date; to: Date | null; range: { dateFrom: string; dateTo: string } }, timezone: string) {
  const startDate = localDateOf(window.from, timezone);
  const endDate = window.to ? localDateOf(window.to, timezone) : null;
  const dateFrom = startDate > window.range.dateFrom ? startDate : window.range.dateFrom;
  const dateTo = endDate && endDate < window.range.dateTo ? endDate : window.range.dateTo;
  if (dateFrom > dateTo) return null;
  return { dateFrom, dateTo };
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

function resolveAssignee(template: TemplateRow) {
  const roleSequence = [
    ...(assigneeCrosswalk[template.assignee_role ?? ""] ?? []),
    ...(assigneeCrosswalk[template.required_role_fallback ?? ""] ?? []),
  ];

  // Keep recurring work in its qualified role queue until on-duty staff claim it.
  // An alphabetical profile list is not evidence that a person is working this shift.
  return { assigned_to: null, assigned_role: roleSequence[0] ?? null };
}

function buildInstanceKey(
  organizationId: string,
  facilityId: string,
  activityOrTemplateId: string,
  assignedShiftDate: string,
  assignedShift: string | null,
) {
  return `${organizationId}|${facilityId}|${activityOrTemplateId}|${assignedShiftDate}|${assignedShift ?? "all"}`;
}
