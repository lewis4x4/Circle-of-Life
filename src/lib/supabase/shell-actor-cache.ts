/**
 * Short-lived, signed cache of the shell actor the proxy resolves with
 * `haven_current_shell_actor` (COL-674).
 *
 * The proxy runs at the edge, near the user, and that RPC went to the database
 * on every navigation and every prefetch: 110–365 ms from Florida, most of the
 * fixed cost of a click. The answer only decides which shell a request is
 * routed to. It never grants data: PostgREST's pre-request hook
 * (`haven_assert_authorized_request`, migration 326) re-checks the session and
 * the actor on every query. So the proxy may route on an answer that is a few
 * seconds old, as long as the answer:
 *
 * - is signed with a server-only secret (HMAC-SHA256, Web Crypto), so a
 *   client cannot write its own role into the cookie;
 * - is bound to the verified JWT's `sub`, `session_id` and `auth_claim_version`,
 *   so it cannot move to another user or session, and a role or organization
 *   change (which bumps the claim version, migration 326) misses the cache as
 *   soon as the client's token is refreshed;
 * - expires after `HAVEN_SHELL_ACTOR_CACHE_TTL_SECONDS` (default 60, max 300);
 * - is never stored while a password change is pending, so finishing the
 *   change is seen on the very next request.
 *
 * The TTL is therefore also the longest the proxy can keep routing a revoked
 * session, or skip the /change-password redirect after an admin forces a reset
 * on a live session, before the database is asked again. Neither exposes data.
 * Rotating the secret or setting the TTL to 0 invalidates every cookie at once.
 *
 * With no secret configured (or TTL 0) the cache is off and the proxy asks the
 * database on every request, as before.
 */

export const SHELL_ACTOR_CACHE_COOKIE = "haven-shell-actor";

const DEFAULT_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

export type CachedShellActor = {
  user_id: string;
  organization_id: string;
  app_role: string;
  auth_claim_version: number;
};

type CachePayload = CachedShellActor & { v: 1; sid: string; exp: number };

/** What the verified JWT says; a cached answer is only good for exactly this. */
export type ShellActorBinding = { sub: string; sessionId: string; claimVersion: number | null };

export type ShellActorCacheConfig = { secret: string; ttlSeconds: number };

export function shellActorCacheConfig(env: Record<string, string | undefined> = process.env): ShellActorCacheConfig | null {
  const secret = env.HAVEN_SHELL_ACTOR_CACHE_SECRET?.trim() ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const raw = env.HAVEN_SHELL_ACTOR_CACHE_TTL_SECONDS?.trim();
  const parsed = raw ? Number(raw) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return { secret, ttlSeconds: Math.min(Math.floor(parsed), MAX_TTL_SECONDS) };
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, key);
  }
  return key;
}

/** The signed cookie value for this actor, or null when it must not be cached. */
export async function signShellActor(
  actor: CachedShellActor & { must_change_password?: boolean },
  binding: ShellActorBinding,
  config: ShellActorCacheConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (actor.must_change_password === true) return null;
  if (actor.user_id !== binding.sub || !binding.sessionId) return null;
  // A token minted before the current authority must not seed the cache.
  if (binding.claimVersion === null || actor.auth_claim_version !== binding.claimVersion) return null;
  const payload: CachePayload = {
    v: 1,
    user_id: actor.user_id,
    organization_id: actor.organization_id,
    app_role: actor.app_role,
    auth_claim_version: actor.auth_claim_version,
    sid: binding.sessionId,
    exp: nowSeconds + config.ttlSeconds,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(config.secret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** The cached actor when the cookie is authentic, unexpired and bound to this session; otherwise null. */
export async function readShellActor(
  cookieValue: string | undefined,
  binding: ShellActorBinding,
  config: ShellActorCacheConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<CachedShellActor | null> {
  if (!cookieValue || !binding.sessionId || binding.claimVersion === null) return null;
  const [body, signaturePart, extra] = cookieValue.split(".");
  if (!body || !signaturePart || extra !== undefined) return null;
  const signature = fromBase64Url(signaturePart);
  if (!signature) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(config.secret), signature, encoder.encode(body));
  if (!valid) return null;
  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  let payload: Partial<CachePayload>;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CachePayload>;
  } catch {
    return null;
  }
  if (payload.v !== 1 || typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
  // Lowering the TTL shortens cookies already issued (5 s allows for clock skew).
  if (payload.exp > nowSeconds + config.ttlSeconds + 5) return null;
  if (payload.user_id !== binding.sub || payload.sid !== binding.sessionId) return null;
  if (typeof payload.organization_id !== "string" || typeof payload.app_role !== "string") return null;
  if (payload.auth_claim_version !== binding.claimVersion) return null;
  return {
    user_id: payload.user_id,
    organization_id: payload.organization_id,
    app_role: payload.app_role,
    auth_claim_version: payload.auth_claim_version,
  };
}
