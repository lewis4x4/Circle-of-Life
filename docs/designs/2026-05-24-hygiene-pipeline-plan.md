# Hygiene + CI/CD pipeline plan — 2026-05-24

**Scope:** small, high-leverage hardening only: secrets documentation, Supabase Edge Function deploy automation, Executive Overview copy hygiene, refresh-route completeness, and nightly executive-pipeline automation.

**Out of scope:** conversation threads, profile menu UX, profile menu diagnosis, or Haven Insight UI feature work. `haven-ai-router` still needs the manual deploy already called out separately:

```bash
supabase functions deploy haven-ai-router --project-ref manfqmasfqppukpobpld
```

## Executive recommendation

Ship this as three tightly bounded changesets:

1. **Docs + manifest:** introduce one secrets source of truth and patch the current `RESIDENT_SAFETY_SCORER_SECRET` / `RISK_NIGHTLY_SCORER_SECRET` drift.
2. **Refresh + UI copy:** wire `risk-nightly-scorer` into the manual Executive refresh route and make the onboarding shortcuts honest operational links.
3. **Automation:** add changed-function Edge deploy CI and a scheduled executive pipeline.

The engineering bar should be “operator-grade”: deterministic env ownership, failure-visible deploys, no silent cron drift, and UI language that teaches the user what a link actually does.

---

## 1. Close the env var documentation gap

### 1.1 Files to update and canonical insertion points

#### `.env.example`

**Current anchor:** the `# Supabase Edge Functions — set in Dashboard → Edge Functions → Secrets` block starts after `NEXT_PUBLIC_DEMO_MODE` and already lists `EXEC_KPI_SNAPSHOT_SECRET` but not resident safety or risk nightly.

**Canonical insert position:** immediately after the existing `EXEC_KPI_SNAPSHOT_SECRET` lines and before `DISPATCH_PUSH_SECRET`.

**Recommended replacement block:**

```dotenv
# Executive intelligence refresh pipeline (manual refresh route + cron callers; header x-cron-secret).
# Set these in Supabase Dashboard → Edge Functions → Secrets and in Netlify env for the Next.js refresh route.
# EXEC_KPI_SNAPSHOT_SECRET=your_long_random_secret_here
# RESIDENT_SAFETY_SCORER_SECRET=your_long_random_secret_here
# RISK_NIGHTLY_SCORER_SECRET=your_long_random_secret_here
```

**Order rule:** keep executive refresh secrets together in execution order:

1. `EXEC_KPI_SNAPSHOT_SECRET`
2. `RESIDENT_SAFETY_SCORER_SECRET`
3. `RISK_NIGHTLY_SCORER_SECRET`
4. `EXEC_ALERT_EVALUATOR_SECRET` remains in the Track C block because it is alert-threshold evaluation, not the manual refresh chain.

#### `AGENTS.md`

**Current anchor:** `## Environment Variables (never commit values)` contains a short code block ending with `EXEC_KPI_SNAPSHOT_SECRET=`.

**Canonical insert position:** inside that code block, directly after `EXEC_KPI_SNAPSHOT_SECRET=`.

**Patch target:**

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EXEC_KPI_SNAPSHOT_SECRET=
RESIDENT_SAFETY_SCORER_SECRET=
RISK_NIGHTLY_SCORER_SECRET=
```

**Follow-up sentence to add after the code block:**

> The complete environment and Edge Function secret inventory lives in `docs/specs/SECRETS-MANIFEST.md`; keep this quick-start block aligned with that manifest.

#### `supabase/functions/README.md`

**Function inventory table:** already documents `risk-nightly-scorer`; add `resident-safety-scorer` directly after `exec-kpi-snapshot` and before `report-scheduler` / `risk-nightly-scorer`.

```markdown
| `resident-safety-scorer` | no | `POST { "organization_id", "facility_id"? }` — writes `resident_safety_scores` and opens safety-related `exec_alerts` on downward risk-tier transitions. Auth: **`x-cron-secret`** = `RESIDENT_SAFETY_SCORER_SECRET`. |
```

**Secrets list:** insert immediately after `EXEC_KPI_SNAPSHOT_SECRET` and before `REPORT_SCHEDULER_SECRET` / `RISK_NIGHTLY_SCORER_SECRET`.

```markdown
- `RESIDENT_SAFETY_SCORER_SECRET` — required for `resident-safety-scorer` and the Executive Overview manual refresh route.
```

**Scheduling section:** after the `exec-kpi-snapshot` section, add a short `resident-safety-scorer` + `risk-nightly-scorer` section with curl examples and an explicit note that manual refresh calls risk with `notify: false`, while nightly automation calls risk with `notify: true`.

**Deploy command list:** add `resident-safety-scorer` to the `## Deploy` block next to the executive functions. `risk-nightly-scorer` is already present and should remain `--no-verify-jwt` unless `supabase/config.toml` deploy behavior has made the flag redundant in the installed CLI version.

