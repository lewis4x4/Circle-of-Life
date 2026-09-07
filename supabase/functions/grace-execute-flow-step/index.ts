import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import {
  CurrentActorError,
  currentActorErrorResponse,
  requireCurrentActor,
} from "../_shared/current-actor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UNDO_WINDOW_MS = 60_000;

type RequestBody = {
  flow_id?: string;
  conversation_id?: string;
  idempotency_key?: string;
  slots?: Record<string, unknown>;
  high_value_confirmation_cents?: number;
  client_slot_updated_at?: Record<string, string>;
};

type AuthContext = {
  user: { id: string };
  accessToken: string;
  role: string;
  organizationId: string;
};

async function requireConversation(
  admin: any,
  conversationId: string,
  userId: string,
  organizationId: string,
) {
  const { data, error } = await admin
    .from("grace_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .single();
  if (error || !data) throw new Error("Grace conversation not found");
}

async function requireFacilityAccess(
  admin: any,
  facilityId: string,
  organizationId: string,
  accessibleFacilityIds: string[],
) {
  if (!accessibleFacilityIds.includes(facilityId)) {
    throw new Error("Forbidden facility");
  }

  const { data, error } = await admin
    .from("facilities")
    .select("id,name,settings,organization_id")
    .eq("id", facilityId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw new Error("Facility not found");
  return data as { id: string; name: string; settings: Record<string, unknown> | null; organization_id: string };
}

async function getResident(admin: any, residentId: string, organizationId: string, accessibleFacilityIds: string[]) {
  const { data, error } = await admin
    .from("residents")
    .select("id,facility_id,organization_id")
    .eq("id", residentId)
    .eq("organization_id", organizationId)
    .in("facility_id", accessibleFacilityIds)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw new Error("Resident not found");
  return data as { id: string; facility_id: string; organization_id: string };
}

function canonicalSlots(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSlots).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalSlots(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function computeFlowTotalCents(slots: Record<string, unknown>): number {
  const lineItems = slots.line_items;
  if (!Array.isArray(lineItems)) return 0;

  return lineItems.reduce((total, raw) => {
    if (!raw || typeof raw !== "object") return total;
    const item = raw as Record<string, unknown>;
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.unit_price ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || unitPrice <= 0) return total;
    return total + Math.round(quantity * unitPrice * 100);
  }, 0);
}

async function createDailyLog(
  admin: any,
  auth: AuthContext,
  accessibleFacilityIds: string[],
  slots: Record<string, unknown>,
  runId: string,
) {
  const resident = await getResident(admin, String(slots.resident_id ?? ""), auth.organizationId, accessibleFacilityIds);
  const payload = {
    resident_id: resident.id,
    facility_id: resident.facility_id,
    organization_id: auth.organizationId,
    log_date: String(slots.log_date ?? new Date().toISOString().slice(0, 10)),
    shift: String(slots.shift ?? "day"),
    logged_by: auth.user.id,
    general_notes: String(slots.general_notes ?? ""),
    mood: slots.mood ? String(slots.mood) : null,
    behavior_notes: slots.behavior_notes ? String(slots.behavior_notes) : null,
    created_by: auth.user.id,
    updated_by: auth.user.id,
  };
  const { data, error } = await admin.rpc("commit_grace_action", { p_run_id: runId, p_table: "daily_logs", p_payload: payload });
  if (error || !data) throw new Error(error?.message ?? "Could not commit action receipt");
  return data;
}

async function createIncident(
  admin: any,
  userScoped: any,
  auth: AuthContext,
  accessibleFacilityIds: string[],
  slots: Record<string, unknown>,
  runId: string,
) {
  const residentId = slots.resident_id ? String(slots.resident_id) : null;
  const resident = residentId ? await getResident(admin, residentId, auth.organizationId, accessibleFacilityIds) : null;
  const facilityId = resident?.facility_id ?? String(slots.facility_id ?? "");
  if (!facilityId) throw new Error("Incident requires a resident or facility");
  await requireFacilityAccess(admin, facilityId, auth.organizationId, accessibleFacilityIds);

  const { data: incidentNumberRow, error: incidentNumberError } = await userScoped.rpc("allocate_incident_number", {
    p_facility_id: facilityId,
  });
  if (incidentNumberError || !incidentNumberRow) throw new Error(incidentNumberError?.message ?? "Could not allocate incident number");

  const payload = {
    resident_id: resident?.id ?? null,
    facility_id: facilityId,
    organization_id: auth.organizationId,
    incident_number: String(incidentNumberRow),
    category: String(slots.category ?? "other"),
    severity: String(slots.severity ?? "low"),
    status: "open",
    occurred_at: String(slots.occurred_at ?? new Date().toISOString()),
    discovered_at: new Date().toISOString(),
    shift: String(slots.shift ?? "day"),
    location_description: String(slots.location_description ?? "Unspecified"),
    description: String(slots.description ?? ""),
    immediate_actions: String(slots.immediate_actions ?? ""),
    reported_by: auth.user.id,
    created_by: auth.user.id,
    updated_by: auth.user.id,
  };

  const { data, error } = await admin.rpc("commit_grace_action", { p_run_id: runId, p_table: "incidents", p_payload: payload });
  if (error || !data) throw new Error(error?.message ?? "Could not commit action receipt");
  return data;
}

async function createAssessment(
  admin: any,
  auth: AuthContext,
  accessibleFacilityIds: string[],
  slots: Record<string, unknown>,
  runId: string,
) {
  const resident = await getResident(admin, String(slots.resident_id ?? ""), auth.organizationId, accessibleFacilityIds);
  const payload = {
    resident_id: resident.id,
    facility_id: resident.facility_id,
    organization_id: auth.organizationId,
    assessment_type: String(slots.assessment_type ?? "general"),
    assessment_date: String(slots.assessment_date ?? new Date().toISOString().slice(0, 10)),
    notes: slots.notes ? String(slots.notes) : null,
    assessed_by: auth.user.id,
    next_due_date: slots.next_due_date ? String(slots.next_due_date) : null,
    created_by: auth.user.id,
    updated_by: auth.user.id,
  };
  const { data, error } = await admin.rpc("commit_grace_action", { p_run_id: runId, p_table: "assessments", p_payload: payload });
  if (error || !data) throw new Error(error?.message ?? "Could not commit action receipt");
  return data;
}

Deno.serve(async (req) => {
  const t = withTiming("grace-execute-flow-step");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  let actorAuth;
  try {
    actorAuth = await requireCurrentActor(req);
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
  }
  const { actor } = actorAuth;
  const auth: AuthContext = {
    user: { id: actor.userId },
    accessToken: actorAuth.accessToken,
    role: actor.role,
    organizationId: actor.organizationId,
  };
  const userScoped = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
  });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  if (!body.flow_id || !body.conversation_id || !body.idempotency_key || !body.slots) {
    return jsonResponse({ error: "flow_id, conversation_id, idempotency_key, and slots are required" }, 400, origin);
  }
  let accessibleFacilityIds: string[] = [...actor.accessibleFacilityIds];
  try {
    await requireConversation(admin, body.conversation_id, auth.user.id, auth.organizationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Grace request failed";
    return jsonResponse({ error: message }, message === "Grace conversation not found" ? 404 : 403, origin);
  }
  if (accessibleFacilityIds.length === 0) {
    return jsonResponse({ error: "No facility access" }, 403, origin);
  }

  const { data: existingRun } = await admin
    .from("flow_workflow_runs")
    .select("id,status,result_payload,undo_deadline,undo_handler,metadata,flow_definition_id,conversation_id,slot_values")
    .eq("organization_id", auth.organizationId)
    .eq("user_id", auth.user.id)
    .eq("idempotency_key", body.idempotency_key)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingRun?.id && (existingRun.flow_definition_id !== body.flow_id || existingRun.conversation_id !== body.conversation_id
    || canonicalSlots(existingRun.slot_values) !== canonicalSlots(body.slots))) {
    return jsonResponse({ ok: false, error: "idempotency_request_mismatch" }, 409, origin);
  }
  if (existingRun?.id && existingRun.status !== "running") {
    return jsonResponse(
      {
        ok: existingRun.status === "succeeded",
        run_id: existingRun.id,
        status: existingRun.status,
        result: existingRun.result_payload ?? {},
        undo_deadline: existingRun.undo_deadline,
        undo_handler: existingRun.undo_handler,
        replay: true,
        message: "Grace returned the original result for this idempotency key.",
      },
      200,
      origin,
    );
  }

  if (existingRun?.status === "running" && existingRun.metadata?.receipt_version !== 1) {
    return jsonResponse({ ok: false, error: "run_requires_reconciliation", run_id: existingRun.id }, 409, origin);
  }

  const { data: flowDef, error: flowError } = await admin
    .from("flow_workflow_definitions")
    .select("id,slug,name,roles_allowed,high_value_threshold_cents,grace_metadata,action_chain,undo_handler")
    .eq("id", body.flow_id)
    .eq("organization_id", auth.organizationId)
    .eq("surface", "grace")
    .eq("enabled", true)
    .is("deleted_at", null)
    .single();

  if (flowError || !flowDef) {
    return jsonResponse({ error: "flow_not_found" }, 404, origin);
  }

  const allowedRoles = (flowDef.roles_allowed as string[] | null) ?? [];
  if (allowedRoles.length > 0 && !allowedRoles.includes(auth.role)) {
    return jsonResponse({ error: "forbidden_role" }, 403, origin);
  }

  const totalCents = computeFlowTotalCents(body.slots);
  if ((flowDef.high_value_threshold_cents as number | null) && totalCents >= Number(flowDef.high_value_threshold_cents)) {
    if (body.high_value_confirmation_cents !== totalCents) {
      return jsonResponse(
        {
          ok: false,
          error: "high_value_confirmation_required",
          total_cents: totalCents,
          threshold_cents: flowDef.high_value_threshold_cents,
          message: "Grace needs an explicit confirmation for this high-value action.",
        },
        200,
        origin,
      );
    }
  }

  const undoDeadline = new Date(Date.now() + UNDO_WINDOW_MS).toISOString();
  try {
    await actorAuth.revalidate();
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
  }
  const { data: run, error: runError } = existingRun?.id ? { data: existingRun, error: null } : await admin
    .from("flow_workflow_runs")
    .insert({
      organization_id: auth.organizationId,
      flow_definition_id: flowDef.id,
      conversation_id: body.conversation_id,
      user_id: auth.user.id,
      surface: "grace",
      status: "running",
      slot_values: body.slots,
      idempotency_key: body.idempotency_key,
      undo_handler: flowDef.undo_handler,
      undo_deadline: undoDeadline,
      metadata: {
        flow_slug: flowDef.slug,
        receipt_version: 1,
      },
      started_at: new Date().toISOString(),
      created_by: auth.user.id,
      updated_by: auth.user.id,
    })
    .select("id")
    .single();

  if (runError || !run?.id) {
    return jsonResponse({ error: runError?.message ?? "run_insert_failed" }, 500, origin);
  }

  let executionResult: { result: Record<string, unknown>; undo_handler: string | null; undo_deadline: string };
  try {
    await actorAuth.revalidate();
    switch (String(flowDef.slug)) {
      case "log_daily_note":
        executionResult = await createDailyLog(admin, auth, accessibleFacilityIds, body.slots, run.id);
        break;
      case "report_incident":
        executionResult = await createIncident(admin, userScoped, auth, accessibleFacilityIds, body.slots, run.id);
        break;
      case "schedule_assessment":
        executionResult = await createAssessment(admin, auth, accessibleFacilityIds, body.slots, run.id);
        break;
      default:
        throw new Error(`Unsupported Grace flow: ${String(flowDef.slug)}`);
    }

    await admin.rpc("grace_increment_usage", {
      p_user_id: auth.user.id,
      p_organization_id: auth.organizationId,
      p_flow_executes: 1,
    });

    t.log({ event: "flow_executed", outcome: "success", flow_slug: flowDef.slug, run_id: run.id });
    return jsonResponse(
      {
        ok: true,
        run_id: run.id,
        status: "succeeded",
        result: executionResult.result,
        undo_deadline: executionResult.undo_deadline,
        undo_handler: executionResult.undo_handler,
        total_cents: totalCents,
      },
      200,
      origin,
    );
  } catch (error) {
    if (error instanceof CurrentActorError) {
      return currentActorErrorResponse(error, getCorsHeaders(origin));
    }
    const errorMessage = error instanceof Error ? error.message : "Grace flow execution failed";
    t.log({ event: "flow_failed", outcome: "error", error_message: errorMessage, flow_slug: flowDef.slug, run_id: run.id });
    return jsonResponse({ ok: false, error: "Grace flow execution failed", run_id: run.id, retryable: true, failed_step: String(flowDef.slug) }, 503, origin);
  }
});
