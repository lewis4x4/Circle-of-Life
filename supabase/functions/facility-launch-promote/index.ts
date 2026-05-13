import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { PROMOTERS } from "./promoters/index.ts";
import type {
  ModulePromotionResult,
  ModuleValueRow,
  ModuleValues,
  PromotionContext,
  PromotionResponse,
} from "./promoters/_types.ts";

type AdminClient = SupabaseClient;

type RequestBody = {
  organization_id?: string;
  facility_id?: string;
  modules?: string[] | null;
  dry_run?: boolean;
};

type Profile = {
  app_role?: string | null;
  organization_id?: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
};

type Actor = {
  userId: string;
  role: string;
  organizationId: string;
};

type HandlerOptions = {
  createAdminClient?: () => AdminClient;
  now?: () => Date;
};

const ADMIN_ROLES = new Set(["owner", "org_admin", "facility_admin"]);

function defaultCreateAdminClient(): AdminClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

function response(
  body: unknown,
  origin: string | null,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeModules(modules?: string[] | null): string[] | null {
  if (!Array.isArray(modules)) return null;
  const normalized = modules
    .map((moduleCode) => String(moduleCode || "").trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function notImplementedResult(moduleCode: string): ModulePromotionResult {
  return {
    module_code: moduleCode,
    status: "not_implemented",
    summary: `Promoter for ${moduleCode} not implemented yet.`,
    tables_touched: [],
    warnings: [],
    errors: [],
    prerequisites_unmet: [],
  };
}

function summarize(
  results: ModulePromotionResult[],
  gapModules: string[],
  mode: "apply" | "dry_run",
): string {
  if (results.length === 0) {
    return gapModules.length > 0
      ? `No requested Facility Launch modules had intake data for ${mode}.`
      : `No Facility Launch intake modules available for ${mode}.`;
  }
  const notImplemented =
    results.filter((result) => result.status === "not_implemented").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const gaps = gapModules.length;
  const operationalNote = notImplemented === results.length
    ? " No operational writes were performed."
    : "";
  return `${
    mode === "dry_run" ? "Dry run planned" : "Apply recorded"
  } ${results.length} module(s); ${notImplemented} not implemented, ${failed} failed, ${gaps} gap module(s).${operationalNote}`;
}

function finalRunStatus(
  results: ModulePromotionResult[],
): "succeeded" | "partial" | "failed" {
  if (results.length === 0) return "succeeded";
  if (results.every((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status !== "promoted")) return "partial";
  return "succeeded";
}

async function loadActor(
  admin: AdminClient,
  token: string,
  origin: string | null,
): Promise<Actor | Response> {
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("app_role, organization_id, is_active, deleted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return jsonResponse({ error: "Profile not found" }, 403, origin);
  }
  const typedProfile = profile as Profile;
  const role = typedProfile.app_role ?? "caregiver";
  if (!ADMIN_ROLES.has(role)) {
    return jsonResponse(
      { error: "Forbidden: owner/org_admin/facility_admin only" },
      403,
      origin,
    );
  }
  if (!typedProfile.organization_id) {
    return jsonResponse({ error: "Profile has no organization" }, 403, origin);
  }
  if (typedProfile.is_active === false || typedProfile.deleted_at) {
    return jsonResponse({ error: "Profile inactive" }, 403, origin);
  }

  return {
    userId: user.id,
    role,
    organizationId: typedProfile.organization_id,
  };
}

async function ensureFacilityAccess(
  admin: AdminClient,
  actor: Actor,
  facilityId: string,
  origin: string | null,
): Promise<Response | null> {
  const { data: facility, error: facilityError } = await admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (facilityError || !facility) {
    return jsonResponse(
      { error: "Facility not found or forbidden" },
      403,
      origin,
    );
  }

  if (actor.role !== "facility_admin") return null;

  const { data: grant, error: grantError } = await admin
    .from("user_facility_access")
    .select("id")
    .eq("user_id", actor.userId)
    .eq("facility_id", facilityId)
    .eq("organization_id", actor.organizationId)
    .is("revoked_at", null)
    .maybeSingle();

  if (grantError || !grant) {
    return jsonResponse({ error: "Facility access required" }, 403, origin);
  }
  return null;
}

async function loadModuleValues(
  admin: AdminClient,
  organizationId: string,
  facilityId: string,
): Promise<ModuleValueRow[]> {
  const { data, error } = await admin
    .from("facility_launch_module_values")
    .select("id, module_code, field_path, value")
    .eq("organization_id", organizationId)
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .is("superseded_at", null);

  if (error) {
    throw new Error(
      `Failed to load Facility Launch module values: ${error.message}`,
    );
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    module_code: String(row.module_code || "").trim().toUpperCase(),
    field_path: String(row.field_path || ""),
    value: row.value,
  })).filter((row) => row.module_code);
}

function groupByModule(
  values: ModuleValueRow[],
): Map<string, ModuleValueRow[]> {
  const grouped = new Map<string, ModuleValueRow[]>();
  for (const value of values) {
    const rows = grouped.get(value.module_code) ?? [];
    rows.push(value);
    grouped.set(value.module_code, rows);
  }
  return grouped;
}

function toModuleValues(rows: ModuleValueRow[]): ModuleValues {
  return rows.reduce<ModuleValues>((moduleValues, row) => {
    moduleValues[row.field_path] = row.value;
    return moduleValues;
  }, {});
}

async function planModules(params: {
  admin: AdminClient;
  organizationId: string;
  facilityId: string;
  actorUserId: string;
  requestedModules: string[] | null;
  values: ModuleValueRow[];
  dryRun: boolean;
}): Promise<
  {
    results: ModulePromotionResult[];
    gapModules: string[];
    processedModules: string[];
  }
> {
  const grouped = groupByModule(params.values);
  const availableModules = Array.from(grouped.keys()).sort();
  const modulesToProcess = (params.requestedModules ?? availableModules).filter(
    (moduleCode) => grouped.has(moduleCode),
  );
  const gapModules = params.requestedModules
    ? params.requestedModules.filter((moduleCode) => !grouped.has(moduleCode))
    : [];

  const results: ModulePromotionResult[] = [];
  for (const moduleCode of modulesToProcess) {
    const promoter = PROMOTERS[moduleCode];
    if (!promoter) {
      results.push(notImplementedResult(moduleCode));
      continue;
    }

    const moduleValues = toModuleValues(grouped.get(moduleCode) ?? []);
    const readiness = promoter.canPromote(moduleValues);
    if (!readiness.ready) {
      results.push({
        module_code: moduleCode,
        status: "skipped",
        summary: `${moduleCode} prerequisites unmet.`,
        tables_touched: [],
        warnings: [],
        errors: [],
        prerequisites_unmet: readiness.missing,
      });
      continue;
    }

    const context: PromotionContext = {
      admin: params.admin,
      organization_id: params.organizationId,
      facility_id: params.facilityId,
      actor_user_id: params.actorUserId,
      dry_run: params.dryRun,
      run_id: null,
    };
    results.push(await promoter.promote(context, moduleValues));
  }

  return { results, gapModules, processedModules: modulesToProcess };
}

async function insertRun(admin: AdminClient, params: {
  actor: Actor;
  facilityId: string;
  requestedModules: string[];
  processedModules: string[];
  gapModules: string[];
  summary: string;
  now: Date;
}): Promise<string> {
  const { data, error } = await admin
    .from("facility_launch_promotion_runs")
    .insert({
      organization_id: params.actor.organizationId,
      facility_id: params.facilityId,
      dry_run: false,
      status: "running",
      modules_requested: params.requestedModules,
      summary: params.summary,
      triggered_by: params.actor.userId,
      started_at: params.now.toISOString(),
      metadata: {
        processed_modules: params.processedModules,
        gap_modules: params.gapModules,
      },
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Promotion run insert failed: ${error?.message ?? "missing id"}`,
    );
  }
  return String(data.id);
}

async function insertRunItems(
  admin: AdminClient,
  runId: string,
  actor: Actor,
  facilityId: string,
  results: ModulePromotionResult[],
): Promise<void> {
  if (results.length === 0) return;
  const rows = results.map((result) => ({
    run_id: runId,
    organization_id: actor.organizationId,
    facility_id: facilityId,
    module_code: result.module_code,
    status: result.status,
    summary: result.summary,
    tables_touched: result.tables_touched,
    warnings: result.warnings,
    errors: result.errors,
    prerequisites_unmet: result.prerequisites_unmet,
  }));
  const { error } = await admin.from("facility_launch_promotion_run_items")
    .insert(rows);
  if (error) {
    throw new Error(`Promotion run item insert failed: ${error.message}`);
  }
}

async function updateRun(
  admin: AdminClient,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("facility_launch_promotion_runs")
    .update(patch)
    .eq("id", runId);
  if (error) throw new Error(`Promotion run update failed: ${error.message}`);
}

async function handlePromotion(
  req: Request,
  admin: AdminClient,
  now: () => Date,
): Promise<Response> {
  const origin = req.headers.get("origin");
  const token = bearerToken(req);
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401, origin);

  const actor = await loadActor(admin, token, origin);
  if (actor instanceof Response) return actor;

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  const facilityId = String(body.facility_id || "").trim();
  if (!facilityId) {
    return jsonResponse({ error: "facility_id required" }, 400, origin);
  }

  const requestedOrg = body.organization_id?.trim() || actor.organizationId;
  if (requestedOrg !== actor.organizationId) {
    return jsonResponse(
      { error: "Cross-organization promotion is forbidden" },
      403,
      origin,
    );
  }

  const accessError = await ensureFacilityAccess(
    admin,
    actor,
    facilityId,
    origin,
  );
  if (accessError) return accessError;

  const requestedModules = normalizeModules(body.modules);
  const dryRun = body.dry_run === true;
  const mode = dryRun ? "dry_run" : "apply";

  let runId: string | null = null;
  try {
    const values = await loadModuleValues(
      admin,
      actor.organizationId,
      facilityId,
    );
    const { results, gapModules, processedModules } = await planModules({
      admin,
      organizationId: actor.organizationId,
      facilityId,
      actorUserId: actor.userId,
      requestedModules,
      values,
      dryRun,
    });
    const summary = summarize(results, gapModules, mode);

    if (!dryRun) {
      runId = await insertRun(admin, {
        actor,
        facilityId,
        requestedModules: requestedModules ?? [],
        processedModules,
        gapModules,
        summary,
        now: now(),
      });
      await insertRunItems(admin, runId, actor, facilityId, results);
      const status = finalRunStatus(results);
      await updateRun(admin, runId, {
        status,
        finished_at: now().toISOString(),
        summary,
        metadata: {
          processed_modules: processedModules,
          gap_modules: gapModules,
          final_status: status,
        },
      });
    }

    const payload: PromotionResponse = {
      run_id: runId,
      organization_id: actor.organizationId,
      facility_id: facilityId,
      mode,
      modules_promoted: results,
      summary,
      gap_modules: gapModules,
    };
    return response(payload, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!dryRun && runId) {
      await updateRun(admin, runId, {
        status: "failed",
        finished_at: now().toISOString(),
        metadata: { error_message: message },
      }).catch(() => undefined);
    }
    console.error("facility-launch-promote failed", {
      run_id: runId,
      error: message,
    });
    return jsonResponse(
      { error: "Promotion failed", run_id: runId },
      500,
      origin,
    );
  }
}

export function createHandler(
  options: HandlerOptions = {},
): (req: Request) => Promise<Response> {
  const adminFactory = options.createAdminClient ?? defaultCreateAdminClient;
  const now = options.now ?? (() => new Date());
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: getCorsHeaders(origin) });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    let admin: AdminClient;
    try {
      admin = adminFactory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500, origin);
    }
    return handlePromotion(req, admin, now);
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
