import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CONTRACT,
  handleOfficerCatalogRequest,
  MAX_BYTES,
  PUBLISHED_STATUS,
  parseExecuteEnvelope,
  publishedCodeFromDatabase,
  sign,
} from "./officer-catalog/handler.ts";

// Built at runtime and deliberately low-entropy: a test key, never a real one (gitleaks).
const SECRET = "officer-catalog-handler-test-key-" + "a".repeat(32);
const KEY_ID = "front_office_v1";
const OFFICER = { ref: "8f1c3b0e-3d0a-4a8e-9c1e-1c2d3e4f5a6b", email: "cfo@example.invalid", role: "cfo", assurance: "session" };
const CATALOG_HASH = "a".repeat(64);
const encoder = new TextEncoder();

type Call = { name: string; body: Record<string, unknown> };

function fakeRpc(options: {
  key?: { secret_env: string; enabled: boolean } | null;
  execute?: (body: Record<string, unknown>) => Response | Promise<Response>;
  catalog?: () => Response;
  calls?: Call[];
}) {
  const calls = options.calls ?? [];
  const rpc = async (name: string, body: unknown): Promise<Response> => {
    calls.push({ name, body: body as Record<string, unknown> });
    if (name === "officer_key_secret_env") {
      const row = options.key === undefined ? { secret_env: "OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1", enabled: true } : options.key;
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (name === "officer_record_refusal") return new Response("null", { status: 200 });
    if (name === "officer_catalog") return options.catalog ? options.catalog() : new Response(JSON.stringify({ target: "haven", capabilities: [] }), { status: 200 });
    if (name === "officer_execute") return options.execute ? await options.execute(body as Record<string, unknown>) : new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ message: "unknown rpc" }), { status: 404 });
  };
  return { rpc, calls };
}

async function signedRequest(body: string | Uint8Array, overrides: Partial<Record<"keyId" | "sentAt" | "nonce" | "signature" | "contentType" | "method" | "secret" | "target", string>> = {}) {
  const raw: Uint8Array<ArrayBuffer> = typeof body === "string" ? encoder.encode(body) : new Uint8Array(body);
  const keyId = overrides.keyId ?? KEY_ID;
  const sentAt = overrides.sentAt ?? String(Math.floor(Date.now() / 1000));
  const nonce = overrides.nonce ?? crypto.randomUUID();
  let signature = overrides.signature;
  if (!signature) {
    if (overrides.target) {
      // Sign for another target: same layout, different second line.
      const prefix = encoder.encode(`${CONTRACT}\n${overrides.target}\nPOST\n${keyId}\n${sentAt}\n${nonce}\n`);
      const bytes = new Uint8Array(prefix.length + raw.length);
      bytes.set(prefix);
      bytes.set(raw, prefix.length);
      const key = await crypto.subtle.importKey("raw", encoder.encode(overrides.secret ?? SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      signature = await sign(overrides.secret ?? SECRET, keyId, sentAt, nonce, raw);
    }
  }
  return new Request("https://example.invalid/functions/v1/officer-catalog", {
    method: overrides.method ?? "POST",
    headers: {
      "content-type": overrides.contentType ?? "application/json",
      "x-fo-key-id": keyId,
      "x-fo-sent-at": sentAt,
      "x-fo-nonce": nonce,
      "x-fo-signature": signature,
    },
    body: overrides.method === "GET" ? undefined : raw,
  });
}

const silent = () => {};
const deps = (rpc: ReturnType<typeof fakeRpc>["rpc"] | null, secret: string | undefined = SECRET) => ({
  rpc,
  getSecret: (name: string) => (name === "OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1" ? secret : undefined),
  log: silent,
});

async function expectError(response: Response, status: number, code: string) {
  assertEquals(response.status, status);
  const body = await response.json();
  assertEquals(body, { error: code });
  assert(Object.hasOwn(PUBLISHED_STATUS, code), `unpublished code ${code}`);
}

const executeBody = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ op: "execute", officer: OFFICER, capability: "occupied_beds", version: 1, args: {}, catalog_hash: CATALOG_HASH, ...extra });