#### `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md`

**Edge deploy/list verification:** in `## 3. Edge Function deploy and list verification`, add `resident-safety-scorer` and `risk-nightly-scorer` to the deploy commands and expected function inventory. The current text says “all nine functions”; update the count rather than leaving stale arithmetic.

**Confirmed-set list:** in `## 4. Secret and cron ownership review` → `### Edge Function secrets — ✅ confirmed set`, insert after `EXEC_KPI_SNAPSHOT_SECRET`:

```markdown
- `RESIDENT_SAFETY_SCORER_SECRET` ✅
- `RISK_NIGHTLY_SCORER_SECRET` ✅
```

If not actually confirmed in Supabase on implementation day, mark them as `⚠️ pending verification` instead of `✅`; do not overclaim.

**Cron ownership register:** add a row after `Daily KPI snapshot` for the scheduled executive pipeline (or split rows if the implementation schedules each function separately). Recommended row:

```markdown
| Executive refresh pipeline | `exec-kpi-snapshot` + `resident-safety-scorer` + `risk-nightly-scorer` | `10 8,9 * * *` with local-hour guard for 04:10 America/New_York | pg_cron + pg_net | Brian Lewis | TBD | Re-POST manually through `/api/admin/executive/refresh`; individual Edge calls are idempotent per function contract. |
```

**Rotation table:** insert after `EXEC_KPI_SNAPSHOT_SECRET`:

```markdown
| `RESIDENT_SAFETY_SCORER_SECRET` | `resident-safety-scorer`, Executive refresh route, executive pipeline cron | Quarterly or on leak | Brian Lewis | `supabase secrets set RESIDENT_SAFETY_SCORER_SECRET=<new>` then update Netlify env and pg_cron/Vault-backed cron secret reference |
| `RISK_NIGHTLY_SCORER_SECRET` | `risk-nightly-scorer`, Executive refresh route, executive pipeline cron | Quarterly or on leak | Brian Lewis | `supabase secrets set RISK_NIGHTLY_SCORER_SECRET=<new>` then update Netlify env and pg_cron/Vault-backed cron secret reference |
```

### 1.2 Add a secrets manifest as source of truth

Create `docs/specs/SECRETS-MANIFEST.md` and treat it as canonical. Other docs should link to it instead of growing independent inventories.

**Minimum schema:**

| Column | Purpose |
|---|---|
| Secret | Exact env/secret name. |
| Runtime | `Next.js server`, `Browser public`, `Supabase Edge`, `GitHub Actions`, `Netlify`, or `pg_cron/Vault`. |
| Consumer(s) | File/function/workflow names that read it. |
| Required where | Local `.env.local`, Netlify env, Supabase Edge secrets, GitHub repo secrets, Supabase Vault. |
| Auth header / usage | e.g. `x-cron-secret`, `Authorization`, OAuth client secret. |
| Rotation cadence | Quarterly, on leak, on provider rotation, rare key-pair rotation. |
| Rotation owner | Named owner. |
| Verification command | e.g. `supabase secrets list`, GitHub repo settings check, Netlify env UI. |
| Referenced by | `.env.example`, `AGENTS.md`, `supabase/functions/README.md`, runbook section. |

**Initial manifest entries required for this task:**

