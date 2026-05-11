export const BOLDSIGN_API_BASE_URL = (Deno.env.get("BOLDSIGN_API_BASE_URL") ?? "https://api.boldsign.com").replace(/\/$/, "");

export function getBoldSignApiKey(): string {
  const key = Deno.env.get("BOLDSIGN_API_KEY");
  if (!key) throw new Error("BOLDSIGN_API_KEY is not configured");
  return key;
}

export function getTemplateId(contractType: string, explicit?: string | null): string {
  const envKey = `BOLDSIGN_TEMPLATE_${contractType.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const templateId = explicit || Deno.env.get(envKey) || Deno.env.get("BOLDSIGN_DEFAULT_TEMPLATE_ID");
  if (!templateId) throw new Error(`No BoldSign template configured for ${contractType}; set ${envKey} or BOLDSIGN_DEFAULT_TEMPLATE_ID`);
  return templateId;
}

export async function boldSignFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("X-API-KEY", getBoldSignApiKey());
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json;odata.metadata=minimal;odata.streaming=true");
  }
  return fetch(`${BOLDSIGN_API_BASE_URL}${path}`, { ...init, headers });
}

export function parseBoldSignSignatureHeader(header: string | null): { timestamp: string; signatures: string[] } | null {
  if (!header) return null;
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=");
    if (key === "t") timestamp = value;
    if ((key === "s0" || key === "s1") && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function verifyBoldSignWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string, toleranceSeconds = 300): Promise<boolean> {
  const parsed = parseBoldSignSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const age = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (toleranceSeconds > 0 && age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${parsed.timestamp}.${rawBody}`;
  const digest = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return parsed.signatures.some((signature) => constantTimeEqualHex(digest, signature.toLowerCase()));
}

export function normalizeBoldSignEventToStatus(eventType: string): string | null {
  const event = eventType.toLowerCase();
  if (event === "sent") return "sent";
  if (event === "viewed") return "viewed";
  if (event === "signed") return "partially_signed";
  if (event === "completed") return "completed";
  if (event === "declined") return "declined";
  if (event === "revoked") return "voided";
  if (event === "expired") return "expired";
  if (event === "sendfailed" || event === "deliveryfailed" || event === "templatesendfailed") return "draft";
  return null;
}

export function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