Deno.test("method, content type and header gates answer before any database call", async () => {
  const { rpc, calls } = fakeRpc({});
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { method: "GET" }), deps(rpc)), 405, "method_not_allowed");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { contentType: "text/plain" }), deps(rpc)), 415, "unsupported_content_type");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { keyId: "bad key!" }), deps(rpc)), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { nonce: "not-a-uuid" }), deps(rpc)), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { sentAt: String(Math.floor(Date.now() / 1000) - 90) }), deps(rpc)), 401, "expired_request");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { sentAt: String(Math.floor(Date.now() / 1000) + 90) }), deps(rpc)), 401, "expired_request");
  assertEquals(calls.length, 0);
});

Deno.test("malformed key id, sent-at, nonce or signature are rejected before any secret lookup or signing", async () => {
  const { rpc, calls } = fakeRpc({});
  let secretReads = 0;
  const spyDeps = { rpc, getSecret: () => { secretReads += 1; return SECRET; }, log: silent };
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { keyId: "bad key!" }), spyDeps), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { sentAt: "12345" }), spyDeps), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { nonce: "not-a-uuid" }), spyDeps), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { signature: "zz" }), spyDeps), 401, "invalid_authentication");
  assertEquals(secretReads, 0);
  assertEquals(calls.length, 0);
});

Deno.test("unsigned or badly signed requests write nothing anywhere", async () => {
  const { rpc, calls } = fakeRpc({});
  const body = executeBody();
  const unsigned = await signedRequest(body);
  unsigned.headers.delete("x-fo-signature");
  await expectError(await handleOfficerCatalogRequest(new Request(unsigned, { headers: unsigned.headers }), deps(rpc)), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest(body, { secret: "z".repeat(40) }), deps(rpc)), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest(body, { target: "cornerstone" }), deps(rpc)), 401, "invalid_authentication");
  const good = await signedRequest(body);
  await expectError(await handleOfficerCatalogRequest(new Request(good, { body: body + " " }), deps(rpc)), 401, "invalid_authentication");
  // Only the secret NAME lookup ran; no execute, no catalog, no refusal row.
  assert(calls.every((c) => c.name === "officer_key_secret_env"), JSON.stringify(calls.map((c) => c.name)));
  // And a correctly signed request for haven passes the same gate.
  const response = await handleOfficerCatalogRequest(await signedRequest(body), deps(rpc));
  assertEquals(response.status, 200);
});

Deno.test("oversized body is refused while streaming", async () => {
  const { rpc, calls } = fakeRpc({});
  const big = new Uint8Array(MAX_BYTES + 1).fill(0x20);
  await expectError(await handleOfficerCatalogRequest(await signedRequest(big), deps(rpc)), 413, "invalid_size");
  assertEquals(calls.length, 0);
});

Deno.test("signature failures: wrong secret, wrong target, tampered body, unknown key, short secret", async () => {
  const { rpc, calls } = fakeRpc({});
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { secret: "x".repeat(40) }), deps(rpc)), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { target: "cornerstone" }), deps(rpc)), 401, "invalid_authentication");
  const request = await signedRequest('{"op":"catalog"}');
  const tampered = new Request(request, { body: '{"op":"catalog" }' });
  await expectError(await handleOfficerCatalogRequest(tampered, deps(rpc)), 401, "invalid_authentication");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}'), deps(rpc, "short")), 401, "invalid_authentication");
  const unknown = fakeRpc({ key: null });
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}'), deps(unknown.rpc)), 401, "invalid_authentication");
  // No refusal was recorded for anything pre-signature.
  assert(calls.every((c) => c.name === "officer_key_secret_env"));
  assert(unknown.calls.every((c) => c.name === "officer_key_secret_env"));
});

