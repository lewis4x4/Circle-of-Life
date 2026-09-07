import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { pickRedacted } from "../_shared/redact-pii.ts";
import {
  CurrentActorError,
  type CurrentActorAuthorization,
  currentActorErrorResponse,
  requireCurrentActor,
} from "../_shared/current-actor.ts";
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

type Actor = {
  userId: string;
  role: string;
  organizationId: string;
};

type HandlerOptions = {
  createAdminClient?: () => AdminClient;
  authorizeActor?: (req: Request) => Promise<CurrentActorAuthorization>;
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
  if (results.some((result) => result.status === "failed")) return "partial";
  if (results.some((result) => result.status === "not_implemented")) return "partial";
  return "succeeded";
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

function prepareModulePlan(values: ModuleValueRow[], requestedModules: string[] | null): {
  grouped: Map<string, ModuleValueRow[]>;
  modulesToProcess: string[];
  gapModules: string[];
} {
  const grouped = groupByModule(values);
  const availableModules = Array.from(grouped.keys()).sort();
  const modulesToProcess = (requestedModules ?? availableModules).filter((moduleCode) => grouped.has(moduleCode));
  const gapModules = requestedModules ? requestedModules.filter((moduleCode) => !grouped.has(moduleCode)) : [];
  return { grouped, modulesToProcess, gapModules };
}

function moduleValueIdsByPath(rows: ModuleValueRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((ids, row) => {
    ids[row.field_path] = row.id;
    return ids;
  }, {});
}

async function insertRunItem(
  admin: AdminClient,
  runId: string,
  actor: Actor,
  facilityId: string,
  moduleCode: string,
): Promise<string> {
  const { data, error } = await admin
    .from("facility_launch_promotion_run_items")
    .insert({
      run_id: runId,
      organization_id: actor.organizationId,
      facility_id: facilityId,
      module_code: moduleCode,
      status: "running",
      summary: `${moduleCode} promotion running.`,
      tables_touched: [],
      warnings: [],
      errors: [],
      prerequisites_unmet: [],
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    throw new Error(`Promotion run item insert failed for ${moduleCode}: ${error?.message ?? "missing id"}`);
  }
  return String(data.id);
}

async function updateRunItem(
  admin: AdminClient,
  runItemId: string,
  result: ModulePromotionResult,
): Promise<void> {
  const { error } = await admin
    .from("facility_launch_promotion_run_items")
    .update({
      status: result.status,
      summary: result.summary,
      tables_touched: result.tables_touched,
      warnings: result.warnings,
      errors: result.errors,
      prerequisites_unmet: result.prerequisites_unmet,
    })
    .eq("id", runItemId);
  if (error) throw new Error(`Promotion run item update failed: ${error.message}`);
}

async function promoteModules(params: {
  admin: AdminClient;
  organizationId: string;
  facilityId: string;
  actor: Actor;
  grouped: Map<string, ModuleValueRow[]>;
  modulesToProcess: string[];
  dryRun: boolean;
  runId: string | null;
  actorAuth: CurrentActorAuthorization;
}): Promise<ModulePromotionResult[]> {
  const results: ModulePromotionResult[] = [];
  for (const moduleCode of params.modulesToProcess) {
    await params.actorAuth.revalidate(params.facilityId);
    const rows = params.grouped.get(moduleCode) ?? [];
    const promoter = PROMOTERS[moduleCode];
    if (!promoter) {
      const result = notImplementedResult(moduleCode);
      if (!params.dryRun && params.runId) {
        await params.actorAuth.revalidate(params.facilityId);
        const itemId = await insertRunItem(params.admin, params.runId, params.actor, params.facilityId, moduleCode);
        await params.actorAuth.revalidate(params.facilityId);
        await updateRunItem(params.admin, itemId, result);
      }
      results.push(result);
      continue;
    }

    const moduleValues = toModuleValues(rows);
    const readiness = promoter.canPromote(moduleValues);
    if (!readiness.ready) {
      const result: ModulePromotionResult = {
        module_code: moduleCode,
        status: "skipped",
        summary: `${moduleCode} prerequisites unmet.`,
        tables_touched: [],
        warnings: [],
        errors: [],
        prerequisites_unmet: readiness.missing,
      };
      if (!params.dryRun && params.runId) {
        await params.actorAuth.revalidate(params.facilityId);
        const itemId = await insertRunItem(params.admin, params.runId, params.actor, params.facilityId, moduleCode);
        await params.actorAuth.revalidate(params.facilityId);
        await updateRunItem(params.admin, itemId, result);
      }
      results.push(result);
      continue;
    }

    let runItemId: string | null = null;
    if (!params.dryRun && params.runId) {
      await params.actorAuth.revalidate(params.facilityId);
      runItemId = await insertRunItem(params.admin, params.runId, params.actor, params.facilityId, moduleCode);
    }

    try {
      const context: PromotionContext = {
        admin: params.admin,
        organization_id: params.organizationId,
        facility_id: params.facilityId,
        actor_user_id: params.actor.userId,
        dry_run: params.dryRun,
        run_id: params.runId,
        run_item_id: runItemId,
        module_value_ids_by_path: moduleValueIdsByPath(rows),
        revalidate: () => params.actorAuth.revalidate(params.facilityId),
      };
      await params.actorAuth.revalidate(params.facilityId);
      const result = await promoter.promote(context, moduleValues);
      if (!params.dryRun && runItemId) {
        await params.actorAuth.revalidate(params.facilityId);
        await updateRunItem(params.admin, runItemId, result);
      }
      results.push(result);
    } catch (error) {
      if (error instanceof CurrentActorError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const result: ModulePromotionResult = {
        module_code: moduleCode,
        status: "failed",
        summary: `${moduleCode} promotion failed.`,
        tables_touched: [],
        warnings: [],
        errors: [message],
        prerequisites_unmet: [],
      };
      if (!params.dryRun && runItemId) {
        await params.actorAuth.revalidate(params.facilityId);
        await updateRunItem(params.admin, runItemId, result);
      }
      results.push(result);
    }
  }
  return results;
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
  actorAuth: CurrentActorAuthorization,
): Promise<Response> {
  const origin = req.headers.get("origin");
  const actor: Actor = actorAuth.actor;

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

  if (!actorAuth.actor.accessibleFacilityIds.includes(facilityId)) {
    return jsonResponse({ error: "Facility not found or forbidden" }, 403, origin);
  }

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
    const { grouped, modulesToProcess, gapModules } = prepareModulePlan(values, requestedModules);

    if (!dryRun) {
      await actorAuth.revalidate(facilityId);
      runId = await insertRun(admin, {
        actor,
        facilityId,
        requestedModules: requestedModules ?? [],
        processedModules: modulesToProcess,
        gapModules,
        summary: "Promotion running.",
        now: now(),
      });
    }

    if (!dryRun) await actorAuth.revalidate(facilityId);
    const results = await promoteModules({
      admin,
      organizationId: actor.organizationId,
      facilityId,
      actor,
      grouped,
      modulesToProcess,
      dryRun,
      runId,
      actorAuth,
    });
    const summary = summarize(results, gapModules, mode);

    if (!dryRun && runId) {
      await actorAuth.revalidate(facilityId);
      const status = finalRunStatus(results);
      await updateRun(admin, runId, {
        status,
        finished_at: now().toISOString(),
        summary,
        metadata: {
          processed_modules: modulesToProcess,
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
    if (error instanceof CurrentActorError) {
      return currentActorErrorResponse(error, getCorsHeaders(origin));
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!dryRun && runId) {
      try {
        await actorAuth.revalidate(facilityId);
      } catch (authError) {
        return currentActorErrorResponse(authError, getCorsHeaders(origin));
      }
      await updateRun(admin, runId, {
        status: "failed",
        finished_at: now().toISOString(),
        metadata: { error_message: message },
      }).catch(() => undefined);
    }
    // Whitelist + deep-redact before logging. The error message can carry
    // upstream payloads, so it goes through `pickRedacted` rather than being
    // spread raw into the log line.
    const safeLog = pickRedacted(
      { run_id: runId, error: message },
      ["run_id", "error", "error_code", "status"],
    );
    console.error("facility-launch-promote failed", safeLog);
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
  const authorizeActor = options.authorizeActor ?? ((req) =>
    requireCurrentActor(req, { allowedRoles: [...ADMIN_ROLES] }));
  const now = options.now ?? (() => new Date());
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: getCorsHeaders(origin) });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    let actorAuth: CurrentActorAuthorization;
    try {
      actorAuth = await authorizeActor(req);
    } catch (error) {
      return currentActorErrorResponse(error, getCorsHeaders(origin));
    }
    let admin: AdminClient;
    try {
      admin = adminFactory();
    } catch {
      return jsonResponse({ error: "Promotion initialization failed" }, 500, origin);
    }
    return handlePromotion(req, admin, now, actorAuth);
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
