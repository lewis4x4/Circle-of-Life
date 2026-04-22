/**
 * OCE escalation scanner.
 *
 * Trigger: scheduled / manual POST
 * Auth: x-cron-secret must match OCE_ESCALATION_SCANNER_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { jsonResponse, getCorsHeaders } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

type EscalationStep = {
  role: string;
  sla_minutes: number;
  channel: "in_app" | "sms" | "voice";
  enabled: boolean;
};

type TaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  template_id: string | null;
  template_name: string;
  assigned_to: string | null;
  assigned_role: string | null;
  status: string;
  due_at: string | null;
  current_escalation_level: number | null;
  escalation_history: unknown;
  license_threatening: boolean | null;
};

type TemplateRow = {
  id: string;
  escalation_ladder: unknown;
};

type ProfileRow = {
  id: string;
  app_role: string;
  full_name: string | null;
  phone: string | null;
};

type FacilityAccessRow = {
  user_id: string;
  is_primary: boolean;
};

const roleCrosswalk: Record<string, string[]> = {
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
  const t = withTiming("oce-escalation-scanner");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const secret = Deno.env.get("OCE_ESCALATION_SCANNER_SECRET") ?? "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);
  let body: { dry_run?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const { data: taskData, error: taskError } = await admin
    .from("operation_task_instances")
    .select("id, organization_id, facility_id, template_id, template_name, assigned_to, assigned_role, status, due_at, current_escalation_level, escalation_history, license_threatening")
    .in("status", ["pending", "in_progress"])
    .not("due_at", "is", null)
    .lt("due_at", new Date().toISOString())
    .is("deleted_at", null)
    .order("due_at", { ascending: true })
    .limit(100);

  if (taskError) {
    t.log({ event: "task_query_failed", outcome: "error", error_message: taskError.message });
    return jsonResponse({ error: taskError.message }, 500, origin);
  }

  const tasks = (taskData ?? []) as TaskRow[];
  let escalated = 0;
  let notified = 0;
  const errors: string[] = [];

  for (const task of tasks) {
    try {
      const { data: templateData } = await admin
        .from("operation_task_templates" as never)
        .select("id, escalation_ladder")
        .eq("id", task.template_id)
        .maybeSingle();

      const template = templateData as unknown as TemplateRow | null;
      const ladder = parseEscalationLadder(template?.escalation_ladder);
      const currentLevel = task.current_escalation_level ?? 0;
      const nextStep = ladder[currentLevel] ?? null;

      const resolution = await resolveTarget(admin, task, nextStep);
      const channel = nextStep?.channel ?? (task.license_threatening ? "voice" : "sms");
      const nextDueAt = nextStep ? computeNextDueAt(ladder, currentLevel) : null;
      const historyEntry = {
        escalated_at: new Date().toISOString(),
        escalated_to_role: nextStep?.role ?? "owner",
        assigned_role: resolution.assignedRole,
        assigned_user_id: resolution.assignedUserId,
        assigned_user_name: resolution.assignedUserName,
        channel,
        reason: "Automatic overdue escalation",
        initiated_by: "oce-escalation-scanner",
      };

      const history = normalizeHistory(task.escalation_history);
      history.push(historyEntry);

      const delivery = await deliverEscalation({
        task,
        channel,
        phone: resolution.assignedUserPhone,
        name: resolution.assignedUserName ?? resolution.assignedRole ?? "operations owner",
        dryRun: Boolean(body.dry_run),
      });

      if (!body.dry_run) {
        const { error: updateError } = await admin
          .from("operation_task_instances" as never)
          .update({
            assigned_to: resolution.assignedUserId,
            assigned_role: resolution.assignedRole,
            current_escalation_level: nextStep ? currentLevel + 1 : currentLevel,
            escalation_triggered_at: new Date().toISOString(),
            escalation_history: history,
            due_at: nextDueAt,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", task.id);

        if (updateError) throw updateError;
        escalated += 1;

        await admin.from("operation_escalation_deliveries" as never).insert({
          organization_id: task.organization_id,
          facility_id: task.facility_id,
          task_instance_id: task.id,
          escalation_level: nextStep ? currentLevel + 1 : currentLevel,
          target_role: resolution.assignedRole,
          target_user_id: resolution.assignedUserId,
          target_phone: resolution.assignedUserPhone,
          channel,
          delivery_status: delivery.status,
          provider_message_id: delivery.providerMessageId,
          provider_payload: delivery.providerPayload,
          error_message: delivery.errorMessage,
        } as never);

        await admin.from("operation_audit_log" as never).insert({
          organization_id: task.organization_id,
          facility_id: task.facility_id,
          task_instance_id: task.id,
          event_type: "escalated",
          from_status: task.status,
          to_status: task.status,
          actor_role: "system",
          event_notes: delivery.status === "sent"
            ? `Escalated via ${channel}`
            : `Escalation ${delivery.status}${delivery.errorMessage ? `: ${delivery.errorMessage}` : ""}`,
          event_data: {
            escalation_level: nextStep ? currentLevel + 1 : currentLevel,
            channel,
            delivery_status: delivery.status,
          },
        } as never);
      }

      if (delivery.status === "sent") {
        notified += 1;
      }
    } catch (error) {
      errors.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  t.log({
    event: "complete",
    outcome: errors.length > 0 ? "error" : "success",
    tasks_scanned: tasks.length,
    escalated,
    notified,
    error_count: errors.length,
  });

  return jsonResponse({
    ok: errors.length === 0,
    dry_run: Boolean(body.dry_run),
    tasks_scanned: tasks.length,
    escalated,
    notified,
    errors,
  }, errors.length > 0 ? 207 : 200, origin);
});

function parseEscalationLadder(input: unknown): EscalationStep[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "",
      sla_minutes: typeof entry.sla_minutes === "number" ? entry.sla_minutes : 0,
      channel: entry.channel === "voice" ? "voice" : entry.channel === "sms" ? "sms" : "in_app",
      enabled: entry.enabled !== false,
    }))
    .filter((entry) => entry.role && entry.enabled);
}

function computeNextDueAt(steps: EscalationStep[], index: number) {
  const current = steps[index];
  const next = steps[index + 1];
  if (!current || !next) return null;
  const delta = Math.max(5, next.sla_minutes - current.sla_minutes);
  return new Date(Date.now() + delta * 60_000).toISOString();
}

function normalizeHistory(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
}

async function resolveTarget(
  admin: ReturnType<typeof createClient>,
  task: TaskRow,
  nextStep: EscalationStep | null,
) {
  const targetRole = nextStep?.role ?? "owner";
  const candidateRoles = roleCrosswalk[targetRole] ?? ["owner", "org_admin"];

  const { data: userData } = await admin
    .from("user_profiles")
    .select("id, app_role, full_name, phone")
    .eq("organization_id", task.organization_id)
    .eq("is_active", true)
    .is("deleted_at", null);

  const users = ((userData ?? []) as ProfileRow[]).filter((user) => candidateRoles.includes(user.app_role));
  if (users.length === 0) {
    return {
      assignedUserId: null,
      assignedRole: targetRole,
      assignedUserName: null,
      assignedUserPhone: null,
    };
  }

  const { data: accessData } = await admin
    .from("user_facility_access")
    .select("user_id, is_primary")
    .eq("organization_id", task.organization_id)
    .eq("facility_id", task.facility_id)
    .in("user_id", users.map((user) => user.id))
    .is("revoked_at", null);

  const accessRows = (accessData ?? []) as FacilityAccessRow[];
  const primaryIds = new Set(accessRows.filter((row) => row.is_primary).map((row) => row.user_id));
  const accessibleIds = new Set(accessRows.map((row) => row.user_id));
  const selected = users
    .filter((user) => accessibleIds.has(user.id) || user.app_role === "owner" || user.app_role === "org_admin")
    .sort((left, right) => {
      const leftPrimary = primaryIds.has(left.id) ? 0 : 1;
      const rightPrimary = primaryIds.has(right.id) ? 0 : 1;
      if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;
      return (left.full_name || left.id).localeCompare(right.full_name || right.id);
    })[0];

  return {
    assignedUserId: selected?.id ?? null,
    assignedRole: selected?.app_role ?? targetRole,
    assignedUserName: selected?.full_name ?? null,
    assignedUserPhone: selected?.phone ?? null,
  };
}

async function deliverEscalation(args: {
  task: TaskRow;
  channel: "in_app" | "sms" | "voice";
  phone: string | null;
  name: string;
  dryRun: boolean;
}) {
  if (args.dryRun) {
    return { status: "skipped" as const, providerMessageId: null, providerPayload: { reason: "dry_run" }, errorMessage: null };
  }
  if (args.channel === "in_app") {
    return { status: "skipped" as const, providerMessageId: null, providerPayload: { reason: "in_app_only" }, errorMessage: null };
  }

  if (!args.phone) {
    return { status: "skipped" as const, providerMessageId: null, providerPayload: { reason: "missing_phone" }, errorMessage: "Target phone missing" };
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const smsFrom = Deno.env.get("TWILIO_SMS_FROM");
  const voiceFrom = Deno.env.get("TWILIO_VOICE_FROM");
  if (!accountSid || !authToken || (!smsFrom && args.channel === "sms") || (!voiceFrom && args.channel === "voice")) {
    return { status: "skipped" as const, providerMessageId: null, providerPayload: { reason: "missing_twilio_config" }, errorMessage: "Twilio config missing" };
  }

  const body = `[Haven OCE] ${args.task.template_name} is overdue and has escalated to ${args.name}.`;
  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);

  if (args.channel === "sms") {
    const form = new URLSearchParams({
      To: args.phone,
      From: smsFrom!,
      Body: body,
    });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? { status: "sent" as const, providerMessageId: payload.sid ?? null, providerPayload: payload, errorMessage: null }
      : { status: "failed" as const, providerMessageId: null, providerPayload: payload, errorMessage: payload.message ?? "Twilio SMS failed" };
  }

  const twiml = `<Response><Say voice="alice">${escapeXml(body)}</Say></Response>`;
  const form = new URLSearchParams({
    To: args.phone,
    From: voiceFrom!,
    Twiml: twiml,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return response.ok
    ? { status: "sent" as const, providerMessageId: payload.sid ?? null, providerPayload: payload, errorMessage: null }
    : { status: "failed" as const, providerMessageId: null, providerPayload: payload, errorMessage: payload.message ?? "Twilio voice failed" };
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
