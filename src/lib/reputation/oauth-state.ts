import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "v1.";

export type OAuthStatePayload = {
  orgId: string;
  userId: string;
};

function getSecret(): string | null {
  const s = process.env.REPUTATION_OAUTH_STATE_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

export function signOAuthState(payload: OAuthStatePayload): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const nonce = randomBytes(16).toString("hex");
  const body = JSON.stringify({
    ...payload,
    nonce,
    exp: Date.now() + 10 * 60 * 1000,
  });
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  const bodyB64 = Buffer.from(body, "utf8").toString("base64url");
  return `${PREFIX}${bodyB64}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const secret = getSecret();
  if (!secret || !state.startsWith(PREFIX)) return null;
  const rest = state.slice(PREFIX.length);
  const lastDot = rest.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const bodyB64 = rest.slice(0, lastDot);
  const sig = rest.slice(lastDot + 1);
  let body: string;
  try {
    body = Buffer.from(bodyB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as {
      orgId: string;
      userId: string;
      exp: number;
      nonce: string;
    };
    if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) return null;
    if (!parsed.orgId || !parsed.userId) return null;
    return { orgId: parsed.orgId, userId: parsed.userId };
  } catch {
    return null;
  }
}
