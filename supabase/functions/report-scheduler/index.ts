/** Cron bridge to the same Next.js report executors used by manual runs. */
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("REPORT_SCHEDULER_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return jsonResponse({ error: "Unauthorized" }, 401);
  const runner = Deno.env.get("REPORT_SCHEDULER_RUNNER_URL");
  if (!runner) return jsonResponse({ error: "Report runner is not configured; no reports were executed." }, 503);
  try {
    const url = new URL(runner);
    if (url.protocol !== "https:" || url.pathname !== "/api/reports/scheduler") return jsonResponse({ error: "Invalid report runner configuration" }, 503);
    const response = await fetch(url, { method: "POST", headers: { "x-cron-secret": secret }, redirect: "error" });
    const result = await response.json();
    return jsonResponse(result, response.status);
  } catch {
    return jsonResponse({ error: "Report runner unavailable. Inspect run history before retrying." }, 503);
  }
});
