import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicReferralSchema } from "@/lib/referrals/public-referral";
import { logError } from "@/lib/observability/logger";

// Canonical facility IDs from 008_seed_col_organization.sql; never accept a
// caller-supplied organization, actor, or database facility ID. The RPC resolves
// the current organization and verifies that this facility is still active.
const facilityIds = {
  oakridge: "00000000-0000-0000-0002-000000000001",
  "rising-oaks": "00000000-0000-0000-0002-000000000002",
  homewood: "00000000-0000-0000-0002-000000000003",
  plantation: "00000000-0000-0000-0002-000000000004",
  "grande-cypress": "00000000-0000-0000-0002-000000000005",
} as const;

const reply = (body: object, status: number, headers: Record<string, string> = {}) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers },
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const expectedHost = request.headers.get("host")?.trim() || requestUrl.host;
  const originUrl = origin ? new URL(origin) : null;
  if ((originUrl && (originUrl.protocol !== requestUrl.protocol || originUrl.host !== expectedHost))
      || request.headers.get("sec-fetch-site") === "cross-site") {
    return reply({ error: "This submission is not allowed." }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return reply({ error: "Send a JSON request." }, 415);
  }
  if (Number(request.headers.get("content-length")) > 16384) {
    return reply({ error: "Request is too large." }, 413);
  }
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Invalid request." }, 400);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384) {
          await reader.cancel();
          return reply({ error: "Request is too large." }, 413);
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      body = JSON.parse(text + decoder.decode());
    } finally {
      reader.releaseLock();
    }
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  const parsed = publicReferralSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "Check your contact details and request, then try again." }, 400);
  const value = parsed.data;
  const notes = value.kind === "inquiry" ? value.message : [
    "Tour request only; date, time and lunch require staff confirmation.",
    `Preferred date: ${value.tourDate}`,
    `Preferred time (America/New_York): ${value.tourTime}`,
    `Lunch preference: ${value.lunchOption}`,
  ].join("\n");
  try {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("Public intake server configuration unavailable");
    // Netlify supplies the trusted connection IP. Only the purpose-bound HMAC
    // reaches storage; never log the raw header, fingerprint, or signing secret.
    const clientAddress = request.headers.get("x-nf-client-connection-ip")?.trim()
      || "missing-client-address";
    const fingerprint = createHmac("sha256", secret)
      .update("haven-public-referral-client-v1\0").update(clientAddress).digest("hex");
    const { data, error } = await createServiceRoleClient().rpc("public_referral_intake" as never, {
      p_request_key: value.requestKey,
      p_facility_id: facilityIds[value.facility],
      p_kind: value.kind,
      p_name: value.name,
      p_phone: value.phone,
      p_email: value.email,
      p_notes: notes,
      p_client_fingerprint: fingerprint,
    } as never);
    if (error) {
      if (error.code === "22023") return reply({ error: "Check your request details." }, 400);
      if (error.code === "23505") return reply({ error: "This request changed. Contact the community to confirm receipt before sending another request." }, 409);
      if (error.code === "42501") return reply({ error: "This community cannot receive online requests right now. Please call directly." }, 403);
      if (error.code === "P0429") return reply({ error: "Too many requests. Please wait ten minutes or call the community directly." }, 429, { "Retry-After": "600" });
      logError("public-referrals.intake", new Error("Public referral database request failed"), { failure: "rpc" });
      return reply({ error: "Receipt could not be confirmed. Please retry the same request." }, 503);
    }
    if (typeof data !== "string" || !/^[0-9a-f-]{36}$/i.test(data)) {
      logError("public-referrals.intake", new Error("Public referral durable receipt missing"), { failure: "receipt" });
      return reply({ error: "Receipt could not be confirmed. Please retry the same request." }, 503);
    }
    // No contact details, internal IDs, staff identity, or booking claims leave
    // this boundary. Success means the transaction committed to the triage inbox.
    return reply({ received: true }, 200);
  } catch {
    logError("public-referrals.intake", new Error("Public referral server request failed"), { failure: "transport_or_configuration" });
    return reply({ error: "Receipt could not be confirmed. Please retry the same request." }, 503);
  }
}
