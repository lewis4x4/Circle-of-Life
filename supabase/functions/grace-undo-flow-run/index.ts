import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type RequestBody = { run_id?: string };

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
    role: String(profile?.app_role ?? user.app_metadata?.app_role ?? "caregiver"),
    organizationId: profile?.organization_id as string | undefined,
  };
}

async function softDelete(admin: any, table: string, id: string, organizationId: string, userId: string) {
  const { error } = await admin
    .from(table)
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  const t = withTiming("grace-undo-flow-run");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const auth = await requireUser(admin, req);
  if (!auth?.user || !auth.organizationId) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  if (!body.run_id) {
    return jsonResponse({ error: "run_id is required" }, 400, origin);
  }

  const { data: run, error: runError } = await admin
    .from("flow_workflow_runs")
    .select("id,user_id,status,undo_deadline,undo_handler,result_payload,organization_id,metadata")
    .eq("id", body.run_id)
    .eq("organization_id", auth.organizationId)
    .single();

  if (runError || !run) {
    return jsonResponse({ error: "run_not_found" }, 404, origin);
  }
  if (run.user_id !== auth.user.id && !["owner", "org_admin", "facility_admin", "manager"].includes(auth.role)) {
    return jsonResponse({ error: "forbidden" }, 403, origin);
  }
  if (run.status !== "succeeded") {
    return jsonResponse({ error: "run_not_undoable" }, 400, origin);
  }
  if (!run.undo_deadline || new Date(run.undo_deadline).getTime() < Date.now()) {
    return jsonResponse({ error: "undo_window_expired" }, 400, origin);
  }

  const resultPayload = (run.result_payload ?? {}) as Record<string, unknown>;
  const log: Array<{ step: string; ok: boolean; detail?: string }> = [];

  try {
    switch (String(run.undo_handler ?? "")) {
      case "delete_daily_log":
        if (typeof resultPayload.daily_log_id !== "string") throw new Error("Missing daily log id");
        await softDelete(admin, "daily_logs", resultPayload.daily_log_id, auth.organizationId, auth.user.id);
        log.push({ step: "delete_daily_log", ok: true });
        break;
      case "delete_incident":
        if (typeof resultPayload.incident_id !== "string") throw new Error("Missing incident id");
        await softDelete(admin, "incidents", resultPayload.incident_id, auth.organizationId, auth.user.id);
        log.push({ step: "delete_incident", ok: true });
        break;
      case "delete_assessment":
        if (typeof resultPayload.assessment_id !== "string") throw new Error("Missing assessment id");
        await softDelete(admin, "assessments", resultPayload.assessment_id, auth.organizationId, auth.user.id);
        log.push({ step: "delete_assessment", ok: true });
        break;
      default:
        throw new Error("Unsupported undo handler");
    }

    await admin
      .from("flow_workflow_runs")
      .update({
        status: "undone",
        metadata: {
          ...(run.metadata ?? {}),
          compensation_log: log,
          undone_at: new Date().toISOString(),
          undone_by: auth.user.id,
        },
        updated_by: auth.user.id,
      })
      .eq("id", run.id);

    t.log({ event: "undo_ok", outcome: "success", run_id: run.id });
    return jsonResponse({ ok: true, run_id: run.id, compensation_log: log }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Grace undo failed";
    t.log({ event: "undo_failed", outcome: "error", run_id: run.id, error_message: message });
    return jsonResponse({ ok: false, error: message, compensation_log: log }, 200, origin);
  }
});
