# Phase 1 — ops verification runbook

**Purpose:** Provide one repeatable verification flow for the target Supabase project after migration apply, Edge Function deploys, auth remediation, or pre-pilot release checks.

**Target project:** `manfqmasfqppukpobpld`

**Use this when:**

- verifying `supabase db push` / `supabase migration list`
- verifying Edge Function deploy state
- checking whether cron secrets and ownership are documented
- re-running the current auth blocker probes
- collecting evidence for Phase 1 closeout without scattering commands across multiple docs

**Machine-readable snapshot:** `npm run demo:ops-status`

---

## Canonical sequence

Run these in order. Stop when a blocking step fails and record the output.

1. Repo hygiene and build baseline
2. Remote migration parity
3. Edge Function deploy/list verification
4. Secret and cron ownership review
5. Auth diagnostics and local auth smoke
6. Segment gates for the bounded change you just made

For a compact JSON summary of steps 2, 3, and the target-project part of step 5, run:

```bash
npm run demo:ops-status
```

For a **single local pilot-readiness bundle** (chains web-health, auth-smoke, auth-check, ops-status):

```bash
BASE_URL=http://127.0.0.1:3001 npm run demo:pilot-readiness
```

---

## 1. Repo hygiene and build baseline

```bash
npm run lint
npm run build
npm run migrations:verify:pg
npm run check:secrets
npm run audit:ci
```

Expected:

- `build` passes with migrations `001`–`111`
- migration replay passes locally
- no high-severity audit or tracked-secret failures

---

## 2. Remote migration parity

```bash
supabase db push
supabase migration list
```

Expected:

- target project is `manfqmasfqppukpobpld`
- Local / Remote are aligned through `001`–`111`

Record:

- timestamp
- whether `db push` applied anything
- final `migration list` alignment result

`demo:ops-status` captures the current alignment snapshot in JSON.

---

## 3. Edge Function deploy and list verification

Deploy:

```bash
supabase functions deploy export-audit-log --project-ref manfqmasfqppukpobpld
supabase functions deploy dispatch-push --project-ref manfqmasfqppukpobpld
supabase functions deploy generate-monthly-invoices --project-ref manfqmasfqppukpobpld
supabase functions deploy exec-kpi-snapshot --project-ref manfqmasfqppukpobpld
supabase functions deploy report-scheduler --project-ref manfqmasfqppukpobpld
supabase functions deploy ar-aging-check --project-ref manfqmasfqppukpobpld
supabase functions deploy generate-emar-schedule --project-ref manfqmasfqppukpobpld
supabase functions deploy emar-missed-dose-check --project-ref manfqmasfqppukpobpld
supabase functions deploy exec-alert-evaluator --project-ref manfqmasfqppukpobpld
```

Verify:

```bash
supabase functions list --project-ref manfqmasfqppukpobpld
```

Expected:

- all nine functions appear in the list
- deploy output is either success or `No change found`

`demo:ops-status` checks the current `functions list` inventory for required slugs and `ACTIVE` status.

All five functions now emit **structured JSON logs** per `OBSERVABILITY-SPEC.md` §2 via `_shared/structured-log.ts` (`fn`, `event`, `outcome`, `elapsed_ms`).

---

## 4. Secret and cron ownership review

Owner confirms these in Supabase dashboard.

### Edge Function secrets

Required names:

