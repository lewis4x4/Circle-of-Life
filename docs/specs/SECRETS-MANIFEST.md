# Secrets Manifest

> **Drift prevention:** Use exact backticked secret names in every row and keep `.env.example`, `AGENTS.md`, `supabase/functions/README.md`, and `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` aligned with this manifest. Add or update CI checks so required rows remain synchronized.

Canonical source of truth for environment variables and secrets used by Circle of Life runtime surfaces.

| Secret | Runtime | Consumer(s) | Required where | Auth header / usage | Rotation cadence | Rotation owner | Verification command | Referenced by |
|---|---|---|---|---|---|---|---|---|
| `EXEC_KPI_SNAPSHOT_SECRET` | Supabase Edge, Next.js server, Netlify, pg_cron/Vault | `exec-kpi-snapshot`, `/api/admin/executive/refresh`, executive refresh pipeline cron | Supabase Edge secrets, Netlify env, Supabase Vault | `x-cron-secret` | Quarterly or on leak | Brian Lewis | `supabase secrets list` | `.env.example`; `AGENTS.md`; `supabase/functions/README.md`; `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` |
| `RESIDENT_SAFETY_SCORER_SECRET` | Supabase Edge, Next.js server, Netlify, pg_cron/Vault | `resident-safety-scorer`, `/api/admin/executive/refresh`, executive refresh pipeline cron | Supabase Edge secrets, Netlify env, Supabase Vault | `x-cron-secret` | Quarterly or on leak | Brian Lewis | `supabase secrets list` | `.env.example`; `AGENTS.md`; `supabase/functions/README.md`; `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` |
| `RISK_NIGHTLY_SCORER_SECRET` | Supabase Edge, Next.js server, Netlify, pg_cron/Vault | `risk-nightly-scorer`, `/api/admin/executive/refresh`, executive refresh pipeline cron | Supabase Edge secrets, Netlify env, Supabase Vault | `x-cron-secret` | Quarterly or on leak | Brian Lewis | `supabase secrets list` | `.env.example`; `AGENTS.md`; `supabase/functions/README.md`; `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions | `.github/workflows/edge-functions-deploy.yml` | GitHub repository secrets | Supabase CLI auth token for deploy/list | Quarterly or on leak | Brian Lewis | GitHub repo settings → Secrets and variables → Actions | `docs/designs/2026-05-24-hygiene-pipeline-plan.md` |
| `SUPABASE_PROJECT_REF` | GitHub Actions | `.github/workflows/edge-functions-deploy.yml` | GitHub repository variables (preferred) or secrets | `--project-ref` CLI target | On project change | Brian Lewis | GitHub repo settings → Secrets and variables → Actions | `docs/designs/2026-05-24-hygiene-pipeline-plan.md` |
| `SUPABASE_URL` | Next.js server | `/api/admin/executive/refresh` and server-side Supabase callers | Local `.env.local`, Netlify env | Base URL for functions and API | On project change | Brian Lewis | Netlify env UI + local `.env.local` check | `.env.example`; `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js server | Server API routes and privileged Supabase clients | Local `.env.local`, Netlify env | Service role `Authorization` for privileged server-side Supabase access | Quarterly or on leak | Brian Lewis | Netlify env UI + local `.env.local` check | `.env.example`; `AGENTS.md`; `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md` |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Next.js browser | Sentry navigation performance traces | Netlify env (optional; defaults to `0.05` in production) | Decimal from `0` to `1`; contains no credential | On observability policy change | Brian Lewis | Inspect a sampled navigation transaction in Sentry | `.env.example`; `instrumentation-client.ts`; `docs/specs/OBSERVABILITY-SPEC.md` |
| `SENTRY_TRACES_SAMPLE_RATE` | Next.js server and edge | Sentry server/edge performance traces | Netlify env (optional; defaults to `0.05` in production) | Decimal from `0` to `1`; contains no credential | On observability policy change | Brian Lewis | Inspect a sampled server transaction in Sentry | `.env.example`; `sentry.server.config.ts`; `sentry.edge.config.ts`; `docs/specs/OBSERVABILITY-SPEC.md` |

### Report schedule execution (September review remediation)

- `REPORT_SCHEDULER_SECRET`: shared secret on the Next.js server and report-scheduler Edge Function.
- `REPORT_SCHEDULER_RUNNER_URL`: Edge-only HTTPS URL to the deployed Next.js `/api/reports/scheduler` endpoint. This is configuration, not a secret.
- Missing configuration fails closed; recurrence is not enabled by source changes alone.
