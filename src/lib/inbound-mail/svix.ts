import { createHmac, timingSafeEqual } from "node:crypto";

/** Five minutes either side, the Svix default: rejects replays of old deliveries. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies a Svix-signed webhook (AgentMail delivers through Svix). The signed content is
 * `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret after `whsec_`;
 * `svix-signature` holds space-separated `v1,<base64>` entries, any of which may match.
 */
export function verifySvixSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret.startsWith("whsec_") || !headers.id || !headers.timestamp || !headers.signature) return false;
  if (!/^\d{1,12}$/.test(headers.timestamp)) return false;
  if (Math.abs(nowSeconds - Number(headers.timestamp)) > SVIX_TOLERANCE_SECONDS) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.slice("whsec_".length), "base64"); } catch { return false; }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  return headers.signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
