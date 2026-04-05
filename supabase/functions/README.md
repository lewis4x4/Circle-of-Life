# Supabase Edge Functions (Haven)

| Function | `verify_jwt` (gateway) | Purpose |
|----------|------------------------|---------|
| `export-audit-log` | yes | `POST { "job_id" }` + user JWT — builds CSV from `audit_log`, updates `audit_log_export_jobs`, returns file + `X-Checksum-SHA256`. |
| `dispatch-push` | no | `POST { "user_id", "title", "body", "url"? }` — Web Push via `notification_subscriptions`. Auth: `Authorization: Bearer` (owner/org_admin, same org) **or** `x-dispatch-secret` matching `DISPATCH_PUSH_SECRET`. |
| `generate-monthly-invoices` | no | `POST { "facility_id", "billing_year", "billing_month" }` — draft invoices for active residents (same logic as admin **Generate**). Auth: **`x-cron-secret`** must equal `GENERATE_MONTHLY_INVOICES_SECRET`. Service role; idempotent per facility + resident + `period_start`. |

## Secrets (dashboard: **Edge Functions → Secrets** or `supabase secrets set`)

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:ops@yourdomain`) — required for `dispatch-push`.
- `DISPATCH_PUSH_SECRET` — optional but recommended for server/cron callers (header `x-dispatch-secret`).
- `GENERATE_MONTHLY_INVOICES_SECRET` — required for `generate-monthly-invoices` (header `x-cron-secret`). Rotate if leaked.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### Scheduling (monthly invoice generation)

Scope is **one facility per invocation** (pass `facility_id` for the site you are billing). Schedule one job per facility (or orchestrate a loop from your runner). Example cron (monthly, 02:00 UTC on the 1st) via Supabase **Edge Functions → Cron** or external HTTP cron:

```bash
curl -sS -X POST "https://<project-ref>.supabase.co/functions/v1/generate-monthly-invoices" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $GENERATE_MONTHLY_INVOICES_SECRET" \
  -d '{"facility_id":"<uuid>","billing_year":2026,"billing_month":4}'
```

Use the target calendar month for `billing_year` / `billing_month` (same semantics as the admin UI month selector).

## Deploy

```bash
supabase functions deploy export-audit-log --project-ref manfqmasfqppukpobpld
supabase functions deploy dispatch-push --project-ref manfqmasfqppukpobpld
supabase functions deploy generate-monthly-invoices --project-ref manfqmasfqppukpobpld
```
