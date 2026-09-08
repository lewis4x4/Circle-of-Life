# Payroll-release HTTP 500 investigation

Mission alignment: pass for evidence gathering; release health is not declared fully resolved.

## Current conclusion

The three original HTTP 500s remain real but their exact cause is unconfirmed. Source/control-flow and historical logs point toward delivery infrastructure or runtime before application handling. No application defect has been reproduced, so no speculative code fix or redeploy was performed. The necessary next evidence is Netlify Observability's per-request detail for the original timestamps; the browser is awaiting user sign-in.

## Evidence

- Production still publishes Netlify deploy `6aa028b2a2a7920008189a1d`, source `adb5ecb954e901610637fcd4b792ab2753d5c018`.
- Original failures (UTC 2026-09-08): `/` at 15:54:50.639 and 15:57:14.728; unauthenticated `/api/rounding/tasks` at 15:57:18.176. Original monitor retained statuses and timestamps, but no response bodies or Netlify request IDs.
- Forty fresh comparisons covered production `/`, `/login`, unauthenticated `/api/rounding/tasks`, and the immutable deployed homepage. Twenty more requests used Python urllib's original default user agent. All 60 returned expected statuses. Diagnostic responses now retain headers/request IDs and would retain failure bodies. Some successful API responses took about 12 seconds; this latency alone does not explain the 500s.
- Historical server-handler logs from 15:50–16:00 UTC contain nine INFO execution reports, no application exception, timeout report, or out-of-memory report. Reported memory was 308–326MB within the 1024 MB function allocation. No report correlates with the failed API request; this narrows investigation but does not prove where it failed. Edge function log query returned zero entries.
- Both live homepage and login responses show prerender headers and Netlify Durable cache hits. Their cached content dates back to the initial release checks. Local prerender manifest independently marks both pages static.

## Source trace

- `src/proxy.ts:126`: `/`, `/login`, and `/api/*` are outside the authentication-shell proxy matcher.
- `src/app/page.tsx:1`: homepage presentation has no database query or server fetch.
- `src/app/api/rounding/tasks/route.ts:53` → `src/lib/rounding/auth.ts:76` → `src/lib/auth/current-api-actor.ts:117`: an anonymous request exits 401 before querying profiles or tasks.
- Installed Auth SDK returns missing-session locally before calling its user endpoint when no cookie/session exists. Payroll SQL is not on these requests' execution path.
- Server/edge Sentry configuration files exist, but local instrumentation manifest is null and there is no source instrumentation register file. This is an observability gap, not demonstrated causation of the 500s. Production logger suppresses console and forwards handled errors to Sentry; Sentry read access was unavailable.

## Provider evidence and remaining action

Historical logs were retrieved through the analytics endpoint used by official Netlify CLI 27.5.0. The installed CLI 24.11.1 supports live streaming only; its global installation was left unchanged. The provider status page reported no incident on September 8, which cannot exclude a site-specific or unreported infrastructure failure.

[Netlify log reference](https://cli.netlify.com/commands/logs/) documents historical log retrieval. [Netlify Observability](https://docs.netlify.com/manage/monitoring/observability/overview/) documents per-request detail and states that programmatic observability access is unavailable. [Provider status](https://www.netlifystatus.com/) is a separate broad service signal.

After Netlify sign-in, inspect the three requests by timestamp/path, expand details and record their request IDs, region, cache outcome, and origin/function error. If those details establish a platform failure, prepare an evidence-backed support request for owner authorization before sending. If they identify application execution, reproduce that exception and implement the smallest verified fix. No support message has been sent.

Machine-readable findings: `HTTP-500-INVESTIGATION.json`. Raw logs and diagnostic headers are retained in the private run root recorded there. No customer records or credentials are included in repository evidence.
