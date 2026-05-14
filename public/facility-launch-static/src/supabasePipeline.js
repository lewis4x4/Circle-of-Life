const CONFIG_KEY = "facilityLaunchCenter.supabasePipeline.v1";

function trimSlash(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

export function loadPipelineConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePipelineConfig(config) {
  const cleaned = {
    supabaseUrl: trimSlash(config.supabaseUrl),
    anonKey: String(config.anonKey || "").trim(),
    accessToken: String(config.accessToken || "").trim(),
    organizationId: String(config.organizationId || "").trim(),
    facilityId: String(config.facilityId || "").trim()
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cleaned));
  return cleaned;
}

export function pipelineConfigured(config = loadPipelineConfig()) {
  return Boolean(config.supabaseUrl && config.anonKey && config.accessToken && config.organizationId);
}

export function promotionConfigured(config = loadPipelineConfig()) {
  return pipelineConfigured(config) && Boolean(config.facilityId);
}

async function edgeFetch(config, functionName, init) {
  if (!pipelineConfigured(config)) {
    throw new Error("Supabase pipeline is not configured. Add URL, anon key, current user JWT, and organization id.");
  }
  const response = await fetch(`${trimSlash(config.supabaseUrl)}/functions/v1/${functionName}`, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${functionName} failed (${response.status})`);
  return payload;
}

export async function uploadDocumentToSupabasePipeline(file, metadata, config = loadPipelineConfig()) {
  if (!file) throw new Error("Choose a file before starting Supabase OCR/AI intake.");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", metadata.title || file.name);
  formData.append("workspace_id", config.organizationId);
  formData.append("audience", "facility_scoped");
  formData.append("status", "pending_review");

  const ingest = await edgeFetch(config, "ingest", {
    method: "POST",
    body: formData
  });

  const parsed = await edgeFetch(config, "facility-launch-parser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "parse_document",
      document_id: ingest.document_id,
      facility_id: config.facilityId || null
    })
  });

  return { ingest, parsed };
}

export async function parserAction(action, body, config = loadPipelineConfig()) {
  return edgeFetch(config, "facility-launch-parser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body })
  });
}

/**
 * Push the current Facility Launch Center state into Haven's
 * facility_launch_module_values table via the facility-launch-import Edge Function.
 *
 *   state      - the FLC export JSON (anything with `mvpData`, normally what
 *                buildStateJsonExport returns)
 *   options    - { dryRun?: boolean }
 *   config     - pipeline config (defaults to loadPipelineConfig())
 *
 * Returns the edge function response: { inserts, updates, noops, gap_report, rows, ... }
 */
export async function pushStateToHaven(state, options = {}, config = loadPipelineConfig()) {
  if (!state || typeof state !== "object") throw new Error("Cannot push: state is missing.");
  return edgeFetch(config, "facility-launch-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state,
      organization_id: config.organizationId,
      facility_id: config.facilityId || null,
      dry_run: Boolean(options.dryRun)
    })
  });
}

/**
 * One-click Facility Launch handoff:
 *   1. Capture the current FLC export into facility_launch_module_values.
 *   2. Promote every ready intake module into the app-visible operational tables.
 *
 * Dry-run preserves the Item 1 invariant: no writes. It previews capture only,
 * because promotion reads persisted intake and would otherwise show stale data
 * instead of the current draft.
 */
export async function pushAndPromoteStateToHaven(state, options = {}, config = loadPipelineConfig()) {
  if (!promotionConfigured(config)) {
    throw new Error("Supabase URL, anon key, current user JWT, organization id, and facility id are required before promoting to Haven.");
  }
  const dryRun = Boolean(options.dryRun);
  const captured = await pushStateToHaven(state, { dryRun }, config);
  if (dryRun) {
    return {
      mode: "dry_run",
      dry_run: true,
      captured,
      promoted: {
        run_id: null,
        organization_id: config.organizationId,
        facility_id: config.facilityId,
        mode: "dry_run",
        modules_promoted: [],
        summary: "Promotion preview skipped because capture dry-run does not write current intake. Run an apply when ready to promote the just-captured state.",
        gap_modules: []
      },
      note: "Dry-run previews capture only. Promotion is intentionally skipped to avoid showing stale persisted intake as if it were the current draft."
    };
  }

  let promoted;
  try {
    promoted = await edgeFetch(config, "facility-launch-promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: config.organizationId,
        facility_id: config.facilityId,
        dry_run: false
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Promotion failed.";
    return {
      mode: "partial",
      dry_run: false,
      captured,
      promoted: {
        run_id: null,
        organization_id: config.organizationId,
        facility_id: config.facilityId,
        mode: "apply",
        modules_promoted: [],
        summary: "Capture succeeded, but promotion failed.",
        gap_modules: [],
        error: message
      },
      note: `Capture succeeded, but promotion failed: ${message}`
    };
  }

  return {
    mode: "apply",
    dry_run: false,
    captured,
    promoted,
    note: "Captured current Facility Launch state and promoted ready modules into live Haven tables."
  };
}
