# Supabase Edge Functions (Haven)

| Function | `verify_jwt` (gateway) | Purpose |
|----------|------------------------|---------|
| `export-audit-log` | yes | `POST { "job_id" }` + user JWT — builds CSV from `audit_log`, updates `audit_log_export_jobs`, returns file + `X-Checksum-SHA256`. |
| `dispatch-push` | no | `POST { "user_id", "title", "body", "url"? }` — Web Push via `notification_subscriptions`. Auth: `Authorization: Bearer` (owner/org_admin, same org) **or** `x-dispatch-secret` matching `DISPATCH_PUSH_SECRET`. |
| `generate-monthly-invoices` | no | Draft monthly invoices (same logic as admin **Billing → Generate**). Auth: **`x-cron-secret`** = `GENERATE_MONTHLY_INVOICES_SECRET`. Idempotent per facility + resident + `period_start` (migration `071`). |
| `exec-kpi-snapshot` | no | `POST { "organization_id", "snapshot_date"? }` — writes **`exec_kpi_snapshots`** for org, each entity, and each facility (Module 24). Auth: **`x-cron-secret`** = `EXEC_KPI_SNAPSHOT_SECRET`. Deletes same-day rows for that org before insert (idempotent per day). |
| `report-scheduler` | no | `POST` — processes due **`report_schedules`** into **`report_runs`**. Auth: **`x-cron-secret`** = `REPORT_SCHEDULER_SECRET`. |
| `ar-aging-check` | no | `POST` — marks past-due `sent`/`partial` invoices as **`overdue`**. Auth: **`x-cron-secret`** = `AR_AGING_CHECK_SECRET`. |
| `generate-emar-schedule` | no | `POST` — creates future **`emar_records`** for scheduled meds. Auth: **`x-cron-secret`** = `GENERATE_EMAR_SCHEDULE_SECRET`. |
| `emar-missed-dose-check` | no | `POST` — opens **`exec_alerts`** for overdue scheduled eMAR rows. Auth: **`x-cron-secret`** = `EMAR_MISSED_DOSE_SECRET`. |
| `exec-alert-evaluator` | no | `POST { "organization_id" }` — inserts **`exec_alerts`** from live KPI thresholds. Auth: **`x-cron-secret`** = `EXEC_ALERT_EVALUATOR_SECRET`. |
| `process-referral-hl7-inbound` | no | `POST { "organization_id"?, "limit"? }` — minimal **MSH** parse for **`referral_hl7_inbound`** rows in **`pending`** → **`processed`** / **`failed`**; sets **`message_control_id`**, **`trigger_event`**, **`parse_error`**. Does **not** create **`referral_leads`**. Auth: **`x-cron-secret`** = `PROCESS_REFERRAL_HL7_INBOUND_SECRET`. |
| `ingest` | yes | `POST` multipart (`file`, `title`, optional `audience`/`status`) or JSON `{ "document_id" }` re-index. KB ingestion (extract → chunk → embed → **`documents`** / **`chunks`**). Roles: **owner**, **org_admin**, **facility_admin**. Secrets: **`OPENAI_API_KEY`**, **`ANTHROPIC_API_KEY`** (summary). |
| `knowledge-agent` | yes | `POST { "message", "conversation_id"?, "workspace_id"? }` — Claude tool loop + **`retrieve_evidence`** RPC; SSE response. **`workspace_id`** defaults to caller org. Secrets: **`OPENAI_API_KEY`**, **`ANTHROPIC_API_KEY`**. |
| `document-admin` | yes | `POST { "action": "update" \| "delete", "document_id", ... }` — metadata updates or soft-delete + storage remove. Roles: **owner**, **org_admin** only. |

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
- `EXEC_KPI_SNAPSHOT_SECRET` — required for `exec-kpi-snapshot` (header `x-cron-secret`). Rotate if leaked.
- `REPORT_SCHEDULER_SECRET` — required for `report-scheduler`.
- `AR_AGING_CHECK_SECRET` — required for `ar-aging-check`.
- `GENERATE_EMAR_SCHEDULE_SECRET` — required for `generate-emar-schedule`.
- `EMAR_MISSED_DOSE_SECRET` — required for `emar-missed-dose-check`.
- `EXEC_ALERT_EVALUATOR_SECRET` — required for `exec-alert-evaluator`.
- `PROCESS_REFERRAL_HL7_INBOUND_SECRET` — required for `process-referral-hl7-inbound`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

**Knowledge Base (`ingest`, `knowledge-agent`):** set **`OPENAI_API_KEY`** and **`ANTHROPIC_API_KEY`** in **Edge Functions → Secrets** (same names). Apply migrations **`126_knowledge_base.sql`** then **`130_kb_security_and_schema_reconciliation.sql`** (pgvector + KB tables + RPCs). KB RPCs (`retrieve_evidence`, `log_knowledge_gap`, `increment_usage`) are **`EXECUTE` for `service_role` only** — clients must call these via Edge Functions (JWT verified), not direct PostgREST.

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

## `exec-kpi-snapshot` — request body

**Auth header:** `x-cron-secret: <EXEC_KPI_SNAPSHOT_SECRET>`  
**Content-Type:** `application/json`

- **`organization_id`** (required): UUID of the tenant.
- **`snapshot_date`** (optional): `YYYY-MM-DD` in UTC; defaults to **today** UTC.

Writes one **organization** row, one row per **entity**, and one row per **facility** with `metrics`, `lineage`, and `computed_by: edge:exec-kpi-snapshot`.

```bash
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/exec-kpi-snapshot" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $EXEC_KPI_SNAPSHOT_SECRET" \
  -d '{"organization_id":"<org-uuid>"}'
```

Schedule **daily** per org (e.g. Supabase **Edge Functions → Cron** or external scheduler) after `GENERATE_MONTHLY_INVOICES_SECRET` / billing jobs if needed.

## Deploy

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
supabase functions deploy ingest --project-ref manfqmasfqppukpobpld
supabase functions deploy knowledge-agent --project-ref manfqmasfqppukpobpld
supabase functions deploy document-admin --project-ref manfqmasfqppukpobpld
```
