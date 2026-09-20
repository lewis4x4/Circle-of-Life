import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { jsonResponse } from "../_shared/cors.ts";
import {
  pickString,
  verifyBoldSignWebhookSignature,
} from "../_shared/boldsign.ts";

type JsonMap = Record<string, unknown>;

export type BoldSignWebhookEnvelope = {
  eventId?: string;
  eventType: string;
  eventEnvironment?: string;
  providerCreatedAt?: string;
  providerDocumentId?: string;
  recoveryLabel?: string;
  signerRecipientId?: string;
  signerEmail?: string;
  signerName?: string;
};

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonMap
    : {};
}

function asMaps(value: unknown): JsonMap[] {
  return Array.isArray(value) ? value.map(asMap) : [];
}

function providerCreatedAt(value: unknown): string | undefined {
  const seconds = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value)
    : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const instant = new Date(seconds * 1000);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

async function readBodyWithinLimit(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("payload_too_large");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function extractBoldSignWebhookEnvelope(
  payload: JsonMap,
  headerEvent: string | null,
): BoldSignWebhookEnvelope {
  const event = asMap(payload.event ?? payload.Event);
  const data = asMap(payload.data ?? payload.Data);
  const document = asMap(
    data.document ?? data.Document ?? payload.document ?? payload.Document,
  );
  const contextActor = asMap(asMap(payload.context ?? payload.Context).actor);
  const directSigner = asMap(
    data.signer ?? data.Signer ?? payload.signer ?? payload.Signer,
  );
  const signerDetails = asMaps(data.signerDetails ?? data.SignerDetails);
  const actorId = pickString(contextActor.id);
  const signer = actorId
    ? signerDetails.find((candidate) =>
      pickString(candidate.id)?.toLowerCase() === actorId.toLowerCase()
    ) ?? directSigner
    : directSigner.id
    ? directSigner
    : signerDetails.length === 1
    ? signerDetails[0]
    : {};
  const labels = [
    ...(Array.isArray(data.labels) ? data.labels : []),
    ...(Array.isArray(document.labels) ? document.labels : []),
  ].filter((value): value is string => typeof value === "string");
  const recoveryLabel = labels.find((label) =>
    /^haven-[0-9a-f]{32}$/i.test(label)
  );

  return {
    eventId: pickString(event.id) ?? pickString(payload.eventId) ??
      pickString(payload.id) ?? pickString(data.eventId),
    eventType: pickString(event.eventType) ?? pickString(payload.eventType) ??
      pickString(payload.Event) ?? headerEvent ?? "Unknown",
    eventEnvironment: pickString(event.environment),
    providerCreatedAt: providerCreatedAt(event.created),
    providerDocumentId: pickString(data.documentId) ??
      pickString(data.documentID) ?? pickString(document.documentId) ??
      pickString(document.documentID) ?? pickString(payload.documentId) ??
      pickString(payload.documentID),
    recoveryLabel,
    signerRecipientId: pickString(signer.id) ?? actorId,
    signerEmail: pickString(signer.emailAddress) ?? pickString(signer.email) ??
      pickString(data.signerEmail) ?? pickString(payload.signerEmail),
    signerName: pickString(signer.name) ?? pickString(signer.signerName) ??
      pickString(data.signerName) ?? pickString(payload.signerName),
  };
}

export async function handleBoldSignWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const eventHeader = req.headers.get("X-BoldSign-Event") ??
    req.headers.get("x-boldsign-event");
  if (eventHeader === "Verification") {
    return jsonResponse({ ok: true, verification: true });
  }

  const maxWebhookBytes = 1_048_576;
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxWebhookBytes) {
    return jsonResponse({ error: "BoldSign webhook payload is too large" }, 413);
  }

  const rawBody = await readBodyWithinLimit(req, maxWebhookBytes);
  if (rawBody === null) {
    return jsonResponse({ error: "BoldSign webhook payload is too large" }, 413);
  }
  const webhookSecret = Deno.env.get("BOLDSIGN_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return jsonResponse(
      { error: "BOLDSIGN_WEBHOOK_SECRET is not configured" },
      503,
    );
  }

  const signatureOk = await verifyBoldSignWebhookSignature(
    rawBody,
    req.headers.get("X-BoldSign-Signature") ??
      req.headers.get("x-boldsign-signature"),
    webhookSecret,
  );
  if (!signatureOk) {
    return jsonResponse({ error: "Invalid BoldSign signature" }, 400);
  }

  let payload: JsonMap;
  try {
    payload = JSON.parse(rawBody) as JsonMap;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const envelope = extractBoldSignWebhookEnvelope(payload, eventHeader);
  if (
    !envelope.eventId || !envelope.providerCreatedAt ||
    !envelope.eventEnvironment
  ) {
    return jsonResponse(
      { error: "BoldSign event identity, environment, and created time are required" },
      400,
    );
  }
  const configuredEnvironment = (Deno.env.get("BOLDSIGN_ENVIRONMENT") ?? "live")
    .trim()
    .toLowerCase();
  if (envelope.eventEnvironment.toLowerCase() !== configuredEnvironment) {
    return jsonResponse({ error: "BoldSign environment mismatch" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Webhook persistence is unavailable" }, 503);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("apply_boldsign_webhook_event", {
    p_provider_environment: configuredEnvironment,
    p_provider_event_id: envelope.eventId,
    p_event_type: envelope.eventType,
    p_provider_document_id: envelope.providerDocumentId ?? null,
    p_provider_created_at: envelope.providerCreatedAt,
    p_raw_payload: payload,
    p_recovery_label: envelope.recoveryLabel ?? null,
    p_provider_recipient_id: envelope.signerRecipientId ?? null,
    p_signer_email: envelope.signerEmail ?? null,
    p_signer_name: envelope.signerName ?? null,
    p_signature_verified: true,
  });

  if (error) {
    return jsonResponse(
      { error: "Failed to apply BoldSign event" },
      error.code === "P0409" ? 409 : 500,
    );
  }

  const result = asMap(data);
  return jsonResponse({
    ok: true,
    matched_contract: result.matched_contract === true,
    event_type: envelope.eventType,
    duplicate_event: result.action === "duplicate" || result.duplicate === true,
  });
}
