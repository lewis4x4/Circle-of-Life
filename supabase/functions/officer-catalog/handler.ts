/**
 * officer-catalog: the Haven target side of the Front Office capability
 * federation (contract front-office-capability-v1, target `haven`).
 *
 * Deployed with gateway JWT verification off. The request HMAC is the caller's
 * identity. This function:
 *   1. bounds the raw body (64 KiB) and validates the four x-fo-* headers;
 *   2. asks the database which Edge secret NAME belongs to the key id;
 *   3. verifies HMAC-SHA256 over the contract signing bytes, in constant time,
 *      BEFORE parsing the body;
 *   4. parses and shape-checks the envelope, then calls one of two doors
 *      (public.officer_catalog / public.officer_execute) through PostgREST
 *      with the project's service role;
 *   5. answers the database result verbatim on success and `{error: code}`
 *      with a published code on any failure.
 *
 * No database message, header, payload, figure or secret ever appears in a
 * response or a log line. Logs carry code, status, op and milliseconds only.
 *
 * Self-contained by design: no supabase-js, no `_shared/current-actor` (there is
 * no user session on this path). The structured logger is the only import.
 */
import { withTiming } from "../_shared/structured-log.ts";

export const CONTRACT = "front-office-capability-v1";
export const TARGET = "haven";
export const MAX_BYTES = 64 * 1024;
export const MAX_SKEW_SECONDS = 60;

const OFFICER_ROLES = new Set(["owner", "ceo", "cfo", "coo", "ctdo"]);
const ASSURANCES = new Set(["session", "mfa"]);
const KEY_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SENT_AT = /^\d{10}$/;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const CAPABILITY = /^[a-z][a-z0-9_]{0,63}$/;
const SECRET_ENV = /^OFFICER_GATEWAY_HMAC_[A-Z0-9_]{1,64}$/;

/** Published error codes and their statuses (contract section 2.7). Nothing else is ever returned. */
export const PUBLISHED_STATUS: Readonly<Record<string, number>> = {
  invalid_json: 400,
  invalid_contract: 400,
  invalid_args: 400,
  idempotency_key_reused: 400,
  invalid_authentication: 401,
  expired_request: 401,
  key_disabled: 403,
  capability_denied: 403,
  principal_unknown: 403,
  principal_inactive: 403,
  assurance_required: 403,
  method_not_allowed: 405,
  replayed_request: 409,
  version_conflict: 409,
  catalog_stale: 412,
  invalid_size: 413,
  unsupported_content_type: 415,
  rate_limited: 429,
  target_unavailable: 503,
};

/**
 * Refusals worth an audit row once the signature has verified. Never
 * pre-signature codes. rate_limited is recorded too: the database
 * deduplicates it to one row per key per minute and it counts only toward
 * the refusal window, so a flood stays attributable without locking the key
 * out of successful work.
 */
const RECORDED_REFUSALS = new Set([
  "invalid_contract",
  "invalid_args",
  "idempotency_key_reused",
  "expired_request",
  "key_disabled",
  "capability_denied",
  "principal_unknown",
  "principal_inactive",
  "assurance_required",
  "replayed_request",
  "version_conflict",
  "rate_limited",
]);

