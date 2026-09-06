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
    .eq("is_active", true)
    .is("deleted_at", null)
    .single();
  if (!profile) return null;
  return {
    user,
    role: String(profile?.app_role ?? user.app_metadata?.app_role ?? "caregiver"),
    organizationId: profile?.organization_id as string | undefined,
  };
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

  const { data, error } = await admin.rpc("undo_grace_action", { p_run_id: body.run_id, p_actor_id: auth.user.id });
  if (error || !data?.ok) {
    t.log({ event: "undo_failed", outcome: "error", run_id: body.run_id });
    return jsonResponse({ ok: false, error: "Undo could not be completed. The record may have changed or be outside your facility access." }, 409, origin);
  }
  t.log({ event: "undo_ok", outcome: "success", run_id: body.run_id });
  return jsonResponse(data, 200, origin);
});
