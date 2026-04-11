import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

async function requireUser(admin: any, req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();
  return {
    user,
    accessToken: token,
    role: String(profile?.app_role ?? user.app_metadata?.app_role ?? "caregiver"),
    organizationId: profile?.organization_id as string | undefined,
  };
}

async function resolveAccessibleFacilityIds(
  admin: any,
  organizationId: string,
  userId: string,
  role: string,
): Promise<string[]> {
  if (role === "owner" || role === "org_admin") {
    const { data } = await admin
      .from("facilities")
      .select("id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null);
    return (data ?? []).map((row: { id: string }) => row.id);
  }

  const { data } = await admin
    .from("user_facility_access")
    .select("facility_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null);

  return (data ?? []).map((row: { facility_id: string }) => row.facility_id);
}

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
  const { data, error } = await admin.from("daily_logs").insert(payload).select("id").single();
  if (error || !data?.id) throw new Error(error?.message ?? "Failed to create daily log");
  return {
    result: { daily_log_id: data.id },
    undo_handler: "delete_daily_log",
  };
}

async function createIncident(
  admin: any,
  userScoped: any,
  auth: AuthContext,
  accessibleFacilityIds: string[],
  slots: Record<string, unknown>,
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

  const { data, error } = await admin.from("incidents").insert(payload).select("id").single();
  if (error || !data?.id) throw new Error(error?.message ?? "Failed to create incident");
  return {
    result: { incident_id: data.id, incident_number: String(incidentNumberRow) },
    undo_handler: "delete_incident",
  };
}

async function createAssessment(
  admin: any,
  auth: AuthContext,
  accessibleFacilityIds: string[],
  slots: Record<string, unknown>,
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
  const { data, error } = await admin.from("assessments").insert(payload).select("id").single();
  if (error || !data?.id) throw new Error(error?.message ?? "Failed to create assessment");
  return {
    result: { assessment_id: data.id },
    undo_handler: "delete_assessment",
  };
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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const authResult = await requireUser(admin, req);
  if (!authResult?.user || !authResult.organizationId) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }
  const auth: AuthContext = {
    user: { id: authResult.user.id },
    accessToken: authResult.accessToken,
    role: authResult.role,
    organizationId: authResult.organizationId,
  };
  const userScoped = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
  });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  if (!body.flow_id || !body.conversation_id || !body.idempotency_key || !body.slots) {
    return jsonResponse({ error: "flow_id, conversation_id, idempotency_key, and slots are required" }, 400, origin);
  }
  let accessibleFacilityIds: string[] = [];
  try {
    await requireConversation(admin, body.conversation_id, auth.user.id, auth.organizationId);
    accessibleFacilityIds = await resolveAccessibleFacilityIds(admin, auth.organizationId, auth.user.id, auth.role);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Grace request failed";
    return jsonResponse({ error: message }, message === "Grace conversation not found" ? 404 : 403, origin);
  }
  if (accessibleFacilityIds.length === 0) {
    return jsonResponse({ error: "No facility access" }, 403, origin);
  }

  const { data: existingRun } = await admin
    .from("flow_workflow_runs")
    .select("id,status,result_payload,undo_deadline,undo_handler")
    .eq("organization_id", auth.organizationId)
    .eq("user_id", auth.user.id)
    .eq("idempotency_key", body.idempotency_key)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingRun?.id) {
    return jsonResponse(
      {
        ok: true,
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
  const { data: run, error: runError } = await admin
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

  let executionResult: { result: Record<string, unknown>; undo_handler: string | null };
  try {
    switch (String(flowDef.slug)) {
      case "log_daily_note":
        executionResult = await createDailyLog(admin, auth, accessibleFacilityIds, body.slots);
        break;
      case "report_incident":
        executionResult = await createIncident(admin, userScoped, auth, accessibleFacilityIds, body.slots);
        break;
      case "schedule_assessment":
        executionResult = await createAssessment(admin, auth, accessibleFacilityIds, body.slots);
        break;
      default:
        throw new Error(`Unsupported Grace flow: ${String(flowDef.slug)}`);
    }

    await admin.from("flow_workflow_run_steps").insert({
      organization_id: auth.organizationId,
      run_id: run.id,
      step_index: 0,
      step_type: "action",
      action_key: String(flowDef.slug),
      params: body.slots,
      status: "succeeded",
      result: executionResult.result,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });

    await admin
      .from("flow_workflow_runs")
      .update({
        status: "succeeded",
        result_payload: executionResult.result,
        undo_handler: executionResult.undo_handler,
        finished_at: new Date().toISOString(),
        updated_by: auth.user.id,
      })
      .eq("id", run.id);

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
        undo_deadline: undoDeadline,
        undo_handler: executionResult.undo_handler,
        total_cents: totalCents,
      },
      200,
      origin,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Grace flow execution failed";
    await admin.from("flow_workflow_run_steps").insert({
      organization_id: auth.organizationId,
      run_id: run.id,
      step_index: 0,
      step_type: "action",
      action_key: String(flowDef.slug),
      params: body.slots,
      status: "failed",
      error_text: errorMessage,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
    await admin
      .from("flow_workflow_runs")
      .update({
        status: "failed",
        error_text: errorMessage,
        finished_at: new Date().toISOString(),
        updated_by: auth.user.id,
      })
      .eq("id", run.id);

    t.log({ event: "flow_failed", outcome: "error", error_message: errorMessage, flow_slug: flowDef.slug, run_id: run.id });
    return jsonResponse({ ok: false, error: errorMessage, failed_step: String(flowDef.slug) }, 200, origin);
  }
});