Deno.test("disabled key is reported only after the signature verified, and audited", async () => {
  const disabled = fakeRpc({ key: { secret_env: "OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1", enabled: false } });
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}', { secret: "y".repeat(40) }), deps(disabled.rpc)), 401, "invalid_authentication");
  assertEquals(disabled.calls.filter((c) => c.name === "officer_record_refusal").length, 0);
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}'), deps(disabled.rpc)), 403, "key_disabled");
  const refusal = disabled.calls.find((c) => c.name === "officer_record_refusal");
  assert(refusal);
  assertEquals(refusal.body.p_error_code, "key_disabled");
  assertEquals(refusal.body.p_key_id, KEY_ID);
});

Deno.test("catalog passes the database document through", async () => {
  const { rpc, calls } = fakeRpc({ catalog: () => new Response(JSON.stringify({ target: "haven", contract: CONTRACT, capabilities: [{ name: "occupied_beds" }] }), { status: 200 }) });
  const response = await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}'), deps(rpc));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).capabilities.length, 1);
  assertEquals(calls.map((c) => c.name), ["officer_key_secret_env", "officer_catalog"]);
});

Deno.test("body is parsed only after verification; malformed envelopes are invalid_json or invalid_contract", async () => {
  const { rpc, calls } = fakeRpc({});
  await expectError(await handleOfficerCatalogRequest(await signedRequest("{not json"), deps(rpc)), 400, "invalid_json");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog","extra":1}'), deps(rpc)), 400, "invalid_contract");
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"drop"}'), deps(rpc)), 400, "invalid_contract");
  await expectError(await handleOfficerCatalogRequest(await signedRequest(executeBody({ officer: { ...OFFICER, p_caller_role: "owner" } })), deps(rpc)), 400, "invalid_contract");
  await expectError(await handleOfficerCatalogRequest(await signedRequest(executeBody({ args: { note: "x".repeat(201) } })), deps(rpc)), 400, "invalid_args");
  await expectError(await handleOfficerCatalogRequest(await signedRequest(executeBody({ args: { nested: { a: 1 } } })), deps(rpc)), 400, "invalid_args");
  await expectError(await handleOfficerCatalogRequest(await signedRequest(executeBody({ intent: { intent_id: "nope" } })), deps(rpc)), 400, "invalid_contract");
  assertEquals(calls.filter((c) => c.name === "officer_execute").length, 0);
  // Shape failures after verification are audited as refusals.
  assert(calls.some((c) => c.name === "officer_record_refusal" && c.body.p_error_code === "invalid_contract"));
});

Deno.test("execute forwards exactly the contract parameters", async () => {
  let seen: Record<string, unknown> | null = null;
  const { rpc } = fakeRpc({
    execute: (body) => {
      seen = body;
      return new Response(JSON.stringify({ ok: true, kind: "read", value: 3 }), { status: 200 });
    },
  });
  const request = await signedRequest(executeBody());
  const response = await handleOfficerCatalogRequest(request, deps(rpc));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).value, 3);
  assert(seen);
  const params = seen as Record<string, unknown>;
  assertEquals(Object.keys(params).sort(), [
    "p_args", "p_capability", "p_catalog_hash", "p_key_id", "p_nonce", "p_officer_assurance",
    "p_officer_email", "p_officer_ref", "p_officer_role", "p_sent_at", "p_version",
  ]);
  assertEquals(params.p_nonce, request.headers.get("x-fo-nonce"));
  assertEquals(params.p_sent_at, new Date(Number(request.headers.get("x-fo-sent-at")) * 1000).toISOString());
  assert(!Object.hasOwn(params, "p_intent"));
  assertEquals(params.p_officer_ref, OFFICER.ref);
  // A command carries the intent through unchanged.
  const intent = { intent_id: "3b9d2c1a-6f4e-4b8a-9d2e-0f1a2b3c4d5e", expected_version: null };
  await handleOfficerCatalogRequest(await signedRequest(executeBody({ capability: "command_ping", intent })), deps(rpc));
  assertEquals((seen as unknown as Record<string, unknown>).p_intent, intent);
});

