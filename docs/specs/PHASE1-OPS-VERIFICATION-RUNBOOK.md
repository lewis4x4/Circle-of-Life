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

- `build` passes with migrations `001`–`095`
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
- Local / Remote are aligned through `001`–`095`

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
```

Verify:

```bash
supabase functions list --project-ref manfqmasfqppukpobpld
```

Expected:

- all four functions appear in the list
- deploy output is either success or `No change found`

`demo:ops-status` checks the current `functions list` inventory for those four required slugs and `ACTIVE` status.

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
- `DISPATCH_PUSH_SECRET` if server or cron callers use secret-based dispatch

### Cron ownership

Confirm and record:

- who owns `generate-monthly-invoices`
- who owns `exec-kpi-snapshot`
- where each cron is scheduled
- expected schedule
- replay path if a run fails
- secret rotation owner

Minimum expected schedules:

- `generate-monthly-invoices`: monthly per org or facility
- `exec-kpi-snapshot`: daily per org

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

Expected today:

- settings endpoint returns `200`
- pilot users still fail with `Database error querying schema` until the project-level auth issue is fixed

If pilot login still fails, attach:

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