- `EXEC_KPI_SNAPSHOT_SECRET`
- `RESIDENT_SAFETY_SCORER_SECRET`
- `RISK_NIGHTLY_SCORER_SECRET`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF` (prefer GitHub **variable** because project refs are not secret; use secret only if the repo convention requires it)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Drift prevention:** add a follow-up CI check in `scripts/check-env-example.mjs` or a new `scripts/check-secrets-manifest.mjs` that verifies every non-optional manifest row appears in the docs that claim to list secrets. The manifest can stay human-readable Markdown, but each secret row should use exact backticked names so the checker can parse it reliably.

---

## 2. GitHub Action for Supabase Edge Function deploys

### 2.1 Workflow path

Create:

```text
.github/workflows/edge-functions-deploy.yml
```

### 2.2 Trigger design

Use both events, but deploy only from `main`:

- `push` to `main` with `paths: ["supabase/functions/**", "supabase/config.toml"]` — actual deploy.
- `pull_request` with the same paths — dry-run detection + PR summary comment only.

The user-facing trigger is still function-scoped; `supabase/config.toml` is included because it owns `[functions.<name>].verify_jwt` and is deploy-relevant security configuration.

Reason: GitHub cannot comment on a PR from a direct `push` event unless extra PR lookup logic is added. A PR event gives maintainers a pre-merge preview of which functions will deploy; direct main commits skip PR comments and write to `$GITHUB_STEP_SUMMARY`.

### 2.3 Required GitHub configuration

**Secrets:**

- `SUPABASE_ACCESS_TOKEN` — Supabase personal access token with permission to deploy functions for project `manfqmasfqppukpobpld`.

**Variables preferred (secrets acceptable if repo policy wants everything in Secrets):**

- `SUPABASE_PROJECT_REF` = `manfqmasfqppukpobpld`
- optional `SUPABASE_CLI_VERSION` = pinned known-good CLI version, e.g. `2.84.2` from the runbook; update intentionally.

**Automatic:**

- `GITHUB_TOKEN` — used by `actions/github-script` for PR comments; no manual setup.

### 2.4 Detection semantics

Deploy only function directories changed by the diff.

Rules:

1. Direct function file changes deploy that function.
2. `_shared/**` changes deploy only functions that import shared modules, not blindly all 30+ functions.
3. `supabase/config.toml` changes deploy only the functions whose `[functions.<name>]` block changed. If detection cannot confidently map the block, fail with a clear message instead of silently skipping a security config change.
4. Implement config detection with a tiny Python helper in the workflow: `git show "$base:supabase/config.toml"` and `git show "$head:supabase/config.toml"`, regex-parse `[functions.<slug>]` / `[functions."<slug>"]` blocks plus `verify_jwt`, then add slugs whose block changed to the deploy set.
5. If no deployable function is detected, the workflow exits successfully with a clear summary.

### 2.5 Workflow skeleton

```yaml
name: Supabase Edge Functions — changed deploy

on:
  push:
    branches: [main]
    paths:
      - "supabase/functions/**"
      - "supabase/config.toml"
  pull_request:
    paths:
      - "supabase/functions/**"
      - "supabase/config.toml"

permissions:
  contents: read
  pull-requests: write

jobs:
  detect-and-deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF || secrets.SUPABASE_PROJECT_REF }}
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_CLI_VERSION: ${{ vars.SUPABASE_CLI_VERSION || '2.84.2' }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: ${{ env.SUPABASE_CLI_VERSION }}

      - name: Detect changed Edge Functions
        id: detect
        shell: bash
        run: |
          set -euo pipefail

          if [[ "${{ github.event_name }}" == "pull_request" ]]; then
            base="${{ github.event.pull_request.base.sha }}"
            head="${{ github.event.pull_request.head.sha }}"
          else
            base="${{ github.event.before }}"
            head="${{ github.sha }}"
            if [[ "$base" == "0000000000000000000000000000000000000000" ]]; then
              base="${head}^"
            fi
          fi

          git diff --name-only "$base" "$head" > /tmp/changed-files.txt

          direct_functions=$(
            awk -F/ '$1=="supabase" && $2=="functions" && $3 != "_shared" && $3 != "" {print $3}' /tmp/changed-files.txt \
              | sort -u
          )

          shared_changed=false
          if grep -q '^supabase/functions/_shared/' /tmp/changed-files.txt; then
            shared_changed=true
          fi

          dependent_functions=""
          if [[ "$shared_changed" == "true" ]]; then
            # Redeploy functions that reference _shared imports. This preserves correctness
            # without redeploying every function directory on every shared helper edit.
            dependent_functions=$(
              find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name _shared -print0 \
                | while IFS= read -r -d '' dir; do
                    if grep -R -q "\.\./_shared\|/_shared" "$dir"; then basename "$dir"; fi
                  done \
                | sort -u
            )
          fi

          config_functions=""
          if grep -q '^supabase/config.toml$' /tmp/changed-files.txt; then
            config_functions=$(python3 - "$base" "$head" <<'PY'
          import re
          import subprocess
          import sys

          base, head = sys.argv[1], sys.argv[2]
          pattern = re.compile(r'^\[functions\.(?:"([^"]+)"|([^\]]+))\]\s*$', re.M)

          def read_config(ref):
              try:
                  return subprocess.check_output(['git', 'show', f'{ref}:supabase/config.toml'], text=True)
              except subprocess.CalledProcessError:
                  return ''

          def blocks(text):
              matches = list(pattern.finditer(text))
              result = {}
              for index, match in enumerate(matches):
                  name = match.group(1) or match.group(2)
                  start = match.end()
                  end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
                  result[name.strip()] = text[start:end].strip()
              return result

          old = blocks(read_config(base))
          new = blocks(read_config(head))
          changed = sorted(name for name in set(old) | set(new) if old.get(name) != new.get(name))
          print('\n'.join(changed))
          PY
            )
          fi

          functions=$({ printf '%s\n' "$direct_functions"; printf '%s\n' "$dependent_functions"; printf '%s\n' "$config_functions"; } | sed '/^$/d' | sort -u)

          {
            echo 'functions<<EOF'
            printf '%s\n' "$functions"
            echo 'EOF'
            echo "count=$(printf '%s\n' "$functions" | sed '/^$/d' | wc -l | tr -d ' ')"
          } >> "$GITHUB_OUTPUT"

          {
            echo "### Edge Function deploy detection"
            echo
            echo "Diff range: \`$base..$head\`"
            echo
            if [[ -z "$functions" ]]; then
              echo "No deployable function directories changed."
            else
              echo "Functions selected:"
              printf '%s\n' "$functions" | sed 's/^/- `/' | sed 's/$/`/'
            fi
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Validate deploy configuration
        if: github.event_name == 'push' && steps.detect.outputs.count != '0'
        shell: bash
        run: |
          set -euo pipefail
          test -n "${SUPABASE_ACCESS_TOKEN:-}" || { echo "SUPABASE_ACCESS_TOKEN is missing" >&2; exit 1; }
          test -n "${SUPABASE_PROJECT_REF:-}" || { echo "SUPABASE_PROJECT_REF is missing" >&2; exit 1; }

      - name: Deploy changed functions
        if: github.event_name == 'push' && steps.detect.outputs.count != '0'
        shell: bash
        run: |
          set -euo pipefail
          failures=0
          while IFS= read -r fn; do
            [[ -z "$fn" ]] && continue
            echo "::group::Deploy $fn"
            if supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF"; then
              echo "deployed: $fn"
            else
              echo "failed: $fn" >&2
              failures=$((failures + 1))
            fi
            echo "::endgroup::"
          done <<< "${{ steps.detect.outputs.functions }}"

          if [[ "$failures" -gt 0 ]]; then
            echo "$failures Edge Function deploy(s) failed" >&2
            exit 1
          fi

      - name: Comment PR deploy preview
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const functions = `${{ steps.detect.outputs.functions }}`.trim();
            const count = Number(`${{ steps.detect.outputs.count }}`);
            const body = [
              '### Supabase Edge Function deploy preview',
              '',
              count === 0
                ? 'No deployable function directories were detected.'
                : `On merge to \`main\`, this workflow will deploy:\n${functions.split('\n').map((fn) => `- \`${fn}\``).join('\n')}`,
              '',
              '_Direct pushes to main skip PR comments and write the same summary to the workflow step summary._',
            ].join('\n');
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body,
            });
```

### 2.6 Required design comment block in the workflow

Place this above the detection step:

```yaml
# Design:
# - Deploys only changed Supabase Edge Function directories on pushes to main.
# - PRs are dry-run only so reviewers can see which functions would deploy.
# - `_shared` changes redeploy only functions that import shared modules, preserving correctness
#   without redeploying the full Edge Function inventory on every helper edit.
# - `supabase/config.toml` changes deploy functions whose verify_jwt/config block changed.
# - Deployment fails loud: any failed function deploy fails the workflow.
# - Direct main commits have no PR to comment on, so they write to GITHUB_STEP_SUMMARY instead.
```

### 2.7 Quality gates

Add later, but include in the PR acceptance checklist now:

- `supabase functions list --project-ref $SUPABASE_PROJECT_REF` after deployment and include selected functions in summary.
- Optionally smoke-invoke no-JWT cron functions only when safe and payloads are idempotent.
- Add branch protection requiring this workflow for Supabase function PRs once stable.

---

## 3. Rename misleading Executive Overview nav links

### 3.1 File and anchor

File:

```text
src/components/executive/ExecutiveOverviewPageClient.tsx
```

Anchor: `configurationLinks` const inside `ExecutiveEmptyOnboarding` currently starts around line 331.

### 3.2 Copy changes

Current #2 and #3 read as configuration when they are operational destinations.

Recommended labels:

```tsx
{
  title: "Open Smart Rounding hub",
  body: "Review live rounding coverage, assurance signals, and follow-up work. This is an operational dashboard, not a setup step.",
  href: "/admin/rounding",
  cta: "Open hub",
},
{
  title: "Open alert triage queue",
  body: "Work active executive alerts and exceptions after refresh jobs create them. Alert thresholds are configured elsewhere.",
  href: "/admin/executive/alerts",
  cta: "Open triage",
},
```

### 3.3 Section structure recommendation

Move #2 and #3 out of `Configuration` into a new section named **Operational shortcuts**.

Recommended split:

- **Configuration**
  - Executive snapshot settings
  - Facility metric thresholds
- **Operational shortcuts**
  - Open Smart Rounding hub
  - Open alert triage queue

Why: the user was repeatedly misled because the section heading framed operational dashboards as setup/config pages. Renaming labels helps, but separating the mental model prevents recurrence.

### 3.4 Acceptance criteria

- No link href changes required.
- Section copy must explicitly say the operational shortcuts do not generate data or change configuration.
- Run `npm run lint` and a focused visual smoke of `/admin/executive` if doing UI verification.

---

## 4. Wire `risk-nightly-scorer` into the refresh route

### 4.1 Files

- `src/app/api/admin/executive/refresh/route.ts`
- `src/app/api/admin/executive/refresh/route.test.ts`
- `src/components/executive/ExecutiveOverviewPageClient.tsx`
- `.env.example`, `AGENTS.md`, manifest/runbook docs from section 1

### 4.2 Route contract changes

**Current state:** route invokes only:

- `exec-kpi-snapshot`
- `resident-safety-scorer`

**Add:**

- `risk-nightly-scorer`

Update the type union:

```ts
type EdgeRefreshResult = {
  name: "exec-kpi-snapshot" | "resident-safety-scorer" | "risk-nightly-scorer";
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
};
```

Add env read + missing check:

```ts
const riskSecret = process.env.RISK_NIGHTLY_SCORER_SECRET?.trim();
const missing = [
  !supabaseUrl ? "SUPABASE_URL" : null,
  !snapshotSecret ? "EXEC_KPI_SNAPSHOT_SECRET" : null,
  !scorerSecret ? "RESIDENT_SAFETY_SCORER_SECRET" : null,
  !riskSecret ? "RISK_NIGHTLY_SCORER_SECRET" : null,
].filter((value): value is string => Boolean(value));

if (!supabaseUrl || !snapshotSecret || !scorerSecret || !riskSecret) {
  return NextResponse.json(
    { ok: false, error: "Executive refresh is not configured on this server.", missing },
    { status: 503 },
  );
}
```

Invoke in the existing parallel block, but call risk with `notify: false` for manual refresh safety:

```ts
const [snapshot, scorer, risk] = await Promise.all([
  invokeEdgeRefresh({
    name: "exec-kpi-snapshot",
    supabaseUrl: normalizedSupabaseUrl,
    secret: snapshotSecret,
    organizationId,
  }),
  invokeEdgeRefresh({
    name: "resident-safety-scorer",
    supabaseUrl: normalizedSupabaseUrl,
    secret: scorerSecret,
    organizationId,
  }),
  invokeEdgeRefresh({
    name: "risk-nightly-scorer",
    supabaseUrl: normalizedSupabaseUrl,
    secret: riskSecret,
    organizationId,
    body: { organization_id: organizationId, notify: false },
  }),
]);
```

This requires widening `invokeEdgeRefresh` to accept an optional `body` override:

```ts
body?: Record<string, unknown>;
// default body: { organization_id: organizationId }
```

**Why `notify: false` manually:** `risk-nightly-scorer` defaults `notify` to true and can send owner SMS on material high/critical risk. A dashboard refresh button should fill data, not send surprise overnight-style alerts. The nightly schedule can call `notify: true`.

**Ordering note:** this plan keeps the manual route parallel because the requested implementation explicitly called for adding risk to the existing `Promise.all` and the current timeout math depends on parallelism. If verification shows `risk-nightly-scorer` needs freshly written resident safety rows from the same click, change the route to `Promise.all([snapshot, scorer])` first, then invoke risk second with the same client response shape.

Return shape:

```ts
return NextResponse.json({ ok: true, snapshot: snapshotClient, scorer: scorerClient, risk: riskClient });
```

Failure shape:

```ts
return NextResponse.json(
  {
    ok: false,
    error: "Executive refresh did not complete successfully.",
    snapshot: snapshotClient,
    scorer: scorerClient,
    risk: riskClient,
  },
  { status: 502 },
);
```

### 4.3 UI response handling

Update `ExecutiveRefreshState`:

```ts
risk?: ExecutiveRefreshFunctionStatus;
```

Parse:

```ts
const risk = isFunctionStatus(payload?.risk) ? payload.risk : undefined;
```

Set error state with `risk`.

Render failures from an array:

```ts
{[refreshState.snapshot, refreshState.scorer, refreshState.risk].filter(Boolean).map(...)}
```

Catch fallback should include a third status row:

```ts
risk: { name: "risk-nightly-scorer", ok: false, status: 0 }
```

Update the generate-data description:

> Runs the executive KPI snapshot, resident safety scorer, and risk nightly scorer server-side, then refreshes this page.

### 4.4 Tests

Update `route.test.ts`:

- `beforeEach` sets `process.env.RISK_NIGHTLY_SCORER_SECRET = "risk-secret"`.
- Existing failure test should mock three fetches and expect three sanitized rows/logs.
- Add a 503 test for missing `RISK_NIGHTLY_SCORER_SECRET`:
  - delete env var
  - expect `status === 503`
  - expect `missing` includes `RISK_NIGHTLY_SCORER_SECRET`
- Add a success-shape test:
  - all three fetches return 200
  - expect payload keys `snapshot`, `scorer`, `risk`
  - expect risk fetch body contains `notify: false`.

### 4.5 Timeout assessment

Current `maxDuration = 26` is appropriate for Netlify Pro. Because all three functions are invoked in parallel, total elapsed time is approximately the slowest function plus route overhead, not the sum.

Best-practice guardrail: add per-fetch abort timeouts so the route fails before Netlify’s gateway kills it without JSON:

- route budget: 26s
- per-edge timeout: 22s
- leave ~4s for auth/context, response parsing, logging, and JSON response

If risk-nightly regularly approaches 22s for five facilities, graduate to background orchestration rather than raising the timeout again.

---

## 5. Nightly automated refresh

### 5.1 Recommendation: Supabase `pg_cron` + `pg_net`, not Netlify Scheduled Functions

Use Supabase-native scheduling for this pipeline.

Rationale:

- The work is Supabase Edge Function orchestration against Supabase data; scheduling near the data plane is cleaner than routing through Netlify.
- The Phase 1 runbook already uses a `pg_cron + pg_net` ownership model for existing jobs.
- It avoids relying on the web app deployment plane for database freshness.
- The secrets being sent are Edge cron secrets, not user-session credentials.
- The pipeline can be made auditable by recording cron job IDs and `pg_net` request IDs.

Caveat: `pg_net` HTTP calls are asynchronous. The migration should record request IDs and the runbook should include response triage (`net._http_response` / Supabase logs) rather than pretending the SQL function synchronously proves downstream success. If verification proves risk scoring must wait for same-run safety scoring, promote this into a first-class `executive-refresh-pipeline` Edge Function (scheduled by pg_cron with one HTTP call) or split the three jobs into delayed cron entries; do not rely on pg_net request enqueue order as a strict dependency boundary.

### 5.2 Schedule recommendation

Run daily at **04:10 America/New_York**.

Why:

- Early enough for owner morning dashboard review.
- Late enough that late-night clinical/operations data has landed.
- Low interactive traffic.
- Daily is the correct starting cadence for executive rollups; hourly risks noisy alerts and unnecessary Edge load unless operators ask for near-real-time risk.

Because `pg_cron` schedules in UTC and COL is in Florida, use a DST-safe pattern:

```cron
10 8,9 * * *
```

Then guard inside the SQL function:

```sql
if to_char(now() at time zone 'America/New_York', 'HH24') <> '04' then
  return;
end if;
```

This fires at 08:10 UTC and 09:10 UTC, but only the invocation that corresponds to 04:10 local time proceeds.

### 5.3 Migration spec

Create the next migration:

```text
supabase/migrations/274_executive_refresh_pg_cron.sql
```

**Design goals:**

- Do not hardcode secret values in committed SQL.
- Store cron secrets in Supabase Vault or equivalent database-side secret storage.
- Record enough metadata to debug requests.
- Use idempotent `cron.unschedule` / `cron.schedule` pattern so re-apply is safe.

**Migration skeleton:**

```sql
-- 274_executive_refresh_pg_cron.sql

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Supabase Vault should be enabled in the dashboard before applying this migration.
-- Secret values must be inserted out-of-band; do not commit them.

create schema if not exists haven_ops;

create table if not exists haven_ops.executive_refresh_cron_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scheduled_for timestamptz not null default now(),
  local_hour text not null,
  snapshot_request_id bigint,
  resident_safety_request_id bigint,
  risk_request_id bigint,
  created_at timestamptz not null default now()
);

alter table haven_ops.executive_refresh_cron_runs enable row level security;

create or replace function haven_ops.get_vault_secret(secret_name text)
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = secret_name
  limit 1;
$$;

revoke all on function haven_ops.get_vault_secret(text) from public, anon, authenticated;

create or replace function haven_ops.invoke_executive_refresh_pipeline()
returns void
language plpgsql
security definer
set search_path = public, net, haven_ops
as $$
declare
  project_url text := 'https://manfqmasfqppukpobpld.supabase.co';
  col_org_id uuid := '00000000-0000-0000-0000-000000000001';
  local_hour text := to_char(now() at time zone 'America/New_York', 'HH24');
  snapshot_secret text;
  resident_secret text;
  risk_secret text;
  snapshot_request_id bigint;
  resident_request_id bigint;
  risk_request_id bigint;
begin
  -- DST guard: cron runs at 08:10 and 09:10 UTC; only 04:10 local proceeds.
  if local_hour <> '04' then
    return;
  end if;

  snapshot_secret := haven_ops.get_vault_secret('EXEC_KPI_SNAPSHOT_SECRET');
  resident_secret := haven_ops.get_vault_secret('RESIDENT_SAFETY_SCORER_SECRET');
  risk_secret := haven_ops.get_vault_secret('RISK_NIGHTLY_SCORER_SECRET');

  if snapshot_secret is null or resident_secret is null or risk_secret is null then
    raise exception 'Executive refresh cron secrets are not configured in Vault';
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/exec-kpi-snapshot',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', snapshot_secret),
    body := jsonb_build_object('organization_id', col_org_id),
    timeout_milliseconds := 20000
  ) into snapshot_request_id;

  select net.http_post(
    url := project_url || '/functions/v1/resident-safety-scorer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', resident_secret),
    body := jsonb_build_object('organization_id', col_org_id),
    timeout_milliseconds := 20000
  ) into resident_request_id;

  select net.http_post(
    url := project_url || '/functions/v1/risk-nightly-scorer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', risk_secret),
    body := jsonb_build_object('organization_id', col_org_id, 'notify', true),
    timeout_milliseconds := 20000
  ) into risk_request_id;

  insert into haven_ops.executive_refresh_cron_runs (
    organization_id,
    local_hour,
    snapshot_request_id,
    resident_safety_request_id,
    risk_request_id
  ) values (
    col_org_id,
    local_hour,
    snapshot_request_id,
    resident_request_id,
    risk_request_id
  );
end;
$$;

revoke all on function haven_ops.invoke_executive_refresh_pipeline() from public, anon, authenticated;

-- Idempotently replace this job. Exact unschedule syntax may vary by pg_cron version;
-- implementation should test locally/remote before push.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'executive-refresh-pipeline-nightly') then
    perform cron.unschedule('executive-refresh-pipeline-nightly');
  end if;
end
$$;

select cron.schedule(
  'executive-refresh-pipeline-nightly',
  '10 8,9 * * *',
  $$select haven_ops.invoke_executive_refresh_pipeline();$$
);
```

### 5.4 Secret bootstrap commands

After migration/Vault is ready, set database-side secrets out-of-band. Do not commit values.

```sql
-- Run in Supabase SQL editor or via a secure admin session.
-- Use the current production values; examples intentionally omit values.
select vault.create_secret('<EXEC_KPI_SNAPSHOT_SECRET_VALUE>', 'EXEC_KPI_SNAPSHOT_SECRET');
select vault.create_secret('<RESIDENT_SAFETY_SCORER_SECRET_VALUE>', 'RESIDENT_SAFETY_SCORER_SECRET');
select vault.create_secret('<RISK_NIGHTLY_SCORER_SECRET_VALUE>', 'RISK_NIGHTLY_SCORER_SECRET');
```

If Vault is unavailable, fallback is embedding secrets in `cron.job.command`, matching the current runbook note, but that is a lower-grade option and should be documented as technical debt.

### 5.5 Verification

- `supabase db push --linked --include-all --yes`
- `select jobid, jobname, schedule, active from cron.job where jobname = 'executive-refresh-pipeline-nightly';`
- Manually run `select haven_ops.invoke_executive_refresh_pipeline();` during the 04 local hour in staging or temporarily disable the hour guard in a transaction for a one-time test.
- Confirm `haven_ops.executive_refresh_cron_runs` inserts request IDs.
- Check Supabase Edge Function logs for all three functions.
- Confirm `exec_kpi_snapshots`, `resident_safety_scores`, and `risk_score_snapshots` have fresh rows for org `00000000-0000-0000-0000-000000000001`.

---

## 6. Sequencing and deploy plan

### Phase A — Documentation/source-of-truth cleanup

Ship together:

- `docs/specs/SECRETS-MANIFEST.md`
- `.env.example`
- `AGENTS.md`
- `supabase/functions/README.md`
- `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md`

Risk: low. No runtime behavior change.

Verification:

- `npm run check:env-example`
- `npm run check:secrets`
- Markdown review for exact secret spelling.

### Phase B — Refresh route + Executive Overview copy

Ship together:

- `src/app/api/admin/executive/refresh/route.ts`
- `src/app/api/admin/executive/refresh/route.test.ts`
- `src/components/executive/ExecutiveOverviewPageClient.tsx`

Deploy-time ordering:

1. Add `RISK_NIGHTLY_SCORER_SECRET` to Netlify env first.
2. Confirm all three secrets exist in Supabase Edge Function secrets.
3. Deploy web app.
4. Test manual refresh.

Why env first: if the code deploys before Netlify has `RISK_NIGHTLY_SCORER_SECRET`, the refresh route correctly returns 503 and lists the missing secret; that is safe but operator-visible.

Risk: medium. The route response shape adds `risk` but remains additive. The UI should deploy with the route change so failures render clearly.

Verification:

- `npm test -- src/app/api/admin/executive/refresh/route.test.ts`
- `npm run lint`
- Manual authenticated owner refresh on `/admin/executive`
- Confirm no SMS from manual refresh (`notify: false`).

### Phase C — Edge Function deploy workflow

Ship after Phase A so the manifest/runbook already document required GitHub settings.

Risk: medium. First run can fail if `SUPABASE_ACCESS_TOKEN` or project ref is missing; this is desirable loud failure.

Verification:

- Open PR changing a harmless Edge function comment; confirm dry-run comment lists only that function.
- Merge; confirm workflow deploys only selected function(s).
- Confirm direct main commits produce no PR comment and do produce a workflow summary.

### Phase D — Nightly scheduler migration

Ship after Phase B is verified; scheduler should call the same three-function contract the UI route already exercised.

Risk: medium-high because it adds production automation and can send notifications if `notify: true` risk alerts trigger. Validate owner notification expectations before enabling the final cron job if SMS is configured.

Verification:

- Apply migration.
- Bootstrap Vault secrets.
- Temporarily test wrapper in a controlled window.
- Confirm cron register + runbook updated with actual job ID.

### Phase E — Post-deploy evidence

Update the runbook with:

- workflow run URL for first Edge deploy automation pass
- cron job ID
- timestamp of first successful automated run
- latest row counts / timestamps for the three executive artifacts

---

## 7. Effort estimate

| Sub-phase | Work | Estimate | Parallel-safe? |
|---|---:|---:|---|
| A | Secrets manifest + docs drift patches | 1.5–2.5h | Yes, parallel with C design but not with docs reviewer. |
| B | Refresh route + tests + UI failure row | 2–3h | Partially; route/test and UI copy can be split, then integrated. |
| C | Executive Overview section split/copy polish | 0.75–1.25h | Yes, parallel with route work after agreeing on copy. |
| D | Edge Function deploy GitHub Action + PR summary | 2.5–4h | Yes, parallel with B/C; requires GitHub secrets before live validation. |
| E | pg_cron/Vault scheduler migration + runbook evidence | 3–5h | No; do after B proves function contract and secrets. |
| F | End-to-end verification + first-run evidence | 1.5–3h | No; depends on A–E. |

Total: **11–18.75h**, with **4–7h parallel-safe** if two agents split docs/CI/UI.

---

## Final acceptance checklist

- [ ] `RESIDENT_SAFETY_SCORER_SECRET` appears in `.env.example`, `AGENTS.md`, `supabase/functions/README.md`, runbook confirmed-set list, and rotation table.
- [ ] `RISK_NIGHTLY_SCORER_SECRET` appears in `.env.example`, `AGENTS.md`, runbook confirmed-set list, rotation table, and Netlify env requirements.
- [ ] `docs/specs/SECRETS-MANIFEST.md` exists and every touched doc links back to it.
- [ ] `.github/workflows/edge-functions-deploy.yml` deploys changed functions only and fails loud.
- [ ] PRs receive deploy-preview comments; direct main commits skip comments and write step summaries.
- [ ] Executive onboarding separates configuration links from operational shortcuts.
- [ ] Manual refresh invokes `exec-kpi-snapshot`, `resident-safety-scorer`, and `risk-nightly-scorer` with `notify: false` for risk.
- [ ] UI displays a third status row for `risk-nightly-scorer` failures.
- [ ] Nightly automation runs once per local day at 04:10 America/New_York and records request IDs/evidence.
- [ ] Runbook records the actual cron job ID, first successful run timestamp, and rollback/replay instructions.
