# Observability spec (Track B2)

**Purpose:** Define the minimum observability surface for Haven before calling shipped modules "operationally ready." This is not a full APM rollout — it's the first confidence layer beyond `segment:gates`.

---

## 1. Error tracking (Next.js app)

### Recommendation

Integrate one client + server error capture tool. Sentry is the default recommendation for Next.js; alternatives (LogRocket, Datadog RUM, etc.) are acceptable if they meet the same contract.

### Integration contract

| Layer | What to capture | Env var |
|-------|-----------------|---------|
| Client (browser) | Unhandled exceptions, React error boundaries, failed fetches | `NEXT_PUBLIC_SENTRY_DSN` (or equivalent) |
| Server (API routes, middleware) | Uncaught throws, Supabase client errors, auth failures | `SENTRY_DSN` (server-only, never exposed to client bundle) |

### Setup checklist

- [x] Add SDK dependency (e.g. `@sentry/nextjs`).
- [x] Add DSN env vars to `.env.example` (placeholder only, no real keys committed).
- [x] Configure root Sentry files (`instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) and wrap `next.config.ts` with `withSentryConfig`.
- [ ] Verify errors appear in dashboard after a deliberate test throw.
- [ ] Confirm source maps upload is configured for production builds (requires Netlify env + `SENTRY_AUTH_TOKEN` / org / project).
- [ ] Document in this file when setup is complete.

### What NOT to send

- No PHI in error payloads (resident names, medication details, financial amounts).
- Strip or redact `user.email` if sending user context — use `user.id` only unless BAA covers the provider.
- No Supabase service-role keys in breadcrumbs or tags.

---

## 2. Edge Function observability

### Where to look

Supabase provides built-in logging for Edge Functions:

| What | Where in dashboard |
|------|--------------------|
| Function invocation logs | **Edge Functions → Logs** (per function) |
| HTTP status codes | Same logs view; filter by status |
| Execution duration | Same logs view |
| Errors / stack traces | Expand individual log entries |

### Structured log contract for new functions

When writing or updating Edge Functions, use this JSON shape for `console.log` / `console.error`:

```json
{
  "fn": "generate-monthly-invoices",
  "event": "facility_complete",
  "facility_id": "<uuid>",
  "outcome": "success|blocked|error",
  "invoices_created": 5,
  "elapsed_ms": 342
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `fn` | yes | Function slug for filtering |
| `event` | yes | Lifecycle stage (e.g. `start`, `facility_complete`, `org_complete`, `error`) |
| `outcome` | on completion events | `success`, `blocked`, `error` |
| `elapsed_ms` | recommended | Execution time for the unit of work |
| error fields | on `error` events | `error_message`, `error_code` if available |

Existing functions (`export-audit-log`, `dispatch-push`, `generate-monthly-invoices`, `exec-kpi-snapshot`) should adopt this shape incrementally — do not block deployment on log format.

### Alerting (minimum)

- **Who gets notified** if a cron function returns `error` outcomes: record in [PHASE1-OPS-VERIFICATION-RUNBOOK.md](./PHASE1-OPS-VERIFICATION-RUNBOOK.md) cron ownership table.
- **How:** Supabase log alerts (if available on plan), or external scheduler retry + email on non-200 response.

---

## 3. Cron and job visibility

| Job | How to verify last success | Where |
|-----|---------------------------|-------|
| `generate-monthly-invoices` | Query `invoices` for latest `period_start` matching expected month | SQL Editor or admin UI `/admin/billing/invoices` |
| `exec-kpi-snapshot` | Query `exec_kpi_snapshots` for latest `snapshot_date` | SQL Editor or `/admin/executive` KPI tiles show delta vs last snapshot |
| `dispatch-push` | Check `notification_subscriptions` + Supabase function logs | Dashboard logs |

### Monthly review checklist

- [ ] Invoice generation ran for the expected month (check `invoices` table or admin UI).
- [ ] KPI snapshot has rows for yesterday (check `exec_kpi_snapshots` or executive dashboard).
- [ ] No `error` outcomes in Edge Function logs for the past 30 days.
- [ ] Error tracking dashboard (Sentry or equivalent) has no unresolved P0/P1 issues.

---

## 4. Application health signals

| Signal | How to check | Automated |
|--------|-------------|-----------|
| App reachable + login renders | `npm run demo:web-health` | yes |
| Auth guard redirects work | `npm run demo:web-health` (14 route probes) | yes |
| Invalid credentials error shown | `npm run demo:auth-smoke` | yes |
| Target project auth status | `npm run demo:auth-check` | yes |
| Migration + function + auth summary | `npm run demo:ops-status` | yes |
| All local checks bundled | `npm run demo:pilot-readiness` | yes |

---

## 5. What this spec does NOT cover (future)

- Full APM / distributed tracing across Edge Functions and Next.js.
- Real-time dashboards for SLOs (uptime, p95 latency).
- Log aggregation pipeline (e.g. Datadog, Grafana Cloud).
- Automated alerting beyond cron failure notification.

These are **Track B2 Enhanced** or **post-pilot** scope.

---

## Implementation status

| Item | Status |
|------|--------|
| Error tracking SDK integrated | **DONE (code)** — `@sentry/nextjs`, root config files, CSP host allowlist, and error boundary capture are wired; real DSN/env verification still pending |
| Edge Function log shape adopted | ☐ Not started (existing functions work without it) |
| Cron monthly review checklist | ☐ Ready to use (manual) |
| Application health scripts | **DONE** — `web-health`, `auth-smoke`, `auth-check`, `ops-status`, `pilot-readiness` |

## Manual completion steps (owner / ops)

- Set `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` in Netlify for the app.
- Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` only if source map upload is desired.
- Trigger one deliberate client error and one server/API error, then confirm both appear in Sentry without PHI fields.
