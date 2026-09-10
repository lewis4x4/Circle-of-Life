/**
 * Legacy escalation transport is closed until COL-152 supplies an atomic,
 * current-recipient delivery command. Prior implementation remains in Git.
 */
import { jsonResponse, getCorsHeaders } from "../_shared/cors.ts";

Deno.serve((req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("OCE_ESCALATION_SCANNER_SECRET") ?? "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  // The old scanner transmitted before committing assignment/audit and used
  // organization-wide service-role recipient lookup. Task RLS cannot protect it.
  return jsonResponse({ error: "Escalation requires current recipient authority" }, 409, origin);
});