Deno.test("database refusals map to published codes and are audited; nothing else leaks", async () => {
  const cases: [Record<string, unknown>, number, string, boolean][] = [
    [{ code: "42501", message: "principal_unknown" }, 403, "principal_unknown", true],
    [{ code: "42501", message: "principal_inactive" }, 403, "principal_inactive", true],
    [{ code: "42501", message: "capability_denied" }, 403, "capability_denied", true],
    [{ code: "42501", message: "assurance_required" }, 403, "assurance_required", true],
    [{ code: "22023", message: "invalid_args" }, 400, "invalid_args", true],
    [{ code: "22023", message: "idempotency_key_reused" }, 400, "idempotency_key_reused", true],
    [{ code: "P0409", message: "version_conflict" }, 409, "version_conflict", true],
    [{ code: "23505", message: "replayed_request" }, 409, "replayed_request", true],
    [{ code: "23505", message: 'duplicate key value violates unique constraint "request_nonces_pkey"' }, 409, "replayed_request", true],
    [{ code: "P0401", message: "expired_request" }, 401, "expired_request", true],
    [{ code: "P0429", message: "rate_limited" }, 429, "rate_limited", false],
    [{ code: "42501", message: "permission denied for function officer_execute" }, 503, "target_unavailable", false],
    [{ code: "42P01", message: 'relation "officer.residents" does not exist' }, 503, "target_unavailable", false],
    [{ code: "XX000", message: "target_unavailable" }, 503, "target_unavailable", false],
  ];
  for (const [dbError, status, code, recorded] of cases) {
    const { rpc, calls } = fakeRpc({ execute: () => new Response(JSON.stringify(dbError), { status: 400 }) });
    const response = await handleOfficerCatalogRequest(await signedRequest(executeBody()), deps(rpc));
    const text = await response.text();
    assertEquals(response.status, status, `${code} status`);
    assertEquals(JSON.parse(text), { error: code });
    assert(!text.includes("duplicate key") && !text.includes("relation") && !text.includes("permission denied"));
    assertEquals(calls.some((c) => c.name === "officer_record_refusal"), recorded, `${code} audited`);
  }
});

Deno.test("serialization failure is retried once", async () => {
  let attempts = 0;
  const { rpc } = fakeRpc({
    execute: () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ code: "40001", message: "could not serialize access" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const response = await handleOfficerCatalogRequest(await signedRequest(executeBody()), deps(rpc));
  assertEquals(response.status, 200);
  assertEquals(attempts, 2);
});

Deno.test("missing service configuration and transport failures are target_unavailable", async () => {
  await expectError(await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}'), deps(null)), 503, "target_unavailable");
  const failing = async () => {
    throw new Error("connection refused to https://secret.internal with apikey=abc");
  };
  const response = await handleOfficerCatalogRequest(await signedRequest('{"op":"catalog"}'), deps(failing));
  const text = await response.text();
  assertEquals(response.status, 503);
  assertEquals(JSON.parse(text), { error: "target_unavailable" });
  assert(!text.includes("apikey") && !text.includes("secret.internal"));
});

Deno.test("envelope parser accepts the documented command shape", () => {
  const parsed = parseExecuteEnvelope(JSON.parse(executeBody({ capability: "command_ping", intent: { intent_id: OFFICER.ref, expected_version: null } })));
  assertEquals(parsed.intent, { intent_id: OFFICER.ref, expected_version: null });
  assertEquals(publishedCodeFromDatabase({ code: "42501", message: "principal_unknown" }), "principal_unknown");
  assertEquals(publishedCodeFromDatabase({ code: "23505", message: "anything" }), "replayed_request");
  assertEquals(publishedCodeFromDatabase({ code: "42501", message: "target_unavailable" }), "target_unavailable");
  assertEquals(publishedCodeFromDatabase({}), "target_unavailable");
});
