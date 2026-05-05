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
