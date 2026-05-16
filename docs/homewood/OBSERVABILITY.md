# Homewood Lodge ALF — Observability

Where errors land at launch, who gets notified, and how the smoke-test works.

## Sentry — already wired

The Haven codebase has `@sentry/nextjs@^10.47.0` installed and configured before this sprint started. Sprint 4's observability work confirms the wiring is launch-ready and documents the contract.

### Config files (all at repo root)

| File | Purpose |
|---|---|
| `instrumentation-client.ts` | Browser-side Sentry init. Replaces the legacy `sentry.client.config.ts` per Next 15+ convention. Reads `NEXT_PUBLIC_SENTRY_DSN`. |
| `sentry.server.config.ts` | Node-server-side init. Reads `SENTRY_DSN`. |
| `sentry.edge.config.ts` | Edge-runtime init for middleware + edge routes. Reads `SENTRY_DSN`. |
| `next.config.ts` (`withSentryConfig`) | Wraps the Next.js config for source-map upload on production build. Reads `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`. |
| `src/app/global-error.tsx` | Root error boundary; calls `Sentry.captureException` and renders a recovery UI. |

### Environment variables

Documented in `.env.example`. To enable error tracking in any environment, set:

- `NEXT_PUBLIC_SENTRY_DSN` — browser DSN (public).
- `SENTRY_DSN` — server/edge DSN (often identical to the public DSN).
- `SENTRY_AUTH_TOKEN` — required for source-map upload on prod build (not browser-exposed).
- `SENTRY_ORG`, `SENTRY_PROJECT` — for source-map upload target.

If DSNs are unset, Sentry's `Sentry.init()` is skipped — the app continues to function with no telemetry.

### PII scrubbing — `beforeSend`

Every event passes through a `beforeSend` hook in each init file:

```ts
beforeSend(event) {
  if (event.user) {
    event.user = { id: event.user.id };  // strip email/full_name from user payload
  }
  if (event.request?.headers) {
    delete event.request.headers.authorization;
    delete event.request.headers.cookie;
  }
  return event;
}
```

This guarantees:

- `event.user.email`, `event.user.full_name`, `event.user.ip_address` are NOT sent
- `Authorization` and `Cookie` headers are NOT sent
- Default-PII is off (`sendDefaultPii: false`)

**What is NOT yet scrubbed** (post-launch hardening backlog): inline resident names that appear in URL path segments (e.g. `/admin/residents/<uuid>`) reach Sentry as `event.request.url`. The UUID is opaque; safe. Free-text fields the user typed (which may contain PII) reach Sentry via breadcrumbs when the user filled a form before crashing — Sentry's default breadcrumb config does NOT capture form values, so this is acceptable for launch. Re-audit before enabling Session Replay.

### Smoke test

`scripts/agent-gates/sentry-smoke.mjs` (existing) triggers a controlled error and confirms the Sentry event appears in the dashboard. For Sprint 4's observability check:

```bash
# 1. Ensure SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN are set in .env.local
# 2. Run the smoke
npm run smoke:sentry
# 3. Confirm the event in Sentry → blackrockai / javascript-nextjs-col project
```

The smoke event uses message `homewood-launch-sentry-smoke-test` so it's easy to filter and silence after launch.

### Where errors land

- **Org:** `blackrockai` (from `.env.local`)
- **Project:** `javascript-nextjs-col` (from `.env.local`)
- **Project ID:** `4511196343959552`
- **Web UI:** https://blackrockai.sentry.io/issues/?project=4511196343959552

### Who gets notified

Sentry alert routing is configured in the Sentry web UI per project; not in code. The launch runbook (Sprint 6) lists the on-call rotation.

## Out of scope for launch

These are post-launch hardening items, intentionally deferred per the brief:

- Performance monitoring (`tracesSampleRate` stays at `0`)
- Session replay
- Custom breadcrumb filtering beyond auth/cookie scrubbing
- Sentry Cron monitors for the daily edge functions
