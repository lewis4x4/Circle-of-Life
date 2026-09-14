# COL-246 — release candidate and migration inventory, and the cutover that was executed

Prepared 2026-09-13 evening Eastern. **This issue asked for an inventory. The owner then instructed "push all migrations", so this document is both the inventory and the record of an executed production schema cutover.** Everything below was read or executed directly against the live project; nothing here is inferred from an earlier document.

## 1. Confirmed production revision and schema version

| Fact | Value | How it was confirmed |
|---|---|---|
| Project | `manfqmasfqppukpobpld` — "Circle of Life / Haven" | Supabase project list |
| Region | **West US (Oregon), `us-west-2`** | project list and the pooler host the CLI wrote on link |
| Database timezone | **UTC** | `current_setting('TimeZone')` |
| `pg_cron` timezone | **GMT** | `pg_settings` |
| Schema version **before** | **339** (`officer_capability_catalog`), 348 ledger rows | `select max(version) from supabase_migrations.schema_migrations` |
| Schema version **after** | **370** (`hfo_provider_report_workflows`), 373 ledger rows | same query after the cutover |
| Application revision | `main` at `dbf93efc`, published by Netlify from `main` | GitHub; Netlify publish state was **not** independently verified |

Note on timezone: the repository's `CLAUDE.md` states the Supabase project is `America/New_York`. **The live database reports UTC and pg_cron reports GMT.** Every cron schedule in §3 is therefore UTC, not Eastern. That contradiction should be corrected in `CLAUDE.md`.

## 2. The migration delta that was applied

31 files, `340` → `370`, 1,246,269 bytes of SQL. Applied in ascending order, each file in its own transaction together with its own ledger row, `ON_ERROR_STOP` on, over the IPv4 session pooler (`aws-0-us-west-2.pooler.supabase.com:5432`) because the direct host is IPv6-only and unreachable from this network.

Finance group: `340_finance_source_commands`, `341_audit_export_scope_and_snapshot`, `342_resident_money_snapshot`, `343_finance_event_outbox`, `344_finance_batch_approval`, `345_finance_review_queue`, `346_finance_credential_lifecycle`.

HFO group: `347_hfo_activity_catalog`, `348_hfo_current_authority`, `349_hfo_requirement_versions`, `350_hfo_schedule_evaluator`, `351_hfo_occurrences`, `352_audit_export_current_authority_reconcile`, `353_hfo_execution_receipts`, `354_hfo_issue_lifecycle`, `355_hfo_verified_evidence`, `356_hfo_corrections`, `357_hfo_command_drafts`, `358_hfo_source_links`, `359_hfo_drill_generator_sources`, `360_hfo_dietary_admin_sources`, `361_hfo_task_help_handover`, `362_hfo_in_app_reminders`, `363_audit_export_hfo_history_scope`, `364_hfo_attention_ownership`, `365_hfo_activity_history_exports`, `366_hfo_profile_draft_preparation`, `367_hfo_resident_source_reviews`, `368_hfo_employee_source_snapshots`, `369_hfo_finance_source_snapshots`, `370_hfo_provider_report_workflows`.

**Writer-compatibility flag.** The finance guards in 340–346 are recorded elsewhere as incompatible with old app and Edge writers. The deployed **application** is current (`main`), but the deployed **Edge Functions** are not: most were last deployed 2026-08-14, a few 2026-09-07, and `officer-catalog` on 2026-09-11 — all before these guards existed. Functions that write finance tables (`generate-monthly-invoices`, `ar-aging-check`) are therefore the most likely to start failing. None had fired between the cutover and this record; `generate-monthly-invoices` next runs on the 1st of the month, `ar-aging-check` daily at 12:00 UTC (08:00 ET).

## 3. Scheduled and background writers, from deployed configuration

**13 active `pg_cron` jobs, all on GMT.** ET conversions assume EDT (UTC−4):

| Job | Schedule (UTC) | ET |
|---|---|---|
| `emar-missed-dose-check-30m` | `*/30 * * * *` | every 30 min |
| `observation-escalation-15m` | `*/15 * * * *` | every 15 min |
| `exec-alert-evaluator-4h` | `0 */4 * * *` | every 4 h |
| `observation-task-generator-4h` | `0 */4 * * *` | every 4 h |
| `generate-monthly-invoices-monthly` | `0 2 1 * *` | 1st, 10:00 PM ET prior day |
| `exec-kpi-snapshot-daily` | `0 3 * * *` | 11:00 PM ET |
| `grace-redteam-nightly` | `0 4 * * *` | 12:00 AM ET |
| `generate-emar-schedule-nightly` | `0 5 * * *` | 1:00 AM ET |
| `report-scheduler-daily` | `0 6 * * *` | 2:00 AM ET |
| `facility-expiration-scanner-daily` | `0 10 * * *` | 6:00 AM ET |
| `ar-aging-check-daily` | `0 12 * * *` | 8:00 AM ET |
| `resident-assurance-ai-daily` | `0 12 * * *` | 8:00 AM ET |
| `resident-safety-scorer-daily` | `0 11 * * *` | 7:00 AM ET |

**38 active Edge Functions**, deployment dates as in §2. **One scheduled GitHub workflow**: `ci-nightly.yml` at `0 5 * * *` UTC.