- `GENERATE_MONTHLY_INVOICES_SECRET`
- `EXEC_KPI_SNAPSHOT_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `REPORT_SCHEDULER_SECRET`
- `DISPATCH_PUSH_SECRET` if server or cron callers use secret-based dispatch

### Cron ownership register

| Job | Function | Schedule | Scheduler | Owner | Replay if failed |
|-----|----------|----------|-----------|-------|------------------|
| Monthly invoices | `generate-monthly-invoices` | 1st of month, ~02:00 UTC (per org) | Supabase Edge Cron / GitHub Actions / external | ☐ (record name) | Re-POST with same `organization_id` + explicit `billing_year`/`billing_month`; idempotent via unique index (migration `071`) |
| Daily KPI snapshot | `exec-kpi-snapshot` | Daily ~03:00 UTC (per org) | Supabase Edge Cron / GitHub Actions / external | ☐ (record name) | Re-POST with same `organization_id` + `snapshot_date`; deletes same-day rows before insert |
| Report scheduler | `report-scheduler` | Periodic (daily or custom) | Supabase Edge Cron / GitHub Actions / external | ☐ (record name) | Re-POST; picks up schedules whose `next_run_at` is overdue; safe to rerun |
| Push dispatch | `dispatch-push` | Event-driven (not cron) | Application triggers | N/A | Retry the POST; no state mutation on failure |
| Audit export | `export-audit-log` | On-demand (user-initiated) | Admin UI | N/A | Re-POST with same `job_id`; job row tracks state |

Fill in **Owner** and **Scheduler** columns when crons are configured in the dashboard or CI.

### Secret rotation

| Secret | Used by | Rotation cadence | Rotation owner | How to rotate |
|--------|---------|-----------------|----------------|---------------|
| `GENERATE_MONTHLY_INVOICES_SECRET` | `generate-monthly-invoices` | Quarterly or on leak | ☐ | `supabase secrets set GENERATE_MONTHLY_INVOICES_SECRET=<new>` then update scheduler header |
| `EXEC_KPI_SNAPSHOT_SECRET` | `exec-kpi-snapshot` | Quarterly or on leak | ☐ | `supabase secrets set EXEC_KPI_SNAPSHOT_SECRET=<new>` then update scheduler header |
| `REPORT_SCHEDULER_SECRET` | `report-scheduler` | Quarterly or on leak | ☐ | `supabase secrets set REPORT_SCHEDULER_SECRET=<new>` then update scheduler header |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `dispatch-push` | Rarely (key pair) | ☐ | Regenerate VAPID pair, `supabase secrets set` both, re-subscribe clients |
| `VAPID_SUBJECT` | `dispatch-push` | On domain change | ☐ | `supabase secrets set VAPID_SUBJECT=mailto:<new>` |
| `DISPATCH_PUSH_SECRET` | `dispatch-push` (server callers) | Quarterly or on leak | ☐ | `supabase secrets set DISPATCH_PUSH_SECRET=<new>` then update callers |

**Auto-injected (no rotation needed):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### Edge Function failure triage

| Symptom | Check first | Fix |
|---------|-------------|-----|
| 401 on cron call | Secret mismatch | Compare `x-cron-secret` header value with `supabase secrets list`; re-set if rotated |
| 500 on invoice generation | Rate schedule or data issue | Check response `facilities[].outcome`; fix `blocked` sites (missing rate schedule, already invoiced); re-POST (idempotent) |
| 500 on KPI snapshot | Source module empty | Verify org has at least one facility with census/billing data; check `lineage` in response |
| Function not found | Not deployed | `supabase functions deploy <name> --project-ref manfqmasfqppukpobpld` |
| Timeout | Payload too large | Use `max_facilities` cap for invoice generation; split org if needed |

### Production compliance

Confirm in dashboard / billing / legal workflow:

- Pro plan enabled
- BAA executed before PHI
- PITR enabled

---

## 5. Auth diagnostics and local smoke

### Target-project auth probe

```bash
npm run demo:auth-check
```

Expected (as of 2026-04-09):

- settings endpoint returns `200`
- pilot users sign in successfully (auth resolved; migrations `110`–`111`)

If pilot login fails again (regression), attach:

- `docs/specs/PHASE1-AUTH-DEBUG-HANDOFF.md`
- latest `demo:auth-check` output
- Auth dashboard log evidence

`demo:ops-status` includes the same auth probe verdict in one JSON payload alongside migration and function state.

### Local login-routing smoke

Start the app on a clean local port, then run:

```bash
BASE_URL=http://127.0.0.1:3001 npm run demo:web-health
BASE_URL=http://127.0.0.1:3001 npm run demo:auth-smoke
```

Expected:

- `/login` responds and renders the sign-in screen
- `/admin/residents` redirects to `/login?next=%2Fadmin%2Fresidents`
- `/caregiver` redirects to `/login?next=%2Fcaregiver`
- `/family` redirects to `/login?next=%2Ffamily`
- invalid credentials show `Invalid login credentials`

This smoke supports:

- local route reachability
- `PH1-A02`
- `PH1-A03`

It does **not** replace:

- `PH1-A01`
- `PH1-A04`
- RLS JWT validation

---

## 6. Segment gates

Run for the bounded segment you just changed:

```bash
npm run segment:gates -- --segment "<segment-id>"
```

Add `--ui` when routes, layouts, or visible behavior changed.

Record the JSON artifact under:

```bash
test-results/agent-gates/
```

---

## Failure handling

If migration parity fails:

- stop and capture `supabase migration list`
- do not continue calling the environment aligned

If function deploy/list fails:

- stop and capture the failed function name and exact CLI error
- confirm project ref and secrets before retrying

If `demo:auth-check` still reports `Database error querying schema`:

- do not resume UAT or RLS
- continue with `PHASE1-AUTH-DEBUG-HANDOFF.md`

If local smoke fails:

- confirm you are hitting a fresh local app instance
- record the exact route and visible error

---

## Evidence destinations

- Environment / migration proof: [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md)
- Acceptance closure verdict: [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md)
- Auth escalation packet: [PHASE1-AUTH-DEBUG-HANDOFF.md](./PHASE1-AUTH-DEBUG-HANDOFF.md)
- Real-auth execution: [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)
- RLS matrix: [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md)
- Edge Function request/secret details: [`supabase/functions/README.md`](../../supabase/functions/README.md)
