/**
 * Facility Launch Parser — OCR/AI extraction, human approval, provenance writes.
 * Auth: user JWT. Roles: owner, org_admin, facility_admin.
 * Input documents come from the existing KB ingest pipeline (`documents.markdown_text/raw_text`).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

type AdminClient = SupabaseClient;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const PARSER_VERSION = "facility-launch-parser-v1";
const ADMIN_ROLES = ["owner", "org_admin", "facility_admin"] as const;

type Action = "parse_document" | "run_job" | "approve_fact" | "reject_fact" | "apply_fact" | "approve_and_apply_fact" | "list_document_facts";

type RequestBody = {
  action?: Action;
  document_id?: string;
  parser_job_id?: string;
  fact_id?: string;
  facility_id?: string | null;
  review_notes?: string | null;
};

type Profile = { app_role?: string | null; organization_id?: string | null };
type DocumentRow = {
  id: string;
  workspace_id: string;
  title: string;
  raw_text?: string | null;
  markdown_text?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ExtractedFact = {
  artifact_type: string;
  fact_key: string;
  fact_label: string;
  normalized_value: string;
  extracted_value: Record<string, unknown>;
  confidence: number;
  source_excerpt: string;
  page_number?: number | null;
  proposed_module_code: string;
  proposed_field_path: string;
  evidence?: Record<string, unknown>;
};

const MODULE_HINTS: Record<string, { module: string; field: string; label: string }> = {
  artifact_type: { module: "M17", field: "documents.artifactType", label: "Document type" },
  facility_name: { module: "M2", field: "facility.legalName", label: "Facility name" },
  entity_name: { module: "M1", field: "company.legalEntities", label: "Legal/entity name" },
  term_year: { module: "M17", field: "documents.term", label: "Document term/year" },
  effective_date: { module: "M17", field: "documents.effectiveDate", label: "Effective date" },
  expiration_date: { module: "M17", field: "documents.expirationDate", label: "Expiration date" },
  insurance_carrier: { module: "M17", field: "documents.carrier", label: "Insurance carrier" },
  policy_number: { module: "M17", field: "documents.policyNumber", label: "Policy/certificate number" },
  claim_history: { module: "M16", field: "risk.claimsAwareness", label: "Claims/loss history signal" },
  vendor_name: { module: "M18", field: "vendors.organization", label: "Vendor/contact organization" },
  emergency_plan: { module: "M18", field: "emergency.process", label: "Emergency process evidence" },
  room_or_floor_plan: { module: "M3", field: "rooms.floorPlanEvidence", label: "Room/floor plan evidence" },
};

function clampConfidence(value: unknown, fallback = 0.55): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function cleanText(value = ""): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detectArtifact(title: string, text: string): string {
  const haystack = `${title}\n${text.slice(0, 4000)}`;
  if (/\bgl\b|general\s+liability|certificate\s+of\s+liability/i.test(haystack)) return "gl_cert";
  if (/property\s+policy|commercial\s+property|evidence\s+of\s+commercial\s+property/i.test(haystack)) return "property_policy";
  if (/loss\s*run|claims?\s+history/i.test(haystack)) return "loss_run";
  if (/bond/i.test(haystack)) return "bond_certificate";
  if (/license|licensure|ahca/i.test(haystack)) return "state_license";
  if (/floor\s*plan|room\s*map|unit\s*map/i.test(haystack)) return "floor_plan";
  if (/emergency|evacuation|disaster/i.test(haystack)) return "emergency_plan";
  if (/vendor|agreement|contract|service/i.test(haystack)) return "vendor_agreement";
  return "other";
}

function findFirst(pattern: RegExp, text: string): string {
  const match = text.match(pattern);
  return cleanText(match?.[1] || match?.[0] || "");
}

function findDates(text: string): string[] {
  const matches = text.match(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|20\d{2}-\d{2}-\d{2})\b/g) || [];
  return Array.from(new Set(matches)).slice(0, 8);
}

function makeFact(key: string, value: string, text: string, artifactType: string, confidence = 0.62): ExtractedFact | null {
  if (!value) return null;
  const hint = MODULE_HINTS[key] || { module: "M17", field: `documents.${key}`, label: key };
  const idx = text.toLowerCase().indexOf(value.toLowerCase());
  const excerpt = idx >= 0 ? cleanText(text.slice(Math.max(0, idx - 140), idx + value.length + 140)) : cleanText(text.slice(0, 260));
  return {
    artifact_type: artifactType,
    fact_key: key,
    fact_label: hint.label,
    normalized_value: value,
    extracted_value: { value },
    confidence,
    source_excerpt: excerpt,
    page_number: null,
    proposed_module_code: hint.module,
    proposed_field_path: hint.field,
    evidence: { extraction: "heuristic", parser_version: PARSER_VERSION },
  };
}

function heuristicFacts(doc: DocumentRow): ExtractedFact[] {
  const text = doc.markdown_text || doc.raw_text || "";
  const artifactType = detectArtifact(doc.title, text);
  const facts: Array<ExtractedFact | null> = [];
  facts.push(makeFact("artifact_type", artifactType, text || doc.title, artifactType, 0.8));

  const facility = findFirst(/\b(Homewood(?:\s+Lodge)?(?:\s+ALF)?|Oakridge|Rising\s+Oaks|Grand(?:e)?\s+Cypress|Plantation)\b/i, `${doc.title}\n${text}`);
  facts.push(makeFact("facility_name", facility, text || doc.title, artifactType, facility ? 0.78 : 0.4));

  const entity = findFirst(/\b([A-Z][A-Za-z&,.'\s]+(?:LLC|Inc\.?|Company))\b/, text);
  facts.push(makeFact("entity_name", entity, text, artifactType, 0.64));

  const year = findFirst(/\b(20\d{2})\b/, `${doc.title}\n${text}`);
  facts.push(makeFact("term_year", year, text || doc.title, artifactType, year ? 0.72 : 0.4));

  const dates = findDates(text);
  if (dates[0]) facts.push(makeFact("effective_date", dates[0], text, artifactType, 0.58));
  if (dates[1]) facts.push(makeFact("expiration_date", dates[1], text, artifactType, 0.58));

  const policy = findFirst(/(?:policy|certificate|bond)\s*(?:number|no\.?|#)[:\s]*([A-Z0-9\-]{4,})/i, text);
  facts.push(makeFact("policy_number", policy, text, artifactType, 0.58));

  if (artifactType === "loss_run") facts.push(makeFact("claim_history", "Loss-run / claims-history document present", text || doc.title, artifactType, 0.82));
  if (artifactType === "emergency_plan") facts.push(makeFact("emergency_plan", "Emergency preparedness evidence present", text || doc.title, artifactType, 0.82));
  if (artifactType === "floor_plan") facts.push(makeFact("room_or_floor_plan", "Floor/room plan evidence present", text || doc.title, artifactType, 0.82));

  return facts.filter((fact): fact is ExtractedFact => Boolean(fact));
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function recordAiInvocation(admin: AdminClient, params: { orgId: string; userId: string; prompt: string; response?: string; model: string; metadata?: Record<string, unknown> }) {
  await admin.from("ai_invocations").insert({
    organization_id: params.orgId,
    model: params.model,
    phi_class: "limited",
    prompt_hash: await sha256Hex(params.prompt),
    response_hash: params.response ? await sha256Hex(params.response) : null,
    created_by: params.userId,
    metadata_json: { parser_version: PARSER_VERSION, ...(params.metadata || {}) },
  });
}

async function aiFacts(admin: AdminClient, doc: DocumentRow, orgId: string, userId: string): Promise<ExtractedFact[] | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const text = cleanText(doc.markdown_text || doc.raw_text || "");
  if (!text) return null;
  const input = text.slice(0, 24_000);
  const model = "claude-haiku-4-5-20251001";
  const prompt = `Extract Facility Launch onboarding facts from this document. Return JSON only, no markdown.\n\nSchema:\n{"facts":[{"artifact_type":"gl_cert|property_policy|loss_run|bond_certificate|state_license|floor_plan|emergency_plan|vendor_agreement|other","fact_key":"artifact_type|facility_name|entity_name|term_year|effective_date|expiration_date|insurance_carrier|policy_number|claim_history|vendor_name|emergency_plan|room_or_floor_plan","fact_label":"human label","normalized_value":"short value","extracted_value":{"value":"same or structured"},"confidence":0.0,"source_excerpt":"exact supporting excerpt","page_number":null,"proposed_module_code":"M1-M19","proposed_field_path":"dot.path"}]}\n\nRules: extract only facts with supporting evidence; facts must be reviewed by a human before app write.\n\nTitle: ${doc.title}\n\nDocument text:\n${input}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    await recordAiInvocation(admin, { orgId, userId, prompt, model, metadata: { outcome: "http_error", status: res.status } });
    return null;
  }
  const payload = await res.json();
  const raw = payload.content?.[0]?.text ?? "";
  await recordAiInvocation(admin, { orgId, userId, prompt, response: raw, model, metadata: { outcome: "success", document_id: doc.id } });
  const jsonText = String(raw).replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(jsonText) as { facts?: Array<Partial<ExtractedFact>> };
    const facts = (parsed.facts || []).map((fact): ExtractedFact | null => {
      const key = String(fact.fact_key || "").trim();
      const value = cleanText(fact.normalized_value || String((fact.extracted_value as { value?: unknown } | undefined)?.value || ""));
      if (!key || !value) return null;
      const hint = MODULE_HINTS[key] || { module: fact.proposed_module_code || "M17", field: fact.proposed_field_path || `documents.${key}`, label: fact.fact_label || key };
      return {
        artifact_type: String(fact.artifact_type || detectArtifact(doc.title, doc.markdown_text || doc.raw_text || "")),
        fact_key: key,
        fact_label: String(fact.fact_label || hint.label),
        normalized_value: value,
        extracted_value: typeof fact.extracted_value === "object" && fact.extracted_value ? fact.extracted_value as Record<string, unknown> : { value },
        confidence: clampConfidence(fact.confidence, 0.7),
        source_excerpt: cleanText(fact.source_excerpt || ""),
        page_number: typeof fact.page_number === "number" ? fact.page_number : null,
        proposed_module_code: String(fact.proposed_module_code || hint.module),
        proposed_field_path: String(fact.proposed_field_path || hint.field),
        evidence: { extraction: "ai", model: "claude-haiku-4-5-20251001", parser_version: PARSER_VERSION },
      };
    }).filter((fact): fact is ExtractedFact => Boolean(fact));
    return facts.length ? facts : null;
  } catch {
    return null;
  }
}

async function loadActor(admin: AdminClient, token: string): Promise<{ userId: string; profile: Profile } | Response> {
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401, null);
  const { data: profile } = await admin.from("user_profiles").select("app_role, organization_id").eq("id", user.id).single();
  const role = profile?.app_role ?? "caregiver";
  if (!ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    return jsonResponse({ error: "Forbidden: owner/org_admin/facility_admin only" }, 403, null);
  }
  if (!profile?.organization_id) return jsonResponse({ error: "Profile has no organization" }, 403, null);
  return { userId: user.id, profile };
}

async function loadDocument(admin: AdminClient, documentId: string, orgId: string): Promise<DocumentRow | Response> {
  const { data: doc, error } = await admin.from("documents").select("id, workspace_id, title, raw_text, markdown_text, metadata").eq("id", documentId).is("deleted_at", null).single();
  if (error || !doc) return jsonResponse({ error: "Document not found" }, 404, null);
  if (doc.workspace_id !== orgId) return jsonResponse({ error: "Forbidden" }, 403, null);
  return doc as DocumentRow;
}

function response(body: unknown, origin: string | null, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" } });
}

async function parseDocument(admin: AdminClient, params: { documentId: string; facilityId?: string | null; userId: string; orgId: string; parserJobId?: string }) {
  const doc = await loadDocument(admin, params.documentId, params.orgId);
  if (doc instanceof Response) return doc;

  let jobId = params.parserJobId;
  if (!jobId) {
    const { data: job, error } = await admin.from("document_parser_jobs").insert({
      organization_id: params.orgId,
      facility_id: params.facilityId || null,
      document_id: params.documentId,
      status: "running",
      parse_mode: ANTHROPIC_API_KEY ? "ocr_ai" : "heuristic",
      parser_version: PARSER_VERSION,
      queued_by: params.userId,
      started_at: new Date().toISOString(),
      metadata: { source: "facility-launch-parser" },
    }).select("id").single();
    if (error || !job) return response({ error: `Job insert failed: ${error?.message}` }, null, 500);
    jobId = job.id;
  } else {
    await admin.from("document_parser_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);
  }

  try {
    await admin.from("document_extracted_facts").update({ approval_status: "superseded" }).eq("document_id", params.documentId).eq("approval_status", "pending");
    const extracted = (await aiFacts(admin, doc, params.orgId, params.userId)) || heuristicFacts(doc);
    const rows = extracted.map((fact) => ({
      organization_id: params.orgId,
      facility_id: params.facilityId || null,
      document_id: params.documentId,
      parser_job_id: jobId,
      artifact_type: fact.artifact_type,
      fact_key: fact.fact_key,
      fact_label: fact.fact_label,
      extracted_value: fact.extracted_value,
      normalized_value: fact.normalized_value,
      confidence: fact.confidence,
      source_excerpt: fact.source_excerpt,
      page_number: fact.page_number ?? null,
      evidence: fact.evidence || {},
      proposed_module_code: fact.proposed_module_code,
      proposed_field_path: fact.proposed_field_path,
    }));
    if (rows.length) {
      const { error } = await admin.from("document_extracted_facts").insert(rows);
      if (error) throw new Error(error.message);
    }
    const summary = `Extracted ${rows.length} reviewable fact(s); ${ANTHROPIC_API_KEY ? "AI parser" : "heuristic parser"} used.`;
    await admin.from("document_parser_jobs").update({ status: "completed", completed_at: new Date().toISOString(), result_summary: summary }).eq("id", jobId);
    await admin.from("document_audit_events").insert({
      actor_user_id: params.userId,
      document_id: params.documentId,
      document_title_snapshot: doc.title,
      event_type: "facility_launch_parse_completed",
      metadata: { parser_job_id: jobId, fact_count: rows.length, parser_version: PARSER_VERSION },
    });
    return response({ success: true, parser_job_id: jobId, document_id: params.documentId, fact_count: rows.length, summary }, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("document_parser_jobs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: message }).eq("id", jobId);
    return response({ error: message, parser_job_id: jobId }, null, 500);
  }
}

Deno.serve(async (req) => {
  const t = withTiming("facility-launch-parser");
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const actor = await loadActor(admin, token);
  if (actor instanceof Response) return actor;
  const orgId = actor.profile.organization_id!;

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }

  try {
    switch (body.action) {
      case "parse_document": {
        if (!body.document_id) return jsonResponse({ error: "document_id required" }, 400, origin);
        const res = await parseDocument(admin, { documentId: body.document_id, facilityId: body.facility_id, userId: actor.userId, orgId });
        const payload = await res.json();
        return response(payload, origin, res.status);
      }
      case "run_job": {
        if (!body.parser_job_id) return jsonResponse({ error: "parser_job_id required" }, 400, origin);
        const { data: job, error } = await admin.from("document_parser_jobs").select("id, document_id, organization_id, facility_id").eq("id", body.parser_job_id).single();
        if (error || !job || job.organization_id !== orgId) return jsonResponse({ error: "Parser job not found" }, 404, origin);
        const res = await parseDocument(admin, { documentId: job.document_id, facilityId: job.facility_id, userId: actor.userId, orgId, parserJobId: job.id });
        const payload = await res.json();
        return response(payload, origin, res.status);
      }
      case "list_document_facts": {
        if (!body.document_id) return jsonResponse({ error: "document_id required" }, 400, origin);
        const doc = await loadDocument(admin, body.document_id, orgId);
        if (doc instanceof Response) return doc;
        const { data, error } = await admin.from("document_extracted_facts").select("*").eq("document_id", body.document_id).is("deleted_at", null).order("created_at", { ascending: false });
        if (error) return jsonResponse({ error: error.message }, 500, origin);
        return response({ data: data ?? [] }, origin);
      }
      case "approve_fact":
      case "reject_fact":
      case "apply_fact":
      case "approve_and_apply_fact": {
        if (!body.fact_id) return jsonResponse({ error: "fact_id required" }, 400, origin);
        const { data: fact, error } = await admin.from("document_extracted_facts").select("*").eq("id", body.fact_id).is("deleted_at", null).single();
        if (error || !fact || fact.organization_id !== orgId) return jsonResponse({ error: "Fact not found" }, 404, origin);
        if (body.action === "reject_fact") {
          await admin.from("document_extracted_facts").update({ approval_status: "rejected", reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), review_notes: body.review_notes || null }).eq("id", body.fact_id);
          return response({ success: true, fact_id: body.fact_id, approval_status: "rejected" }, origin);
        }
        if (body.action === "approve_fact") {
          await admin.from("document_extracted_facts").update({ approval_status: "approved", reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), review_notes: body.review_notes || null }).eq("id", body.fact_id);
          return response({ success: true, fact_id: body.fact_id, approval_status: "approved" }, origin);
        }
        if (body.action === "approve_and_apply_fact" && fact.approval_status === "pending") {
          await admin.from("document_extracted_facts").update({ approval_status: "approved", reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), review_notes: body.review_notes || null }).eq("id", body.fact_id);
        } else if (body.action === "apply_fact" && fact.approval_status !== "approved") {
          return jsonResponse({ error: "Fact must be approved before apply" }, 409, origin);
        }
        await admin.from("facility_launch_module_values").update({ superseded_at: new Date().toISOString() })
          .eq("organization_id", orgId)
          .eq("facility_id", fact.facility_id)
          .eq("module_code", fact.proposed_module_code)
          .eq("field_path", fact.proposed_field_path)
          .is("superseded_at", null)
          .is("deleted_at", null);
        const { data: applied, error: applyError } = await admin.from("facility_launch_module_values").insert({
          organization_id: orgId,
          facility_id: fact.facility_id,
          module_code: fact.proposed_module_code,
          field_path: fact.proposed_field_path,
          value: fact.extracted_value,
          source_document_id: fact.document_id,
          source_fact_id: fact.id,
          provenance: {
            confidence: fact.confidence,
            source_excerpt: fact.source_excerpt,
            parser_job_id: fact.parser_job_id,
            parser_version: PARSER_VERSION,
          },
          applied_by: actor.userId,
        }).select("id").single();
        if (applyError) return jsonResponse({ error: applyError.message }, 500, origin);
        await admin.from("document_extracted_facts").update({ approval_status: "applied", applied_by: actor.userId, applied_at: new Date().toISOString() }).eq("id", body.fact_id);
        return response({ success: true, fact_id: body.fact_id, applied_value_id: applied?.id, approval_status: "applied" }, origin);
      }
      default:
        return jsonResponse({ error: `Unknown action: ${body.action ?? "missing"}` }, 400, origin);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    t.log({ event: "parser_error", outcome: "error", error_message: message });
    return jsonResponse({ error: message }, 500, origin);
  }
});
