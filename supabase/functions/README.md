# Supabase Edge Functions (Haven)

| Function | `verify_jwt` (gateway) | Purpose |
|----------|------------------------|---------|
| `export-audit-log` | yes | `POST { "job_id" }` + user JWT — builds CSV from `audit_log`, updates `audit_log_export_jobs`, returns file + `X-Checksum-SHA256`. |
| `dispatch-push` | no | `POST { "user_id", "title", "body", "url"? }` — Web Push via `notification_subscriptions`. Auth: `Authorization: Bearer` (owner/org_admin, same org) **or** `x-dispatch-secret` matching `DISPATCH_PUSH_SECRET`. |

## Secrets (dashboard: **Edge Functions → Secrets** or `supabase secrets set`)

- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:ops@yourdomain`) — required for `dispatch-push`.
- `DISPATCH_PUSH_SECRET` — optional but recommended for server/cron callers (header `x-dispatch-secret`).

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Deploy

```bash
supabase functions deploy export-audit-log --project-ref manfqmasfqppukpobpld
supabase functions deploy dispatch-push --project-ref manfqmasfqppukpobpld
```