export class OfficerCatalogError extends Error {
  constructor(public readonly code: keyof typeof PUBLISHED_STATUS | string) {
    super(code);
  }
  get status(): number {
    return PUBLISHED_STATUS[this.code] ?? 503;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Contract section 2.3: prefix lines, then the raw body bytes exactly as sent. */
export function signingBytes(keyId: string, sentAt: string, nonce: string, raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const prefix = encoder.encode(`${CONTRACT}\n${TARGET}\nPOST\n${keyId}\n${sentAt}\n${nonce}\n`);
  const out = new Uint8Array(prefix.length + raw.length);
  out.set(prefix);
  out.set(raw, prefix.length);
  return out;
}

/** Test helper and reference signer; production callers live in Front Office. */
export async function sign(secret: string, keyId: string, sentAt: string, nonce: string, raw: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, signingBytes(keyId, sentAt, nonce, raw));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(secret: string, keyId: string, sentAt: string, nonce: string, signature: string, raw: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(signature.match(/../g)!, (b) => parseInt(b, 16));
  // WebCrypto verify is constant time over the MAC; it never exposes the expected MAC.
  return await crypto.subtle.verify("HMAC", key, sig, signingBytes(keyId, sentAt, nonce, raw));
}

/** Stream counting enforces the bound even when Content-Length is absent or dishonest. */
export async function readBoundedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new OfficerCatalogError("invalid_size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  if (!required.every((k) => Object.hasOwn(value, k))) return false;
  return keys.every((k) => required.includes(k) || optional.includes(k));
}

export interface ExecuteEnvelope {
  officer: { ref: string; email: string; role: string; assurance: string };
  capability: string;
  version: number;
  args: Record<string, unknown>;
  catalog_hash: string;
  intent: { intent_id: string; expected_version?: number | null } | null;
}

/** Shape check only; the database is the authority on every value. */
export function parseExecuteEnvelope(body: Record<string, unknown>): ExecuteEnvelope {
  if (!exactKeys(body, ["op", "officer", "capability", "version", "args", "catalog_hash"], ["intent"])) {
    throw new OfficerCatalogError("invalid_contract");
  }
  const officer = body.officer;
  if (!isPlainObject(officer) || !exactKeys(officer, ["ref", "email", "role", "assurance"])) throw new OfficerCatalogError("invalid_contract");
  if (typeof officer.ref !== "string" || !UUID.test(officer.ref)) throw new OfficerCatalogError("invalid_contract");
  if (typeof officer.email !== "string" || officer.email.length < 3 || officer.email.length > 320 || !officer.email.includes("@")) throw new OfficerCatalogError("invalid_contract");
  if (typeof officer.role !== "string" || !OFFICER_ROLES.has(officer.role)) throw new OfficerCatalogError("invalid_contract");
  if (typeof officer.assurance !== "string" || !ASSURANCES.has(officer.assurance)) throw new OfficerCatalogError("invalid_contract");
  if (typeof body.capability !== "string" || !CAPABILITY.test(body.capability)) throw new OfficerCatalogError("invalid_contract");
  if (typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version < 1) throw new OfficerCatalogError("invalid_contract");
  if (typeof body.catalog_hash !== "string" || !SHA256_HEX.test(body.catalog_hash)) throw new OfficerCatalogError("invalid_contract");
  const args = body.args;
  if (!isPlainObject(args) || Object.keys(args).length > 32 || Object.keys(args).some((k) => k.length > 64)) throw new OfficerCatalogError("invalid_args");
  for (const value of Object.values(args)) {
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new OfficerCatalogError("invalid_args");
    if (typeof value === "string" && value.length > 200) throw new OfficerCatalogError("invalid_args");
  }
  let intent: ExecuteEnvelope["intent"] = null;
  if (Object.hasOwn(body, "intent") && body.intent !== null) {
    const raw = body.intent;
    if (!isPlainObject(raw) || !exactKeys(raw, ["intent_id"], ["expected_version"])) throw new OfficerCatalogError("invalid_contract");
    if (typeof raw.intent_id !== "string" || !UUID.test(raw.intent_id)) throw new OfficerCatalogError("invalid_contract");
    if (Object.hasOwn(raw, "expected_version") && raw.expected_version !== null && !Number.isSafeInteger(raw.expected_version)) throw new OfficerCatalogError("invalid_contract");
    intent = { intent_id: raw.intent_id, expected_version: (raw.expected_version as number | null | undefined) ?? null };
  }
  return {
    officer: { ref: officer.ref, email: officer.email, role: officer.role, assurance: officer.assurance },
    capability: body.capability,
    version: body.version,
    args,
    catalog_hash: body.catalog_hash,
    intent,
  };
}

/** Map a PostgREST error body to a published code. Message-first (the database raises the code as its message), SQLSTATE as the fallback. */
export function publishedCodeFromDatabase(error: { code?: unknown; message?: unknown }): string {
  const message = typeof error.message === "string" ? error.message : "";
  if (Object.hasOwn(PUBLISHED_STATUS, message) && message !== "target_unavailable") return message;
  if (error.code === "23505") return "replayed_request";
  return "target_unavailable";
}

export interface Rpc {
  (name: string, body: unknown): Promise<Response>;
}

export interface HandlerDeps {
  rpc: Rpc | null;
  getSecret: (name: string) => string | undefined;
  now?: () => number;
  log?: (entry: { event: string; outcome: "success" | "blocked" | "error"; status: number; error_code?: string; op?: string }) => void;
}

export function serviceRpc(url: string | undefined, serviceKey: string | undefined): Rpc | null {
  if (!url || !serviceKey) return null;
  return (name: string, body: unknown) =>
    fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function handleOfficerCatalogRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const timing = withTiming("officer-catalog");
  const log = deps.log ?? ((entry) => timing.log({ ...entry, outcome: entry.outcome }));
  const now = deps.now ?? Date.now;
  const keyId = request.headers.get("x-fo-key-id") ?? "";
  const sentAt = request.headers.get("x-fo-sent-at") ?? "";
  const nonce = (request.headers.get("x-fo-nonce") ?? "").toLowerCase();
  const signature = (request.headers.get("x-fo-signature") ?? "").toLowerCase();
  let op = "";
  let verified = false;
  let refusalContext: { officerRef: string | null; capability: string | null; version: number | null } = { officerRef: null, capability: null, version: null };

  const recordRefusal = async (code: string) => {
    if (!verified || !deps.rpc || !RECORDED_REFUSALS.has(code) || !KEY_ID.test(keyId)) return;
    try {
      await deps.rpc("officer_record_refusal", {
        p_key_id: keyId,
        p_officer_ref: refusalContext.officerRef,
        p_capability: refusalContext.capability,
        p_capability_version: refusalContext.version,
        p_nonce: NONCE.test(nonce) ? nonce : null,
        p_error_code: code,
      });
    } catch {
      /* never fail the caller because a refusal could not be recorded */
    }
  };

  const fail = async (code: string): Promise<Response> => {
    const status = PUBLISHED_STATUS[code] ?? 503;
    const published = status === 503 ? "target_unavailable" : code;
    await recordRefusal(published);
    log({ event: "request", outcome: status >= 500 ? "error" : "blocked", status, error_code: published, op: op || undefined });
    return reply(status, { error: published });
  };

  try {
    if (request.method !== "POST") throw new OfficerCatalogError("method_not_allowed");
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new OfficerCatalogError("unsupported_content_type");
    if (!KEY_ID.test(keyId) || !SENT_AT.test(sentAt) || !NONCE.test(nonce) || !SIGNATURE.test(signature)) throw new OfficerCatalogError("invalid_authentication");
    if (Math.abs(now() / 1000 - Number(sentAt)) > MAX_SKEW_SECONDS) throw new OfficerCatalogError("expired_request");
    const raw = await readBoundedBody(request);
    if (raw.byteLength === 0) throw new OfficerCatalogError("invalid_size");
    if (!deps.rpc) throw new OfficerCatalogError("target_unavailable");

    // Which secret? The database holds only the NAME; the value lives in Edge secrets.
    const keyResponse = await deps.rpc("officer_key_secret_env", { p_key_id: keyId });
    if (!keyResponse.ok) throw new OfficerCatalogError("target_unavailable");
    const keyRow = (await keyResponse.json()) as { secret_env?: unknown; enabled?: unknown } | null;
    const secretEnv = keyRow && typeof keyRow.secret_env === "string" && SECRET_ENV.test(keyRow.secret_env) ? keyRow.secret_env : null;
    const secret = secretEnv ? deps.getSecret(secretEnv) : undefined;
    if (!secret || encoder.encode(secret).length < 32) throw new OfficerCatalogError("invalid_authentication");
    if (!(await verifySignature(secret, keyId, sentAt, nonce, signature, raw))) throw new OfficerCatalogError("invalid_authentication");
    verified = true;
    if (keyRow?.enabled !== true) throw new OfficerCatalogError("key_disabled");

    // Only now is the body parsed.
    let body: unknown;
    try {
      body = JSON.parse(decoder.decode(raw));
    } catch {
      throw new OfficerCatalogError("invalid_json");
    }
    if (!isPlainObject(body) || typeof body.op !== "string") throw new OfficerCatalogError("invalid_contract");
    op = body.op;

    if (op === "catalog") {
      if (!exactKeys(body, ["op"])) throw new OfficerCatalogError("invalid_contract");
      const response = await deps.rpc("officer_catalog", { p_key_id: keyId });
      if (!response.ok) throw new OfficerCatalogError(publishedCodeFromDatabase(await safeJson(response)));
      log({ event: "request", outcome: "success", status: 200, op });
      return reply(200, await response.json());
    }

    if (op !== "execute") throw new OfficerCatalogError("invalid_contract");
    const envelope = parseExecuteEnvelope(body);
    refusalContext = { officerRef: envelope.officer.ref, capability: envelope.capability, version: envelope.version };
    const params = {
      p_key_id: keyId,
      p_officer_ref: envelope.officer.ref,
      p_officer_email: envelope.officer.email,
      p_officer_role: envelope.officer.role,
      p_officer_assurance: envelope.officer.assurance,
      p_nonce: nonce,
      p_sent_at: new Date(Number(sentAt) * 1000).toISOString(),
      p_capability: envelope.capability,
      p_version: envelope.version,
      p_args: envelope.args,
      p_catalog_hash: envelope.catalog_hash,
      // Commands only; a read omits the key so the database default (NULL) applies.
      ...(envelope.intent ? { p_intent: envelope.intent } : {}),
    };
    let response = await deps.rpc("officer_execute", params);
    if (!response.ok) {
      const error = await safeJson(response);
      if (error.code === "40001") {
        // Serialization failure: one retry, as the contract allows.
        response = await deps.rpc("officer_execute", params);
        if (!response.ok) throw new OfficerCatalogError(publishedCodeFromDatabase(await safeJson(response)));
      } else {
        throw new OfficerCatalogError(publishedCodeFromDatabase(error));
      }
    }
    log({ event: "request", outcome: "success", status: 200, op });
    return reply(200, await response.json());
  } catch (error) {
    if (error instanceof OfficerCatalogError) return await fail(error.code);
    // Deliberately omit database responses, payloads, headers and secrets.
    return await fail("target_unavailable");
  }
}

async function safeJson(response: Response): Promise<{ code?: unknown; message?: unknown }> {
  try {
    const parsed = await response.json();
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
