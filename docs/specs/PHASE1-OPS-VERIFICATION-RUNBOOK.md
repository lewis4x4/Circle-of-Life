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

To append **Playwright** authenticated smoke (**`demo:auth-smoke:real`** — four pilot roles; supports **PH1-A04** / **PH1-P04** evidence), set:

```bash
BASE_URL=http://127.0.0.1:3001 PILOT_READINESS_AUTH_SMOKE_REAL=1 npm run demo:pilot-readiness
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

- `build` passes with migrations `001`–`120`
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

### UI-V2 W0 deploy — 2026-04-25

| Field | Value |
|---|---|
| Project ref | `manfqmasfqppukpobpld` |
| CLI version | `supabase` v2.84.2 |
| Branch | `ui-v2` (head `99ff273`) |
| Migrations applied | `207_user_dashboard_preferences`, `208_facility_metric_targets`, `209_alert_audit_log`, `210_rollback_ui_v2` |
| Pre-state remote | `001`–`206` aligned |
| Post-state remote | `001`–`210` aligned with local |
| Apply method | `supabase db push --linked --include-all --yes` |
| Anomalies | NOTICE on 208: trigger `tr_facility_metric_targets_set_updated_at` did not exist (DROP IF EXISTS no-op) — expected on first apply |
| Verification | RLS enabled on all 3 tables; policy counts: `user_dashboard_preferences`=4 (CRUD), `facility_metric_targets`=3 (no DELETE — soft-delete via `deleted_at`), `alert_audit_log`=2 (immutable — INSERT+SELECT only). Zero rows post-apply. |
| Advisor | MCP `get_advisors` blocked (integration scoped to a different account); manual SQL advisor-equivalent: every new table has `relrowsecurity=true` AND `policy_count > 0` |
| Outstanding | A5 (Pro/BAA/PITR) not yet confirmed by owner — these tables hold no PHI, but any PHI-bearing migration in later modules will require A5 sign-off before push. |

### UI-V2 S8.5 view deploy — 2026-04-25

| Field | Value |
|---|---|
| Project ref | `manfqmasfqppukpobpld` |
| Branch | `ui-v2` |
| Migrations applied | `211_v2_facility_rollup_view` |
| Pre-state remote | `001`–`210` aligned |
| Post-state remote | `001`–`211` aligned with local |
| Apply method | `supabase db push --linked --include-all --yes` |
| Verification | `SELECT * FROM haven.vw_v2_facility_rollup` returns 6 rows; `open_incidents_count` populated from `public.incidents` (Oakridge=7, others=0); `risk_score` populated for 5 of 6 facilities from `public.risk_score_snapshots`; `occupancy_pct` / `survey_readiness_pct` NULL where source aggregates not yet wired (occupancy column unpopulated; summary_json missing the field) |
| Security model | View defined `WITH (security_invoker = true)` so RLS cascades from underlying tables — view does not re-filter |
| Outstanding | Source aggregates for `occupancy_pct` (facilities table column unpopulated) + `survey_readiness_pct` (Module 24 owns `summary_json` shape) + `labor_cost_pct` (payroll/finance module). UI renders NULL as "—". |

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

### Edge Function secrets — ✅ confirmed set (2026-04-10)

All required secrets verified via `supabase secrets list`:

- `GENERATE_MONTHLY_INVOICES_SECRET` ✅
- `EXEC_KPI_SNAPSHOT_SECRET` ✅
- `REPORT_SCHEDULER_SECRET` ✅
- `AR_AGING_CHECK_SECRET` ✅
- `GENERATE_EMAR_SCHEDULE_SECRET` ✅
- `EMAR_MISSED_DOSE_SECRET` ✅
- `EXEC_ALERT_EVALUATOR_SECRET` ✅
- `PROCESS_REFERRAL_HL7_INBOUND_SECRET` ✅
- `DISPATCH_PUSH_SECRET` ✅
- `VAPID_PUBLIC_KEY` ✅
- `VAPID_PRIVATE_KEY` ✅
- `VAPID_SUBJECT` ✅
- `SENTRY_DSN` ✅ (B2 observability)
- `SENTRY_ORG` ✅
- `SENTRY_PROJECT` ✅

### Cron ownership register — ✅ all registered (2026-04-10)

Verified via `SELECT jobid, schedule, command, active FROM cron.job;` — all `pg_cron` jobs active on project `manfqmasfqppukpobpld`.

| Job | Function | Schedule (UTC) | Scheduler | Owner | `pg_cron` jobid | Replay if failed |
|-----|----------|----------------|-----------|-------|-----------------|------------------|
| AR aging | `ar-aging-check` | `0 12 * * *` (daily 12:00) | pg_cron + pg_net | Brian Lewis | 1 | Re-POST; idempotent (status flip only) |
| eMAR schedule | `generate-emar-schedule` | `0 5 * * *` (daily 05:00) | pg_cron + pg_net | Brian Lewis | 2 | Re-POST; skips existing rows |
| Missed-dose alerts | `emar-missed-dose-check` | `*/30 * * * *` (every 30 min) | pg_cron + pg_net | Brian Lewis | 3 | Re-POST; dedupes via `deep_link_path` |
| Daily KPI snapshot | `exec-kpi-snapshot` | `0 3 * * *` (daily 03:00) | pg_cron + pg_net | Brian Lewis | 4 | Re-POST with same `organization_id` + `snapshot_date`; deletes same-day rows before insert |
| Monthly invoices | `generate-monthly-invoices` | `0 2 1 * *` (1st of month 02:00) | pg_cron + pg_net | Brian Lewis | 6 | Re-POST with same `organization_id` + explicit `billing_year`/`billing_month`; idempotent via unique index (migration `071`) |
| Report scheduler | `report-scheduler` | `0 6 * * *` (daily 06:00) | pg_cron + pg_net | Brian Lewis | 10 | Re-POST; picks up schedules whose `next_run_at` is overdue; safe to rerun |
| Executive alerts | `exec-alert-evaluator` | `30 3 * * *` (daily 03:30) | pg_cron + pg_net | Brian Lewis | 11 | Re-POST; dedupes on unresolved title + facility |
| Push dispatch | `dispatch-push` | Event-driven (not cron) | Application triggers | N/A | — | Retry the POST; no state mutation on failure |
| Audit export | `export-audit-log` | On-demand (user-initiated) | Admin UI | N/A | — | Re-POST with same `job_id`; job row tracks state |
| HL7 inbound parse | `process-referral-hl7-inbound` | On-demand / as needed | Manual or future cron | N/A | — | Re-POST; processes `pending` rows; safe to rerun |

### Secret rotation

| Secret | Used by | Rotation cadence | Rotation owner | How to rotate |
|--------|---------|-----------------|----------------|---------------|
| `GENERATE_MONTHLY_INVOICES_SECRET` | `generate-monthly-invoices` | Quarterly or on leak | Brian Lewis | `supabase secrets set GENERATE_MONTHLY_INVOICES_SECRET=<new>` then update `cron.job` command (jobid 6) |
| `EXEC_KPI_SNAPSHOT_SECRET` | `exec-kpi-snapshot` | Quarterly or on leak | Brian Lewis | `supabase secrets set EXEC_KPI_SNAPSHOT_SECRET=<new>` then update `cron.job` command (jobid 4) |
| `REPORT_SCHEDULER_SECRET` | `report-scheduler` | Quarterly or on leak | Brian Lewis | `supabase secrets set REPORT_SCHEDULER_SECRET=<new>` then update `cron.job` command (jobid 10) |
| `AR_AGING_CHECK_SECRET` | `ar-aging-check` | Quarterly or on leak | Brian Lewis | `supabase secrets set AR_AGING_CHECK_SECRET=<new>` then update `cron.job` command (jobid 1) |
| `GENERATE_EMAR_SCHEDULE_SECRET` | `generate-emar-schedule` | Quarterly or on leak | Brian Lewis | `supabase secrets set GENERATE_EMAR_SCHEDULE_SECRET=<new>` then update `cron.job` command (jobid 2) |
| `EMAR_MISSED_DOSE_SECRET` | `emar-missed-dose-check` | Quarterly or on leak | Brian Lewis | `supabase secrets set EMAR_MISSED_DOSE_SECRET=<new>` then update `cron.job` command (jobid 3) |
| `EXEC_ALERT_EVALUATOR_SECRET` | `exec-alert-evaluator` | Quarterly or on leak | Brian Lewis | `supabase secrets set EXEC_ALERT_EVALUATOR_SECRET=<new>` then update `cron.job` command (jobid 11) |
| `PROCESS_REFERRAL_HL7_INBOUND_SECRET` | `process-referral-hl7-inbound` | Quarterly or on leak | Brian Lewis | `supabase secrets set PROCESS_REFERRAL_HL7_INBOUND_SECRET=<new>` (no cron to update) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `dispatch-push` | Rarely (key pair) | Brian Lewis | Regenerate VAPID pair, `supabase secrets set` both, re-subscribe clients |
| `VAPID_SUBJECT` | `dispatch-push` | On domain change | Brian Lewis | `supabase secrets set VAPID_SUBJECT=mailto:<new>` |
| `DISPATCH_PUSH_SECRET` | `dispatch-push` (server callers) | Quarterly or on leak | Brian Lewis | `supabase secrets set DISPATCH_PUSH_SECRET=<new>` then update callers |

**Auto-injected (no rotation needed):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

**Note on rotation:** Cron secrets are embedded in `cron.job.command` text. After rotating a secret via `supabase secrets set`, also update the corresponding `cron.job` row: `SELECT cron.alter_job(<jobid>, command := '<updated SQL with new secret>');`

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
