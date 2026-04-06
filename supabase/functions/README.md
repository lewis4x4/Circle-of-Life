# Supabase Edge Functions (Haven)

| Function | `verify_jwt` (gateway) | Purpose |
|----------|------------------------|---------|
| `export-audit-log` | yes | `POST { "job_id" }` + user JWT — builds CSV from `audit_log`, updates `audit_log_export_jobs`, returns file + `X-Checksum-SHA256`. |
| `dispatch-push` | no | `POST { "user_id", "title", "body", "url"? }` — Web Push via `notification_subscriptions`. Auth: `Authorization: Bearer` (owner/org_admin, same org) **or** `x-dispatch-secret` matching `DISPATCH_PUSH_SECRET`. |
| `generate-monthly-invoices` | no | Draft monthly invoices (same logic as admin **Billing → Generate**). Auth: **`x-cron-secret`** = `GENERATE_MONTHLY_INVOICES_SECRET`. Idempotent per facility + resident + `period_start` (migration `071`). |
| `exec-kpi-snapshot` | no | Writes **`exec_kpi_snapshots`** for one org: `organization`, each **`entity`**, each **`facility`** scope (Module 24). Auth: **`x-cron-secret`** = **`EXEC_KPI_SNAPSHOT_SECRET`**. Replaces rows for the same `organization_id` + `snapshot_date`. |

## `exec-kpi-snapshot` — request body

**Auth header:** `x-cron-secret: <EXEC_KPI_SNAPSHOT_SECRET>`  
**Content-Type:** `application/json`

```json
{
  "organization_id": "<uuid>",
  "snapshot_date": "2026-04-06"
}
```

- **`snapshot_date`**: optional; defaults to **UTC calendar date** today (`YYYY-MM-DD`).
- **Idempotency:** deletes existing `exec_kpi_snapshots` for that org + date, then inserts fresh rows (full refresh).

```bash
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/exec-kpi-snapshot" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $EXEC_KPI_SNAPSHOT_SECRET" \
  -d '{"organization_id":"<org-uuid>"}'
```

Schedule **daily** per organization (e.g. 06:00 UTC) alongside Module 24 spec.

## `generate-monthly-invoices` — request body

**Auth header:** `x-cron-secret: <GENERATE_MONTHLY_INVOICES_SECRET>`  
**Content-Type:** `application/json`

### Billing period

- **`billing_year`** and **`billing_month`** (1–12): target calendar month.
- If **both are omitted**, the function uses **`getNextBillingMonth()`** (aligned with admin UI: on/after the 25th local server day, the “next” month is the following calendar month; otherwise current month).
- You cannot send only one of the two; both must be set or both omitted.

### Single facility (one site per call)

```json
{
  "facility_id": "<uuid>",
  "billing_year": 2026,
  "billing_month": 4
}
```

Optional: omit `billing_year` / `billing_month` to use the next billing month rule above.

### Organization (productized multi-site orchestration)

One HTTP call walks **all active facilities** in the organization (name order), sequentially. Each facility uses the same preview + persist path as the admin UI; duplicates are skipped via the unique index (**idempotent retries**).

```json
{
  "organization_id": "<uuid>",
  "billing_year": 2026,
  "billing_month": 4,
  "max_facilities": 100
}
```

- **`max_facilities`**: optional cap per invocation (default **100**, hard max **500**) so very large operators can split work or avoid Edge timeouts. If the org has more active sites than the cap, the response includes **`truncated: true`**; run again or raise the cap.
- Response includes **`facilities[]`** with per-site **`outcome`**: `success` (invoices written or empty preview with no block), `blocked` (e.g. no rate schedule, or all residents already invoiced for the period — same cases as a 422 on single-facility), `error` (unexpected failure).
- Top-level **`ok`** is `true` only when no facility row has `outcome: "error"` (blocked sites do not fail the job).

Do **not** send `facility_id` and `organization_id` together.

## Secrets (dashboard: **Edge Functions → Secrets** or `supabase secrets set`)

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:ops@yourdomain`) — required for `dispatch-push`.
- `DISPATCH_PUSH_SECRET` — optional but recommended for server/cron callers (header `x-dispatch-secret`).
- `GENERATE_MONTHLY_INVOICES_SECRET` — required for `generate-monthly-invoices` (header `x-cron-secret`). Rotate if leaked.
- **`EXEC_KPI_SNAPSHOT_SECRET`** — required for `exec-kpi-snapshot` (header `x-cron-secret`). Rotate if leaked.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### Scheduling (monthly invoice generation)

1. **One cron per organization (recommended):** `POST` with `organization_id` only (and optional explicit month). Supabase **Edge Functions → Cron**, GitHub Actions, or an external scheduler (e.g. monthly 02:00 UTC on the 1st).
2. **One cron per facility (legacy):** `POST` with `facility_id` when you prefer explicit per-site jobs.

Examples:

```bash
# Org-wide, explicit month
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/generate-monthly-invoices" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $GENERATE_MONTHLY_INVOICES_SECRET" \
  -d '{"organization_id":"<org-uuid>","billing_year":2026,"billing_month":4}'
```

```bash
# Org-wide, next billing month (omit year/month)
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/generate-monthly-invoices" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $GENERATE_MONTHLY_INVOICES_SECRET" \
  -d '{"organization_id":"<org-uuid>"}'
```

```bash
# Single facility
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/generate-monthly-invoices" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $GENERATE_MONTHLY_INVOICES_SECRET" \
  -d '{"facility_id":"<facility-uuid>","billing_year":2026,"billing_month":4}'
```

Monitor **`totals`** / **`facilities`** for blocked or error outcomes; fix rate schedules or data issues and re-run — safe due to idempotency.

## Deploy

```bash
supabase functions deploy export-audit-log --project-ref manfqmasfqppukpobpld
supabase functions deploy dispatch-push --project-ref manfqmasfqppukpobpld
supabase functions deploy generate-monthly-invoices --project-ref manfqmasfqppukpobpld
supabase functions deploy exec-kpi-snapshot --project-ref manfqmasfqppukpobpld
```
