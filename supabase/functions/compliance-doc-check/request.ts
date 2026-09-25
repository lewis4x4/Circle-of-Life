import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

import { INTAKE_REQUIRED } from "./legacy-policy.ts";

/**
 * Deliberately no provider/database dependency or request-body read. Reopening
 * requires stored source binding, authenticated first-hop sender identity, and
 * the sender's complete open-obligation PHI gate from the authorized shared
 * engine. Client assertions and category allowlists cannot establish these.
 */
export function handleComplianceRequest(req: Request, secret: string | undefined): Response {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return jsonResponse(INTAKE_REQUIRED, 409);
}
