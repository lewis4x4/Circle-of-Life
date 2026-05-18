# P0 — Billing data pipeline: org AR shows $0 with active census

## Symptoms

Org-scoped Billing & AR Overview shows `$0` / empty ledger despite facilities with resident census and configured rate schedules (e.g. Homewood Lodge).

## Questions (trace Homewood Lodge end-to-end)

1. Does admission create `invoices` rows (first statement) or only drafts?
2. Are `rate_schedule_versions` / resident rate links applied when billing runs?
3. Is scheduled invoice generation deployed (cron / Edge / queue) or still manual-only?
4. Does RLS exclude org-wide reads when facility filter is absent (explain empty ledger under org scope)?
5. Are `payments` posted and tied to invoices via FK expectations?

## Suggested trace

Resident admitted → billing rules → invoice insert → ledger query under `facility_id IS NULL` (org scope) vs per-facility.

## Acceptance

Identify the first broken hop; open a scoped fix segment (migration, Edge, or onboarding hook) separate from Quiet Operator billing UI polish.
