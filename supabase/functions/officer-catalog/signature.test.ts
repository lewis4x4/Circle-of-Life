// Signing vector for the officer-catalog verifier. The vector is derived at
// test time from a literal, low-entropy secret so no high-entropy hex is ever
// committed (gitleaks). Run: cd supabase/functions && deno test officer-catalog/signature.test.ts
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CONTRACT, TARGET, sign, signingBytes } from "./handler.ts";

const SECRET = "officer-catalog-signature-test-key-" + "b".repeat(32); // built at runtime, low entropy, not a real key
const KEY_ID = "front_office_v1";
const SENT_AT = "1757635200";
const NONCE = "0f6b9a7e-2c4d-4e8f-9a1b-3c5d7e9f0a1b";
const BODY = new TextEncoder().encode('{"op":"catalog"}');

Deno.test("signing bytes follow contract section 2.3 exactly", () => {
  const bytes = signingBytes(KEY_ID, SENT_AT, NONCE, BODY);
  const text = new TextDecoder().decode(bytes);
  assertEquals(text, `${CONTRACT}\n${TARGET}\nPOST\n${KEY_ID}\n${SENT_AT}\n${NONCE}\n{"op":"catalog"}`);
  assertEquals(CONTRACT, "front-office-capability-v1");
  assertEquals(TARGET, "haven");
});

Deno.test("signature is deterministic lowercase hex and matches an independent HMAC", async () => {
  const a = await sign(SECRET, KEY_ID, SENT_AT, NONCE, BODY);
  const b = await sign(SECRET, KEY_ID, SENT_AT, NONCE, BODY);
  assertEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(a));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, signingBytes(KEY_ID, SENT_AT, NONCE, BODY)));
  assertEquals(a, Array.from(mac, (x) => x.toString(16).padStart(2, "0")).join(""));
});

Deno.test("every signed field binds: key id, sent-at, nonce, body byte and secret", async () => {
  const base = await sign(SECRET, KEY_ID, SENT_AT, NONCE, BODY);
  assertNotEquals(base, await sign(SECRET, "front_office_v2", SENT_AT, NONCE, BODY));
  assertNotEquals(base, await sign(SECRET, KEY_ID, "1757635201", NONCE, BODY));
  assertNotEquals(base, await sign(SECRET, KEY_ID, SENT_AT, "0f6b9a7e-2c4d-4e8f-9a1b-3c5d7e9f0a1c", BODY));
  assertNotEquals(base, await sign(SECRET, KEY_ID, SENT_AT, NONCE, new TextEncoder().encode('{"op":"catalog" }')));
  assertNotEquals(base, await sign(SECRET + "x", KEY_ID, SENT_AT, NONCE, BODY));
});

Deno.test("a request signed for cornerstone never verifies as haven", async () => {
  const prefix = new TextEncoder().encode(`${CONTRACT}\ncornerstone\nPOST\n${KEY_ID}\n${SENT_AT}\n${NONCE}\n`);
  const bytes = new Uint8Array(prefix.length + BODY.length);
  bytes.set(prefix);
  bytes.set(BODY, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const other = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
  assertNotEquals(other, await sign(SECRET, KEY_ID, SENT_AT, NONCE, BODY));
});
