/**
 * Facility Launch Import — server-side port of scripts/import-homewood-round1.ts.
 *
 * Accepts a Facility Launch Center exported state JSON and writes its source-backed
 * module values into public.facility_launch_module_values with provenance.
 *
 * Auth: user JWT (Authorization: Bearer <token>). Roles: owner, org_admin, facility_admin.
 * Facility scope: caller must have access to the target facility_id via user_facility_access
 *                 (owner/org_admin can target any facility in their org).
 *
 * Request body
 *   {
 *     state: <FLC export JSON>,
 *     organization_id?: string,    // defaults to the actor's organization
 *     facility_id?: string,        // required for facility_admin; optional for owner/org_admin
 *     dry_run?: boolean            // default false; returns a diff without writing
 *   }
 *
 * Response
 *   {
 *     organization_id, facility_id,
 *     mode: "apply" | "dry_run",
 *     payload_count, inserts, updates, noops,
 *     skipped_modules: string[],
 *     skipped_fields: { module, field, reason }[],
 *     gap_report: { module, status, missing_fields }[],
 *     rows: { module_code, field_path, change: "insert"|"update"|"noop", preview }[]
 *   }
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";

type AdminClient = SupabaseClient;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_ROLES = ["owner", "org_admin", "facility_admin"] as const;

const ROUND1_MODULE_ALLOWLIST = new Set([
  "M1", "M2", "M3", "M6", "M10", "M11", "M13", "M14", "M16", "M17", "M18", "M19",
]);
const ROUND2_GAPS = ["M4", "M5", "M7", "M8", "M9", "M12", "M15"];

type Profile = { app_role?: string | null; organization_id?: string | null; is_active?: boolean | null };
type Actor = { userId: string; profile: Profile };

type State = { mvpData?: Record<string, Record<string, unknown>>; exportedAt?: string; _meta?: { exportedAt?: string } };

type RowPayload = {
  organization_id: string;
  facility_id: string | null;
  module_code: string;
  field_path: string;
  value: unknown;
  provenance: Record<string, unknown>;
  source_document_id: string | null;
  source_fact_id: string | null;
  applied_by: string | null;
  applied_at: string;
};

type ExistingRow = {
  id: string;
  module_code: string;
  field_path: string;
  value: unknown;
};

type PlanItem = {
  module_code: string;
  field_path: string;
  change: "insert" | "update" | "noop";
  preview: string;
  payload: RowPayload;
  existing?: ExistingRow;
};

function isMeaningful(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function shortPreview(value: unknown, max = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function buildPayloads(state: State, organizationId: string, facilityId: string | null, exportedAt: string, userId: string | null) {
  const mvpData = state.mvpData ?? {};
  const payloads: RowPayload[] = [];
  const skippedModules: string[] = [];
  const skippedFields: Array<{ module: string; field: string; reason: string }> = [];

  for (const moduleCode of Object.keys(mvpData)) {
    if (ROUND2_GAPS.includes(moduleCode)) {
      skippedModules.push(`${moduleCode} (Round-2 gap)`);
      continue;
    }
    if (!ROUND1_MODULE_ALLOWLIST.has(moduleCode)) {
      skippedModules.push(`${moduleCode} (not in Round-1 allowlist)`);
      continue;
    }
    const moduleData = mvpData[moduleCode] ?? {};
    const sourceNotes = typeof moduleData._sourceNotes === "string" ? moduleData._sourceNotes : null;

    for (const fieldKey of Object.keys(moduleData)) {
      if (fieldKey.startsWith("_")) continue;
      const value = moduleData[fieldKey];
      if (!isMeaningful(value)) {
        skippedFields.push({ module: moduleCode, field: fieldKey, reason: "empty value" });
        continue;
      }
      payloads.push({
        organization_id: organizationId,
        facility_id: facilityId,
        module_code: moduleCode,
        field_path: fieldKey,
        value,
        provenance: {
          source: "facility-launch-center",
          round: 1,
          exported_at: exportedAt,
          captured_by: "facility-launch-center",
          source_notes: sourceNotes,
        },
        source_document_id: null,
        source_fact_id: null,
        applied_by: userId,
        applied_at: new Date().toISOString(),
      });
    }
  }

  // Allowlisted modules in mvpData that yielded zero payload rows (only _sourceNotes).
  const rowsByModule = new Map<string, number>();
  for (const p of payloads) rowsByModule.set(p.module_code, (rowsByModule.get(p.module_code) ?? 0) + 1);
  for (const code of Object.keys(mvpData)) {
    if (!ROUND1_MODULE_ALLOWLIST.has(code)) continue;
    if ((rowsByModule.get(code) ?? 0) === 0) {
      skippedModules.push(`${code} (only _sourceNotes — no concrete values)`);
    }
  }
  // Allowlisted modules that aren't in mvpData at all.
  for (const code of ROUND1_MODULE_ALLOWLIST) {
    if (!mvpData[code]) skippedModules.push(`${code} (no fields in state.mvpData)`);
  }

  return { payloads, skippedModules, skippedFields };
}

async function fetchExistingRows(admin: AdminClient, organizationId: string, facilityId: string | null, moduleCodes: string[]): Promise<Map<string, ExistingRow>> {
  const map = new Map<string, ExistingRow>();
  if (moduleCodes.length === 0) return map;
  let query = admin
    .from("facility_launch_module_values")
    .select("id, module_code, field_path, value")
    .eq("organization_id", organizationId)
    .in("module_code", moduleCodes)
    .is("deleted_at", null)
    .is("superseded_at", null);
  query = facilityId === null ? query.is("facility_id", null) : query.eq("facility_id", facilityId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to read existing facility_launch_module_values: ${error.message}`);
  for (const row of data ?? []) map.set(`${row.module_code}::${row.field_path}`, row as ExistingRow);
  return map;
}

function buildGapReport(state: State, payloadsByModule: Map<string, RowPayload[]>) {
  const mvpData = state.mvpData ?? {};
  const reports: Array<{ module: string; status: "ready" | "partial" | "gap"; missing_fields: string[] }> = [];

  for (const moduleCode of [...ROUND1_MODULE_ALLOWLIST, ...ROUND2_GAPS]) {
    const moduleData = mvpData[moduleCode] ?? {};
    const presentFields = (payloadsByModule.get(moduleCode) ?? []).map((p) => p.field_path);
    const missingFields = Object.keys(moduleData)
      .filter((f) => !f.startsWith("_"))
      .filter((f) => !isMeaningful(moduleData[f]));
    let status: "ready" | "partial" | "gap" = "gap";
    if (presentFields.length > 0 && missingFields.length === 0) status = "ready";
    else if (presentFields.length > 0) status = "partial";
    reports.push({ module: moduleCode, status, missing_fields: missingFields });
  }
  return reports;
}

async function loadActor(admin: AdminClient, token: string): Promise<Actor | Response> {
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return jsonResponse({ error: "Unauthorized" }, 401, null);
  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id, is_active")
    .eq("id", user.id)
    .is("deleted_at", null)
    .single();
  const role = profile?.app_role ?? "caregiver";
  if (!ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    return jsonResponse({ error: "Forbidden: owner/org_admin/facility_admin only" }, 403, null);
  }
  if (profile?.is_active === false) return jsonResponse({ error: "Forbidden" }, 403, null);
  if (!profile?.organization_id) return jsonResponse({ error: "Profile has no organization" }, 403, null);
  return { userId: user.id, profile };
}

async function resolveFacilityAccess(admin: AdminClient, actor: Actor, requestedFacilityId: string | null): Promise<string | null | Response> {
  const role = actor.profile.app_role ?? "";
  const orgId = actor.profile.organization_id!;

  // facility_admin must specify, and must have access to, a facility.
  if (role === "facility_admin") {
    if (!requestedFacilityId) return jsonResponse({ error: "facility_admin must specify facility_id" }, 400, null);
    const { data, error } = await admin
      .from("user_facility_access")
      .select("facility_id")
      .eq("user_id", actor.userId)
      .eq("organization_id", orgId)
      .eq("facility_id", requestedFacilityId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) return jsonResponse({ error: "Failed to verify facility access" }, 500, null);
    if (!data) return jsonResponse({ error: "Forbidden: no access to that facility" }, 403, null);
    return requestedFacilityId;
  }

  // owner/org_admin: if facility_id supplied, confirm it belongs to their org.
  if (requestedFacilityId) {
    const { data, error } = await admin
      .from("facilities")
      .select("id")
      .eq("id", requestedFacilityId)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return jsonResponse({ error: "Failed to verify facility" }, 500, null);
    if (!data) return jsonResponse({ error: "Facility not found in your organization" }, 404, null);
  }
  return requestedFacilityId;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405, origin);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return jsonResponse({ error: "Missing bearer token" }, 401, origin);

  let body: { state?: State; organization_id?: string; facility_id?: string; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  if (!body?.state || typeof body.state !== "object") {
    return jsonResponse({ error: "Body must include `state` (FLC export JSON)" }, 400, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const actor = await loadActor(admin, token);
  if (actor instanceof Response) return actor;

  // Default the org to the actor's org. owners/org_admins can override only with a valid org.
  const orgId = body.organization_id?.trim() || actor.profile.organization_id!;
  if (orgId !== actor.profile.organization_id) {
    return jsonResponse({ error: "Cross-org writes are not allowed" }, 403, origin);
  }

  const facilityResolution = await resolveFacilityAccess(admin, actor, body.facility_id?.trim() || null);
  if (facilityResolution instanceof Response) return facilityResolution;
  const facilityId = facilityResolution;

  const dryRun = body.dry_run === true;
  const exportedAt =
    (typeof body.state?.exportedAt === "string" && body.state.exportedAt) ||
    (typeof body.state?._meta?.exportedAt === "string" && body.state._meta.exportedAt) ||
    new Date().toISOString();

  const { payloads, skippedModules, skippedFields } = buildPayloads(
    body.state,
    orgId,
    facilityId,
    exportedAt,
    actor.userId,
  );

  const payloadsByModule = new Map<string, RowPayload[]>();
  for (const p of payloads) {
    const arr = payloadsByModule.get(p.module_code) ?? [];
    arr.push(p);
    payloadsByModule.set(p.module_code, arr);
  }
  const gapReport = buildGapReport(body.state, payloadsByModule);

  const modulesTouched = Array.from(new Set(payloads.map((p) => p.module_code)));
  let existing: Map<string, ExistingRow>;
  try {
    existing = await fetchExistingRows(admin, orgId, facilityId, modulesTouched);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500, origin);
  }

  const plans: PlanItem[] = payloads.map((payload) => {
    const key = `${payload.module_code}::${payload.field_path}`;
    const found = existing.get(key);
    if (!found) {
      return { module_code: payload.module_code, field_path: payload.field_path, change: "insert", preview: shortPreview(payload.value), payload };
    }
    if (JSON.stringify(found.value) !== JSON.stringify(payload.value)) {
      return { module_code: payload.module_code, field_path: payload.field_path, change: "update", preview: `${shortPreview(found.value)} → ${shortPreview(payload.value)}`, payload, existing: found };
    }
    return { module_code: payload.module_code, field_path: payload.field_path, change: "noop", preview: shortPreview(payload.value), payload, existing: found };
  });

  if (!dryRun) {
    const inserts = plans.filter((p) => p.change === "insert").map((p) => p.payload);
    if (inserts.length > 0) {
      const { error } = await admin.from("facility_launch_module_values").insert(inserts);
      if (error) return jsonResponse({ error: `Insert failed: ${error.message}` }, 500, origin);
    }
    for (const plan of plans) {
      if (plan.change !== "update" || !plan.existing) continue;
      const { error } = await admin
        .from("facility_launch_module_values")
        .update({
          value: plan.payload.value,
          provenance: plan.payload.provenance,
          source_document_id: plan.payload.source_document_id,
          source_fact_id: plan.payload.source_fact_id,
          applied_by: plan.payload.applied_by,
          applied_at: plan.payload.applied_at,
          updated_by: actor.userId,
        })
        .eq("id", plan.existing.id);
      if (error) return jsonResponse({ error: `Update failed for ${plan.module_code}.${plan.field_path}: ${error.message}` }, 500, origin);
    }
  }

  const counts = { insert: 0, update: 0, noop: 0 };
  for (const p of plans) counts[p.change] += 1;

  return jsonResponse({
    organization_id: orgId,
    facility_id: facilityId,
    mode: dryRun ? "dry_run" : "apply",
    payload_count: payloads.length,
    inserts: counts.insert,
    updates: counts.update,
    noops: counts.noop,
    skipped_modules: skippedModules,
    skipped_fields: skippedFields,
    gap_report: gapReport,
    rows: plans.map((p) => ({ module_code: p.module_code, field_path: p.field_path, change: p.change, preview: p.preview })),
  }, 200, origin);
});