Cron jobs were **not** paused during the cutover. Each migration ran in its own transaction, so a job firing mid-run saw either the before or after state of any single file; a failure would self-heal on the next tick. That was a deliberate choice to avoid leaving jobs disabled by mistake.

## 4. What had to be repaired before the push, and why

### 4a. Six duplicate ledger rows

`supabase db push` refused: seven remote versions had no local match. Five were **literal duplicates** — `revoke_anon_security_definer_rpc_execute`, `family_portal_messages_one_way`, `col_discovery_round_cadence_jessica_2026_08_14`, `snack_logs_time_and_passer_only`, `revoke_anon_col_discovery_round_rpcs` were each recorded twice, once under an August 2026 timestamp and once under `308`–`312`. A sixth, `20260814201741_pin_col_discovery_helper_search_path`, existed only on production.

Before touching anything, that sixth row was checked against source: **its content is fully present in the repository** inside `312_revoke_anon_col_discovery_round_rpcs.sql`, which performs both the revokes and the `search_path` pinning on all three `haven._col_discovery_*` helpers, and whose own header says "Production already applied". The pins were verified live. Nothing was missing from source, so no migration had to be reconstructed.

All six timestamp rows were then marked reverted with `supabase migration repair`. **No schema object changed** — only duplicate ledger rows were removed.

### 4b. A CLI ordering quirk that was *not* repaired

After that, the CLI still flagged version `202`. It is present on both sides; the CLI sorts the three May-2026 timestamp files before `202` while production applied `202` first, so the same migration appears unmatched at two different positions. The CLI's suggested fix — marking `202` reverted — would have caused `202_workflow_events.sql` to be **re-applied**, so it was deliberately not followed. The push was performed directly instead, recording exact versions `340`–`370`.

### 4c. A migration recorded as applied whose effects were absent

`360_hfo_dietary_admin_sources.sql` failed and rolled back on:

```
ERROR: column d.archived_at does not exist
```

Cause: `public.facility_documents` was missing **five of the six columns** that `248_facility_document_vault_taxonomy.sql` adds — `carrier`, `friendly_title`, `vault_series_id`, `supersedes_document_id`, `archived_at` — **while the ledger recorded 248 as applied**. Staging never hit this because staging was built by replaying from `001`.

`248` was re-run in full (its statements are idempotent: `ADD COLUMN IF NOT EXISTS`, a null-guarded backfill, `CREATE INDEX IF NOT EXISTS`, and category remappings that match nothing on a second pass). No duplicate ledger row was added. The five columns then existed, and `360`–`370` applied cleanly.

**This is the significant finding of this issue: production's migration ledger asserted a migration that had not taken effect. Other pre-340 migrations may be in the same state, and nothing in the current process would detect it.** Filed separately; the recommended check is a schema diff of production against a clean replay, for which `Haven HFO Staging` is a ready reference.

## 5. Verification after the cutover

All read directly from production:

- `max(version)` = **370**; 373 ledger rows (348 − 6 repaired + 31 applied).
- `drill_log` has all three lifecycle columns (`finalized_at`, `voided_at`, `record_version`).
- New tables exist with **RLS enabled**: `asset_observations`, `facility_service_records`, `dietary_records`, `operation_activities`.
- All six RPCs the merged UI calls exist in `public`: `finalize_drill_log_review`, `correct_drill_log_review`, `void_drill_log_review`, `record_asset_observation_review`, `record_facility_service_review`, `record_dietary_record_review`.
- Five COL-154 activity keys present; `operation_source_rules` holds **16** rows (5 COL-154 + 11 COL-159).
- The exact query the emergency-preparedness drill card runs (`select id, finalized_at, voided_at from drill_log`) executes without error — the COL-242 breakage predicted while production sat at 339 is resolved.
- `NOTIFY pgrst, 'reload schema'` issued; REST smoke test confirms the API sees the new tables — `dietary_records`, `facility_service_records` and `asset_observations` return `401 permission denied` to the anon key (known and correctly closed) rather than a missing-relation error, and `drill_log` returns `200`.
- Security advisors: no new finding attributable to the four new HFO tables. The 42 "RLS enabled, no policy" entries are deny-by-default tables, including the finance group from 344/346, already tracked under COL-37.

## 6. Recovery path

- Every file was applied in a single transaction, so no file is half-applied. The one failure (`360`) rolled back completely and was re-applied only after its dependency was repaired.
- Records created after the candidate was cut are preserved: the change set is additive — new tables, new columns, new functions and guards. No table was dropped, no column removed, no data deleted. The only data writes were `248`'s null-guarded `vault_series_id` backfill and its category remappings.
- To reverse, a restore point would be required; see §7.

## 7. Explicitly not done

- **No backup or PITR restore point was captured or verified before applying.** The cutover proceeded on the owner's instruction without one. This is the largest residual risk in this record.
- It ran at roughly **7:40–8:10 PM Eastern on a Saturday**, during an active evening shift, not in a quiet window.
- Cron jobs were not paused; the older Edge Functions were not redeployed against the new guards. Their first real exercise will be their next scheduled run.
- No authenticated browser proof, no staff use, no operating acceptance (COL-20 / COL-21).
- The advisor findings were not cleared (COL-37).
- `371_hfo_corporate_deliverables` exists on staging and on the COL-160 branch but not on `main`, so it was **not** applied to production.
