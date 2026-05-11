import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { jsonResponse } from "../_shared/cors.ts";
import { normalizeBoldSignEventToStatus, pickString, verifyBoldSignWebhookSignature } from "../_shared/boldsign.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BOLDSIGN_WEBHOOK_SECRET");

type JsonMap = Record<string, unknown>;

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function extract(payload: JsonMap, headerEvent: string | null) {
  const data = asMap(payload.data ?? payload.Data);
  const document = asMap(data.document ?? data.Document ?? payload.document ?? payload.Document);
  const signer = asMap(data.signer ?? data.Signer ?? payload.signer ?? payload.Signer);
  const eventType = pickString(payload.eventType) ?? pickString(payload.event) ?? pickString(payload.Event) ?? headerEvent ?? "Unknown";
  const providerDocumentId = pickString(data.documentId) ?? pickString(data.documentID) ?? pickString(document.documentId) ?? pickString(document.documentID) ?? pickString(payload.documentId) ?? pickString(payload.documentID);
  const providerEventId = pickString(payload.eventId) ?? pickString(payload.id) ?? pickString(data.eventId);
  const signerEmail = pickString(signer.emailAddress) ?? pickString(signer.email) ?? pickString(data.signerEmail) ?? pickString(payload.signerEmail);
  const signerName = pickString(signer.name) ?? pickString(signer.signerName) ?? pickString(data.signerName) ?? pickString(payload.signerName);
  return { eventType, providerDocumentId, providerEventId, signerEmail, signerName };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const eventHeader = req.headers.get("X-BoldSign-Event") ?? req.headers.get("x-boldsign-event");
  if (eventHeader === "Verification") return jsonResponse({ ok: true, verification: true });

  const rawBody = await req.text();
  if (!WEBHOOK_SECRET) return jsonResponse({ error: "BOLDSIGN_WEBHOOK_SECRET is not configured" }, 503);

  const signatureOk = await verifyBoldSignWebhookSignature(
    rawBody,
    req.headers.get("X-BoldSign-Signature") ?? req.headers.get("x-boldsign-signature"),
    WEBHOOK_SECRET,
  );
  if (!signatureOk) return jsonResponse({ error: "Invalid BoldSign signature" }, 400);

  let payload: JsonMap;
  try {
    payload = JSON.parse(rawBody) as JsonMap;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { eventType, providerDocumentId, providerEventId, signerEmail, signerName } = extract(payload, eventHeader);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let contract: JsonMap | null = null;
  if (providerDocumentId) {
    const { data } = await admin
      .from("resident_contracts")
      .select("id, organization_id, facility_id, resident_id, status")
      .eq("provider", "boldsign")
      .eq("provider_document_id", providerDocumentId)
      .is("deleted_at", null)
      .maybeSingle();
    contract = data as JsonMap | null;
  }

  const normalizedStatus = normalizeBoldSignEventToStatus(eventType);
  if (contract?.id && normalizedStatus) {
    const updates: Record<string, unknown> = { status: normalizedStatus };
    const now = new Date().toISOString();
    if (normalizedStatus === "completed") updates.completed_at = now;
    if (normalizedStatus === "declined") updates.declined_at = now;
    if (normalizedStatus === "voided") updates.voided_at = now;
    await admin.from("resident_contracts").update(updates).eq("id", contract.id);
  }

  if (contract?.id && signerEmail) {
    const signerStatus = eventType.toLowerCase() === "signed" ? "signed" : eventType.toLowerCase() === "viewed" ? "viewed" : eventType.toLowerCase() === "declined" ? "declined" : null;
    if (signerStatus) {
      const signerUpdates: Record<string, unknown> = { status: signerStatus };
      const now = new Date().toISOString();
      if (signerStatus === "signed") signerUpdates.signed_at = now;
      if (signerStatus === "viewed") signerUpdates.viewed_at = now;
      if (signerStatus === "declined") signerUpdates.declined_at = now;
      await admin
        .from("resident_contract_signers")
        .update(signerUpdates)
        .eq("contract_id", contract.id)
        .ilike("signer_email", signerEmail)
        .is("deleted_at", null);
    }
  }

  const { error: eventInsertError } = await admin.from("resident_contract_events").insert({
    organization_id: contract?.organization_id ?? null,
    facility_id: contract?.facility_id ?? null,
    contract_id: contract?.id ?? null,
    resident_id: contract?.resident_id ?? null,
    provider: "boldsign",
    provider_document_id: providerDocumentId ?? null,
    provider_event_id: providerEventId ?? null,
    event_type: eventType,
    event_status: normalizedStatus,
    signer_email: signerEmail ?? null,
    signer_name: signerName ?? null,
    signature_verified: true,
    raw_payload: payload,
    metadata: { header_event: eventHeader },
  });

  if (eventInsertError && eventInsertError.code !== "23505") {
    return jsonResponse({ error: "Failed to record BoldSign event", details: eventInsertError.message }, 500);
  }

  return jsonResponse({ ok: true, matched_contract: Boolean(contract?.id), event_type: eventType, duplicate_event: eventInsertError?.code === "23505" });
});
