/**
 * compliance-doc-check — HUD 232 / Berkadia triage for facility insurance documents.
 * POST — Auth: `x-cron-secret` = `COMPLIANCE_DOC_CHECK_SECRET`.
 *
 * Body, either:
 *   { facility_document_id: uuid, extracted_text: string }
 *     Triages a document in the facility vault and records a row in
 *     `compliance_doc_triage`. The vault row supplies the authoritative
 *     facility; the model's reading of the document is a cross-check on it.
 *   { extracted_text: string, facility_name?: string }
 *     Calibration run. Returns the same judgment and records nothing.
 *
 * The caller supplies the text. Haven has no OCR path for `facility_documents`
 * — `document_parser_jobs` runs against `public.documents`, a different vault —
 * and inventing one is not this function's job.
 *
 * PHI: none, deliberately. TypeSafe is a new AI subprocessor with no BAA on
 * file (COL-466), so only facility-level insurance documents may be sent here.
 * Do not extend this function to resident records, care plans, payers, or
 * anything else resident-identifying until that BAA is signed.
 *
 * "Facility document" is not by itself that guarantee: a loss run carries
 * claim-level detail and a resident contract names residents, and both are live
 * vault categories. Those are refused outright — see
 * CATEGORIES_WITHHELD_FROM_MODEL. A calibration call carries no vault row and
 * therefore no category, so the caller owns that judgment on that path.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { evaluateSystemOne, TypeSafeError } from "../_shared/typesafe-client.ts";
import { categoryMayBeSent, COMPLIANCE_QUESTIONS } from "../_shared/compliance-doc-questions.ts";
import { triageDocument } from "./handler.ts";

/** Nine questions over a whole document; the interactive 5s budget does not apply. */
const TYPESAFE_TIMEOUT_MS = 30_000;
/** Roughly 50 pages of extracted text. Larger means the caller sent the wrong thing. */
const MAX_TEXT_CHARS = 200_000;
const MAX_ATTEMPTS = 3;

/**
 * Backoff lives here rather than in the client: the router's caller sits in an
 * interactive budget where a retry would eat the whole thing, and batch triage
 * is the opposite case. Only the two statuses that are worth waiting on retry.
 */
async function evaluateWithBackoff(args: Parameters<typeof evaluateSystemOne>[0]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await evaluateSystemOne(args);
    } catch (err) {
      const retryable = err instanceof TypeSafeError &&
        (err.kind === "rate_limited" || err.kind === "overloaded");
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
      const delayMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

Deno.serve(async (req) => {
  const t = withTiming("compliance-doc-check");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("COMPLIANCE_DOC_CHECK_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) {
    t.log({ event: "not_configured", outcome: "error", error_message: "TYPESAFE_API_KEY unset" });
    return jsonResponse({ error: "Not configured" }, 503);
  }

  let body: { facility_document_id?: string; extracted_text?: string; facility_name?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON" }, 400);
  }

  const text = typeof body.extracted_text === "string" ? body.extracted_text.trim() : "";
  if (!text) return jsonResponse({ error: "extracted_text is required" }, 400);
  if (text.length > MAX_TEXT_CHARS) {
    t.log({ event: "text_too_large", outcome: "blocked", chars: text.length });
    return jsonResponse({ error: "extracted_text too large" }, 413);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve the vault row first: a triage recorded against a document that is
  // missing, deleted, or in another organization is worse than no triage.
  let vaultRow:
    | { id: string; facility_id: string; organization_id: string; document_category: string }
    | null = null;
  let vaultFacilityName: string | null = typeof body.facility_name === "string"
    ? body.facility_name
    : null;

  if (body.facility_document_id) {
    const { data, error } = await admin
      .from("facility_documents")
      .select("id, facility_id, organization_id, document_category, facilities!inner(name)")
      .eq("id", body.facility_document_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      t.log({ event: "vault_lookup_failed", outcome: "error", error_message: error.message });
      return jsonResponse({ error: "Lookup failed" }, 500);
    }
    if (!data) {
      t.log({ event: "vault_row_missing", outcome: "blocked" });
      return jsonResponse({ error: "facility_document_id not found" }, 404);
    }

    const facilities = (data as Record<string, unknown>).facilities as { name?: string } | null;
    vaultRow = {
      id: data.id as string,
      facility_id: data.facility_id as string,
      organization_id: data.organization_id as string,
      document_category: data.document_category as string,
    };
    vaultFacilityName = facilities?.name ?? null;

    // Refuse before the call, not after: a loss run or a resident contract can
    // name a resident, and TypeSafe has no BAA on file (COL-466). The refusal
    // keys on the vault's category rather than on what the text looks like —
    // deciding a document "looks clean" is de-identification by guesswork.
    if (!categoryMayBeSent(vaultRow.document_category)) {
      t.log({
        event: "category_withheld",
        outcome: "blocked",
        document_category: vaultRow.document_category,
      });
      return jsonResponse(
        { error: "Document category may not be sent to the model", category: vaultRow.document_category },
        422,
      );
    }
  }

  let response;
  try {
    response = await evaluateWithBackoff({
      apiKey,
      state: text,
      questions: COMPLIANCE_QUESTIONS,
      timeoutMs: TYPESAFE_TIMEOUT_MS,
    });
  } catch (err) {
    // `kind` is the whole diagnostic on purpose: the state is document text and
    // error bodies get logged. Nothing is recorded — a failed call must not
    // leave a row that reads like a judgment.
    const kind = err instanceof TypeSafeError ? err.kind : "unknown";
    t.log({ event: "typesafe_failed", outcome: "error", error_code: kind });
    return jsonResponse({ error: "Judgment unavailable", kind }, 502);
  }

  let triage;
  try {
    triage = triageDocument(response, vaultFacilityName);
  } catch (err) {
    const kind = err instanceof TypeSafeError ? err.kind : "unknown";
    t.log({ event: "answers_malformed", outcome: "error", error_code: kind });
    return jsonResponse({ error: "Judgment unavailable", kind }, 502);
  }

  if (vaultRow) {
    const { error } = await admin.from("compliance_doc_triage").insert({
      organization_id: vaultRow.organization_id,
      facility_id: vaultRow.facility_id,
      facility_document_id: vaultRow.id,
      document_category: vaultRow.document_category,
      doc_type: triage.doc_type,
      doc_type_confidence: triage.doc_type_confidence,
      facility_named: triage.facility_named,
      facility_confidence: triage.facility_confidence,
      facility_matches: triage.facility_matches,
      names_berkadia: triage.names_berkadia,
      names_hud_secretary: triage.names_hud_secretary,
      isaoa_atima_present: triage.isaoa_atima_present,
      epi_period: triage.epi_period,
      is_draft: triage.is_draft,
      carrier_and_policy_identified: triage.carrier_and_policy_identified,
      readiness: triage.readiness,
      flags: triage.flags,
      uncertainties: triage.uncertainties,
      route: triage.route,
      questions_version: triage.questions_version,
      model: response.model,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    });

    if (error) {
      t.log({ event: "insert_failed", outcome: "error", error_message: error.message });
      return jsonResponse({ error: "Insert failed" }, 500);
    }
  }

  t.log({
    event: "triaged",
    outcome: "success",
    route: triage.route,
    flag_count: triage.flags.length,
    uncertainty_count: triage.uncertainties.length,
    recorded: vaultRow !== null,
  });

  return jsonResponse({ ...triage, recorded: vaultRow !== null });
});
