# Staging integration and hosted Storage proof package (HFO, Finance-first)

Written 2026-09-10 on branch `codex/hfo-col145-corrections`. **This runbook has not been executed.** Nothing in it has been run against any hosted project. It is a concrete, human-executable procedure for (a) applying the Finance and Haven Facility Operations (HFO) migration stacks to a **staging** Supabase project in the recorded Finance-first order and (b) producing the hosted Storage proof that COL-143 acceptance item 3 requires. Every SQL statement and HTTP request is written out; placeholders are in angle brackets and never carry real values.

Source of truth for each fact is named inline (migration file and line, route file, or contract document). Where a fact could not be determined from the repository it is marked **NOT DETERMINED FROM SOURCE** and collected again in Appendix A. Do not fill those gaps by guessing; record what the staging project actually returns.

Sections, in execution order:

1. Preconditions and stop rules
2. Finance-first ordering and renumbering
3. Ledger checks and post-apply schema probe
4. Synthetic fixture
5. Role and site grants
6. Hosted proof: exact HTTP steps (positive path)
7. Negative authorization cases
8. Cleanup
9. Sign-off record

Placeholders used throughout:

| Placeholder | Meaning |
|---|---|
| `<STAGING_REF>` | Project reference of the **staging** Supabase project. Must never equal `manfqmasfqppukpobpld`. |
| `<STAGING_URL>` | `https://<STAGING_REF>.supabase.co` |
| `<ANON_KEY>` | Staging anon (publishable) key. Sent as `apikey` on direct Storage and PostgREST calls. |
| `<SERVICE_ROLE_KEY>` | Staging service-role key. Used only in §4.2 (Auth admin user creation) and §8 (object deletion). Never in a proof log. |
| `<APP_URL>` | The Next.js app running against staging (recommended: `http://localhost:3000` from `npm run dev` on the integration branch with `.env.local` pointed at staging). |
| `<COOKIE_ADMIN>`, `<COOKIE_ASSISTANT>`, `<COOKIE_CORP>`, `<COOKIE_SITEB>` | The `sb-<STAGING_REF>-auth-token` cookie header value for each test user (§6.1). |
| `<ACCESS_TOKEN_ADMIN>` etc. | The Supabase access token (JWT) for each test user, for direct Storage/PostgREST calls. |
| `<ORG_ID>` | The COL organization id on staging: `00000000-0000-0000-0000-000000000001` (required by the 336 seed, `scripts/facility-operations/sync-activity-catalog-seed.ts:23-31`). |
| `<ADMIN_UID>`, `<ASSISTANT_UID>`, `<CORP_UID>`, `<SITEB_UID>` | Auth user ids returned by §4.2. |
| `<VERSION_ID>`, `<CONFIG_ID>`, `<OCC_ID>`, `<RECEIPT_ID>`, `<RECEIPT_REVISION>`, `<EVIDENCE_ID>`, `<OBJECT_PATH>` | Values returned by §4.4 to §6.3. |

Fixed fixture ids (chosen so every later statement can be copied verbatim):

| Fixture | UUID |
|---|---|
| Entity | `00000000-0000-4000-8000-5f0000000001` |
| Site A (`<SITE_A>`) | `00000000-0000-4000-8000-5f0000000002` |
| Site B (`<SITE_B>`, the other site) | `00000000-0000-4000-8000-5f0000000003` |
| Central activity (`<ACTIVITY_ID>`) | `00000000-0000-4000-8000-5f0000000004` |
| Site A facility subject (`<SUBJECT_ID>`) | `00000000-0000-4000-8000-5f0000000005` |

---

## 1. Preconditions and stop rules

### 1.1 Scope boundary

- **Staging only.** The hosted Haven project `manfqmasfqppukpobpld` is production for this purpose and is not touched by any step here. Before every `supabase` CLI command and every SQL editor session, confirm the target (§1.4). If any tool reports `manfqmasfqppukpobpld`, stop.
- **No merge, no deploy.** This procedure applies migrations to staging and runs HTTP calls against an app instance pointed at staging. It does not merge any branch to `main`, does not push to `origin`, does not deploy to Netlify, and does not close or move any Linear issue. COL-143 closes only under §9.
- **No production data movement.** No bytes, rows or exports leave staging except the redacted proof logs under `docs/facility-operations/col143-evidence/hosted-proof/`.
- **Who runs it.** The integrator (owner-authorized) with: the staging project's dashboard access, the staging service-role key held out of band, and a checkout of the integration branch built in §2. A second person reviews §9 before COL-143 is closed.

### 1.2 What must be true before starting

1. **Staging project exists and is separate.** `<STAGING_REF>` is a Supabase project other than `manfqmasfqppukpobpld`. It carries the Haven schema through migration **335** and its ledger reads exactly as in §3.1 (count of numbered versions 335, max `335`). Two ways to get there: (a) a restored backup of the hosted project into a new project (carries real data; then the staging project inherits production access rules and must be treated as such), or (b) a fresh project with `001`–`335` replayed from `main` at `fad17dcc` or later. Either way the COL organization row must exist (`SELECT 1 FROM public.organizations WHERE id='<ORG_ID>'`) or migration 336 (catalog seed) raises `COL organization required for the reviewed Admin Log catalog`.
2. **Auth hook and pre-request guard.** Migration 326 installs `public.haven_custom_access_token_hook` and sets `pgrst.db_pre_request = public.haven_assert_authorized_request` on the `authenticator` role (`326_sys_001_authoritative_actor_state.sql:82,796`). The hook must be **enabled** in the staging dashboard (Authentication → Hooks → Customize Access Token → `public.haven_custom_access_token_hook`). It is not enabled by SQL. Without it, tokens lack `auth_claim_version` and are accepted only while a profile's version is 1 (`326:210-211`); the fixture profiles are fresh so the proof would still run, but the proof would not match production behaviour. Record the hook state in §9.
3. **The integration branch is built and green** (§2): Finance files first, HFO renumbered, seed script constant updated, `npm run migrations:check` passing, native replay passing.
4. **Migration 343 is the amended one.** The checksum amendment (`Haven Facility Evidence/docs/facility-operations/col143-evidence/checksum-contracts.md`) changes 343 in place to require a client `md5` and to verify it against the Storage `eTag`. At the time of writing, `343_hfo_verified_evidence.sql` at `c7b5cc30` in this worktree and in the Evidence worktree **does not yet contain** `declared_md5` (grep returns nothing). Before §6, run `grep -c declared_md5 supabase/migrations/*hfo_verified_evidence.sql` on the integration branch. If it returns `0`, the proof can still be run for ownership, size, mime and eTag observation (§6.6), but §6.7's `checksum_verified: true` and §7.6 (checksum mismatch) **cannot** be exercised; record that in §9 and do not call item 3 complete.
5. **A test PNG and its digests** (§6.3) computed on the operator's machine with the commands given.
6. **The app instance.** On the integration branch: `.env.local` with `NEXT_PUBLIC_SUPABASE_URL=<STAGING_URL>`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>`, the service-role variable the app expects, then `npm run dev`. The routes under `src/app/api/admin/operations/**` authenticate from the Supabase auth **cookie** (`src/lib/supabase/server.ts:5-36` uses `@supabase/ssr` `createServerClient` with the cookie store; `src/lib/auth/current-api-actor.ts:117-124` calls `supabase.auth.getUser()`). They do not read an `Authorization` header. §6.1 explains how to obtain the cookie.

### 1.3 Stop rules (abort conditions)

Stop, record the observation in `hosted-proof/RESULT.md` under "Aborted", and do not continue when:

- any tool or query names project `manfqmasfqppukpobpld`;
- the pre-apply ledger (§3.1) is not exactly through `335`, or contains any version ≥ 336;
- a migration fails to apply: do **not** hand-edit and re-run; the failing file and the error text go into the record, and the integration branch is fixed and re-verified locally first;
- the storage `owner` column is NULL after the signed-URL upload (§6.6): the 343 upload check compares `owner` (`343:392-393`); the recorded fallback is to switch the command to `owner_id` (COL-143-HANDOFF, "Differences between the local stand-in and hosted Storage") and nothing finalizes until that change is reviewed;
- the storage `metadata->>'eTag'` is not the plain MD5 of the uploaded bytes (§6.6): record the format; do not finalize; the checksum amendment names the fallback verifier;
- any negative case in §7 returns a 2xx.

### 1.4 Target confirmation (run before every session)

```bash
# CLI link: must print <STAGING_REF> and must not print manfqmasfqppukpobpld
cat supabase/.temp/project-ref
supabase projects list          # the linked project is marked; check the ref column
```

In the SQL editor, first statement of every session:

```sql
SELECT current_database(), current_setting('request.jwt.claims', true) AS claims, now() AS at_utc;
-- Then confirm the project ref out of band (dashboard URL) equals <STAGING_REF>.
```

### 1.5 How to abort a half-applied run

If migrations 336+ were partially applied to staging and the run is abandoned: prefer resetting the staging project (restore from the pre-run backup or re-create it), because HFO migrations 341 and 343 carry pre-apply checks that raise when receipts or evidence already exist (`341:829-833`, `343:663-668`) and the migration bodies are transactional per file but not across files. Record the partial ledger state before the reset.

---

## 2. Finance-first ordering and renumbering

### 2.1 Why Finance goes first

Finance migration `337_audit_export_scope_and_snapshot.sql` (branch `codex/haven-finance-integration`, worktree `/Users/brianlewis/Circle of Life/Haven Finance Integration`) drops the three `audit_log_export_jobs` policies and runs

```sql
ALTER TABLE public.audit_log_export_jobs ALTER COLUMN row_count TYPE bigint;
```

(`337_audit_export_scope_and_snapshot.sql:23-26`), then recreates the policies. PostgreSQL refuses `ALTER COLUMN ... TYPE` on a column referenced by a policy. HFO's authority migration (COL-133, branch-local `337_hfo_current_authority.sql`) adds policies on the same tables. If HFO's policies exist first, Finance's type change fails. This was reproduced during COL-133 (`OWNER-DECISIONS.md` integrator decision 5; `col133-evidence/finance-integration/resolution.json`).

### 2.2 Finance migration files (as listed on the Finance worktree on 2026-09-10)

```
336_finance_source_commands.sql
337_audit_export_scope_and_snapshot.sql      <- the type-change migration
338_resident_money_snapshot.sql
339_finance_event_outbox.sql
340_finance_batch_approval.sql
341_finance_review_queue.sql
342_finance_credential_lifecycle.sql
```

Seven files, numbered 336–342. They keep their numbers: the hosted ledger's next free slot is 336.

### 2.3 Apply order and the renumbering table

Read the hosted ledger fresh immediately before assigning numbers (§3.1 against **staging**, and the same read against the hosted project **read-only** through the Management API as done for `col137-evidence/hosted-ledger.json`; that read is the only production touch and it mutates nothing). If the max numbered version is not `335`, shift every number below by the difference and stop to re-check with the integrator.

Rehearsed order (OWNER-DECISIONS integrator decision 5, extended to the segments built since): Finance 336–342, then catalog, authority, applicability, evaluator, occurrences, the audit-export reconcile, then receipts, issue lifecycle, verified evidence, corrections, command drafts.

| Apply order | Branch-local file | Integration filename | Notes |
|---|---|---|---|
| 1–7 | Finance `336`–`342` (above) | unchanged | Finance 337 must precede HFO authority. |
| 8 | `336_hfo_activity_catalog.sql` | `343_hfo_activity_catalog.sql` | Seed script constant must change (§2.4). Backfill aborts on cyclic or cross-site template lineage; on a snapshot-based staging this is the dry-run of integrator decision 6. |
| 9 | `337_hfo_current_authority.sql` | `344_hfo_current_authority.sql` | After Finance 337. |
| 10 | `338_hfo_requirement_versions.sql` | `345_hfo_requirement_versions.sql` | |
| 11 | `339_hfo_schedule_evaluator.sql` | `346_hfo_schedule_evaluator.sql` | Replaces two 338 functions in place; must follow applicability. |
| 12 | `340_hfo_occurrences.sql` | `347_hfo_occurrences.sql` | Replaces two 337 bodies in place and widens the 199 audit check; must follow evaluator. |
| 13 | `docs/facility-operations/col133-evidence/finance-integration/proposed_audit_export_current_authority_reconcile.sql` | `348_audit_export_current_authority_reconcile.sql` | Must follow Finance 337 and HFO authority (344). OWNER-DECISIONS 5 places it after occurrences. Name is a proposal; keep the `audit_export_current_authority_reconcile` stem. |
| 14 | `341_hfo_execution_receipts.sql` | `349_hfo_execution_receipts.sql` | Pre-apply check: no receipts or issues may exist. |
| 15 | `342_hfo_issue_lifecycle.sql` | `350_hfo_issue_lifecycle.sql` | |
| 16 | `343_hfo_verified_evidence.sql` (amended) | `351_hfo_verified_evidence.sql` | Pre-apply check: no evidence may exist. Creates bucket `operation-evidence`. |
| 17 | `344_hfo_corrections.sql` | `352_hfo_corrections.sql` | Being built (COL-145). Not present in this worktree at the time of writing. |
| 18 | `345_<command drafts>.sql` | `353_<same stem>.sql` | Being built. Filename stem NOT DETERMINED FROM SOURCE at the time of writing. |

Relative order inside the HFO chain never changes, so every "replaces in place" dependency is preserved by the renumbering.

### 2.4 Renumbering procedure (on a fresh integration branch, locally)

```bash
git checkout -b codex/hfo-staging-integration origin/main
# 1. Bring in Finance (merge or cherry-pick the Finance branch head; resolve the two known conflicts
#    per col133-evidence/finance-integration/resolution.json: keep the Finance export-audit-log handler,
#    use review_clinical_integrity.merged.sql).
# 2. Bring in the HFO stack head (COL-145 branch or its successor) with its migrations still numbered 336-345.
# 3. Renumber HFO files, lowest first, and add the reconcile file:
cd supabase/migrations
git mv 336_hfo_activity_catalog.sql        343_hfo_activity_catalog.sql
git mv 337_hfo_current_authority.sql       344_hfo_current_authority.sql
git mv 338_hfo_requirement_versions.sql    345_hfo_requirement_versions.sql
git mv 339_hfo_schedule_evaluator.sql      346_hfo_schedule_evaluator.sql
git mv 340_hfo_occurrences.sql             347_hfo_occurrences.sql
cp "../../docs/facility-operations/col133-evidence/finance-integration/proposed_audit_export_current_authority_reconcile.sql" 348_audit_export_current_authority_reconcile.sql
git add 348_audit_export_current_authority_reconcile.sql
git mv 341_hfo_execution_receipts.sql      349_hfo_execution_receipts.sql
git mv 342_hfo_issue_lifecycle.sql         350_hfo_issue_lifecycle.sql
git mv 343_hfo_verified_evidence.sql       351_hfo_verified_evidence.sql
git mv 344_hfo_corrections.sql             352_hfo_corrections.sql
git mv 345_<command-drafts-stem>.sql       353_<command-drafts-stem>.sql
cd ../..
```

Then edit the seed script. `scripts/facility-operations/sync-activity-catalog-seed.ts:14` hard-codes the catalog migration filename in the constant `migration`:

```ts
const migration = path.join(root, "supabase/migrations/336_hfo_activity_catalog.sql");
```

Change it to `343_hfo_activity_catalog.sql` in the same commit as the rename, then verify:

```bash
npx tsx scripts/facility-operations/sync-activity-catalog-seed.ts --check   # expect "PASS: <n> source mappings match the migration seed"
npm run migrations:check                                                    # naming + sequence 001..353
npm run migrations:verify:pg                                                # native replay; on this Mac use the native PostgreSQL replay used by the HFO track, not Docker
npm run typecheck && npm run lint
```

Also grep the tree for any other hard-coded `336_hfo_activity_catalog` / `343_hfo_verified_evidence` filename references (`git grep -n "3[34][0-9]_hfo_"`) and update only executable references (scripts, tests); leave historical handoff prose alone. Do not commit or push beyond the local integration branch unless the integrator instructs it; this runbook needs the branch only as the source for `supabase db push`.

### 2.5 Applying to staging

Preferred: the Supabase CLI, because it writes the ledger row per file.

```bash
supabase link --project-ref <STAGING_REF>       # confirm §1.4 afterwards
supabase migration list                          # local 001..353 vs remote 001..335: exactly 336..353 must show as local-only
supabase db push                                 # applies 336..353 in filename order
supabase migration list                          # remote now 001..353
```

`supabase db push` applies **every** local file missing from the remote ledger. If `migration list` shows anything local-only other than 336–353, stop.

Alternative (only if the CLI cannot be linked to staging): run each file in order through the SQL editor, then insert the ledger row yourself for each:

```sql
INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('343', 'hfo_activity_catalog');
```

(`statements` may be left NULL; record in §9 that the ledger was written manually.)

---

## 3. Ledger checks and post-apply schema probe

### 3.1 Before apply (staging; and the same read-only against hosted for the number assignment)

```sql
SELECT count(*) AS ledger_records,
       count(*) FILTER (WHERE version ~ '^[0-9]{3}$') AS numbered_versions,
       max(version) FILTER (WHERE version ~ '^[0-9]{3}$') AS max_numbered_version,
       count(*) FILTER (WHERE version !~ '^[0-9]{3}$') AS other_versions
FROM supabase_migrations.schema_migrations;
-- Expected on staging before apply: numbered_versions = 335, max_numbered_version = '335'.
-- Hosted on 2026-09-10 read: 344 records, 335 numbered, 9 timestamp-style (col137-evidence/hosted-ledger.json).

SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version ~ '^[0-9]{3}$' AND version::int >= 330 ORDER BY version;
-- Expected tail: 330 quality_caller_scope_and_corrections ... 335 employee_file_lifecycle. Nothing >= 336.
```

### 3.2 After apply

```sql
SELECT count(*) FILTER (WHERE version ~ '^[0-9]{3}$') AS numbered_versions,
       max(version) FILTER (WHERE version ~ '^[0-9]{3}$') AS max_numbered_version
FROM supabase_migrations.schema_migrations;
-- Expected: 353 and '353' (or the shifted numbers recorded in §2.3).

SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version ~ '^[0-9]{3}$' AND version::int BETWEEN 336 AND 353 ORDER BY version;
```

Expected list (names as the CLI derives them from filenames):

```
336 finance_source_commands
337 audit_export_scope_and_snapshot
338 resident_money_snapshot
339 finance_event_outbox
340 finance_batch_approval
341 finance_review_queue
342 finance_credential_lifecycle
343 hfo_activity_catalog
344 hfo_current_authority
345 hfo_requirement_versions
346 hfo_schedule_evaluator
347 hfo_occurrences
348 audit_export_current_authority_reconcile
349 hfo_execution_receipts
350 hfo_issue_lifecycle
351 hfo_verified_evidence
352 hfo_corrections
353 <command drafts stem>
```

### 3.3 Post-apply schema probe

Every row of the first query must return `true`.

```sql
SELECT 'tables' AS probe,
  to_regclass('public.operation_activities') IS NOT NULL AS activities,
  to_regclass('public.operation_activity_subjects') IS NOT NULL AS subjects,
  to_regclass('public.operation_subject_access') IS NOT NULL AS subject_access,
  to_regclass('public.operation_requirement_versions') IS NOT NULL AS versions,
  to_regclass('public.operation_facility_requirements') IS NOT NULL AS configurations,
  to_regclass('public.operation_activity_bindings') IS NOT NULL AS bindings,
  to_regclass('public.operation_execution_receipts') IS NOT NULL AS receipts,
  to_regclass('public.operation_issues') IS NOT NULL AS issues,
  to_regclass('public.operation_evidence') IS NOT NULL AS evidence,
  to_regclass('public.operation_evidence_events') IS NOT NULL AS evidence_events,
  to_regclass('haven.operation_command_secrets') IS NOT NULL AS command_secrets;

SELECT 'functions' AS probe,
  to_regprocedure('public.prepare_operation_evidence_review(uuid,text,jsonb)') IS NOT NULL AS prepare,
  to_regprocedure('public.mark_operation_evidence_uploaded_review(uuid,text)') IS NOT NULL AS uploaded,
  to_regprocedure('public.finalize_operation_evidence_review(uuid,text,text,jsonb)') IS NOT NULL AS finalize,
  to_regprocedure('public.fail_operation_evidence_review(uuid,text,jsonb)') IS NOT NULL AS fail,
  to_regprocedure('public.record_operation_work_review(uuid,text,jsonb)') IS NOT NULL AS record,
  to_regprocedure('public.verify_operation_work_review(uuid,text,jsonb)') IS NOT NULL AS verify,
  to_regprocedure('public.generate_operation_occurrences_service(uuid,uuid,jsonb,jsonb)') IS NOT NULL AS generate,
  to_regprocedure('haven.operation_evidence_storage_access(text,text,boolean)') IS NOT NULL AS storage_access,
  to_regprocedure('haven.operation_occurrence_token()') IS NOT NULL AS token;

-- Bucket (343:201-203)
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'operation-evidence';
-- Expected: one row; public = false; file_size_limit = 20971520;
-- allowed_mime_types = {application/pdf,image/jpeg,image/png,image/webp}

-- Storage policies (343:222-228): expect exactly these six names
SELECT policyname, permissive, cmd FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'operation_evidence_storage_%'
ORDER BY policyname;
-- operation_evidence_storage_insert            PERMISSIVE  INSERT
-- operation_evidence_storage_insert_boundary   RESTRICTIVE INSERT
-- operation_evidence_storage_no_delete         RESTRICTIVE DELETE
-- operation_evidence_storage_no_update         RESTRICTIVE UPDATE
-- operation_evidence_storage_read              PERMISSIVE  SELECT
-- operation_evidence_storage_read_boundary     RESTRICTIVE SELECT

-- Grants: authenticated has no DML on the HFO tables; service_role has SELECT only on evidence (343:105-106)
SELECT t.table_name,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'SELECT') AS auth_select,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'INSERT') AS auth_insert,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'UPDATE') AS auth_update,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'DELETE') AS auth_delete,
  has_table_privilege('service_role', 'public.' || t.table_name, 'INSERT') AS service_insert
FROM (VALUES ('operation_activities'), ('operation_activity_subjects'), ('operation_requirement_versions'),
             ('operation_facility_requirements'), ('operation_activity_bindings'), ('operation_task_instances'),
             ('operation_execution_receipts'), ('operation_issues'), ('operation_evidence'), ('operation_evidence_events')) AS t(table_name);
-- Expected: auth_insert, auth_update, auth_delete all false for every row.
-- operation_task_instances is a legacy table with pre-existing grants; record its row, do not "fix" it here.
-- service_insert must be false for operation_evidence and operation_evidence_events.

-- The *_review wrappers: EXECUTE for authenticated only (343:652-659, 341:818-826)
SELECT f.fn,
  has_function_privilege('authenticated', f.fn, 'EXECUTE') AS authenticated_can,
  has_function_privilege('anon', f.fn, 'EXECUTE') AS anon_can,
  has_function_privilege('service_role', f.fn, 'EXECUTE') AS service_role_can
FROM (VALUES ('public.prepare_operation_evidence_review(uuid,text,jsonb)'),
             ('public.mark_operation_evidence_uploaded_review(uuid,text)'),
             ('public.finalize_operation_evidence_review(uuid,text,text,jsonb)'),
             ('public.fail_operation_evidence_review(uuid,text,jsonb)'),
             ('public.record_operation_work_review(uuid,text,jsonb)'),
             ('public.verify_operation_work_review(uuid,text,jsonb)')) AS f(fn);
-- Expected: authenticated_can = true; anon_can = false; service_role_can = false on every row.

-- The service generator: service_role only (340:975-978)
SELECT has_function_privilege('service_role', 'public.generate_operation_occurrences_service(uuid,uuid,jsonb,jsonb)', 'EXECUTE') AS service_can,
       has_function_privilege('authenticated', 'public.generate_operation_occurrences_service(uuid,uuid,jsonb,jsonb)', 'EXECUTE') AS authenticated_can;
-- Expected: true, false

-- Nothing exists yet
SELECT (SELECT count(*) FROM public.operation_evidence) AS evidence_rows,
       (SELECT count(*) FROM public.operation_evidence_events) AS evidence_events,
       (SELECT count(*) FROM public.operation_execution_receipts) AS receipts,
       (SELECT count(*) FROM storage.objects WHERE bucket_id = 'operation-evidence') AS objects;
-- Expected: 0, 0, 0, 0
```

Retain the outputs as `hosted-proof/00-ledger-before.txt`, `01-ledger-after.txt`, `02-schema-probe.txt`.

---

## 4. Synthetic fixture

Every fixture row carries the marker `staging-hfo-proof` in a name, key, email, reason or note so §8 can find it. The fixture lives inside the COL organization on staging (`<ORG_ID>`) because the 336 seed requires that organization and because `haven.organization_id()` is taken from the signed-in profile's row (`326:685-688`); a second organization would need its own catalog seed and gains nothing for this proof. The two facilities and the entity are new rows named for the proof.

### 4.1 Entity, sites, activity, subject (SQL editor as `postgres`, one transaction)

Direct inserts are used here for catalog rows exactly as the review probe does before any actor exists (`supabase/tests/review_hfo_verified_evidence.sql:53,77-85`).

```sql
BEGIN;
INSERT INTO public.entities(id, organization_id, name, entity_type)
VALUES ('00000000-0000-4000-8000-5f0000000001', '00000000-0000-0000-0000-000000000001', 'staging-hfo-proof Entity', 'llc');

INSERT INTO public.facilities(id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
VALUES ('00000000-0000-4000-8000-5f0000000002', '00000000-0000-4000-8000-5f0000000001', '00000000-0000-0000-0000-000000000001',
        'staging-hfo-proof Site A', 'staging-hfo-proof', 'Test', '00000', 1, 'America/New_York'),
       ('00000000-0000-4000-8000-5f0000000003', '00000000-0000-4000-8000-5f0000000001', '00000000-0000-0000-0000-000000000001',
        'staging-hfo-proof Site B', 'staging-hfo-proof', 'Test', '00000', 1, 'America/New_York');
-- facilities.status defaults to 'active' (002_core_hierarchy.sql:66); the generator requires it (340:412).

INSERT INTO public.operation_activities(id, organization_id, facility_id, activity_key, name, activity_kind, subject_kind, origin)
VALUES ('00000000-0000-4000-8000-5f0000000004', '00000000-0000-0000-0000-000000000001', NULL,
        'staging-hfo-proof:generator-photo', 'staging-hfo-proof Generator weekly test', 'structured_observation', 'facility', 'admin_log');

INSERT INTO public.operation_activity_subjects(id, organization_id, facility_id, subject_kind)
VALUES ('00000000-0000-4000-8000-5f0000000005', '00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-5f0000000002', 'facility');
COMMIT;
```

If the `entities.entity_type` value is constrained on staging, use any accepted value; record it. (`002_core_hierarchy.sql:34` declares it as plain `text`.)

### 4.2 Auth users (Supabase Auth admin API, service role; run from the operator's shell)

Four users. Passwords are generated by the operator and stored only in the operator's password manager for the duration of the run.

```http
POST <STAGING_URL>/auth/v1/admin/users
apikey: <SERVICE_ROLE_KEY>
Authorization: Bearer <SERVICE_ROLE_KEY>
Content-Type: application/json

{"email":"staging-hfo-proof+admin@example.invalid","password":"<PW_ADMIN>","email_confirm":true,"user_metadata":{"full_name":"staging-hfo-proof Site A admin"}}
```

Expected: `200` with a JSON user whose `id` is `<ADMIN_UID>`. Repeat for:

| Email | Role (set in §4.3) | Placeholder |
|---|---|---|
| `staging-hfo-proof+assistant@example.invalid` | `admin_assistant` at Site A | `<ASSISTANT_UID>` |
| `staging-hfo-proof+corp@example.invalid` | `owner` (corporate) with a Site A grant | `<CORP_UID>` |
| `staging-hfo-proof+siteb@example.invalid` | `facility_admin` at Site B only | `<SITEB_UID>` |

The exact response body shape of the admin endpoint is the GoTrue user object; only `id` is needed. No repository trigger creates `user_profiles` rows from `auth.users` (no `ON auth.users` trigger exists in `supabase/migrations/`), so §4.3 inserts them.

### 4.3 Profiles (SQL editor)

```sql
INSERT INTO public.user_profiles(id, email, full_name, app_role, organization_id, is_active)
VALUES ('<ADMIN_UID>',     'staging-hfo-proof+admin@example.invalid',     'staging-hfo-proof Site A admin',  'facility_admin',  '00000000-0000-0000-0000-000000000001', true),
       ('<ASSISTANT_UID>', 'staging-hfo-proof+assistant@example.invalid', 'staging-hfo-proof Site A assist', 'admin_assistant', '00000000-0000-0000-0000-000000000001', true),
       ('<CORP_UID>',      'staging-hfo-proof+corp@example.invalid',      'staging-hfo-proof Corporate',     'owner',           '00000000-0000-0000-0000-000000000001', true),
       ('<SITEB_UID>',     'staging-hfo-proof+siteb@example.invalid',     'staging-hfo-proof Site B admin',  'facility_admin',  '00000000-0000-0000-0000-000000000001', true);
```

Then apply the grants of §5 **before** any sign-in, because `auth_claim_version` on the profile changes with authority edits (326 trigger) and a token minted before a change is refused with `HAVEN_AUTHORIZATION_STALE` (`326:777-781`).

### 4.4 Published central requirement version (HTTP, as the corporate user)

Central drafts and publication require `owner` or `org_admin` (`src/lib/operations/requirements.ts:13`). Sign in the corporate user first (§6.1).

```http
POST <APP_URL>/api/admin/operations/requirements
Cookie: <COOKIE_CORP>
Content-Type: application/json

{"activity_id":"00000000-0000-4000-8000-5f0000000004",
 "payload":{"title":"staging-hfo-proof Generator weekly test",
            "wording":"staging-hfo-proof: run the generator and photograph the panel.",
            "allowed_recorder_roles":["facility_admin","admin_assistant"],
            "required_evidence":[{"kind":"photo","label":"Panel photo","min_count":1,"when":"always"}]}}
```

Expected: `200` `{"version":{"id":"<VERSION_ID>","status":"draft",...}}` (`requirements/route.ts:64`).

```http
POST <APP_URL>/api/admin/operations/requirements/<VERSION_ID>/publish
Cookie: <COOKIE_CORP>
Content-Type: application/json

{"effective_from":"<ISO-8601 instant with offset, one minute in the past, e.g. 2026-09-11T09:00:00-04:00>"}
```

Expected: `200`; the returned version has `"status":"published"` and `effective_from` set. The response envelope key of the publish route is produced by `runRequirementPublication` in `src/lib/operations/requirements.ts` and was not read for this runbook: **NOT DETERMINED FROM SOURCE**; record the body.

### 4.5 Published site configuration with a confirmed schedule (HTTP, as the Site A admin)

Site drafts allow `facility_admin` (`requirements.ts:14`). The schedule rule mirrors the review probe (`review_hfo_verified_evidence.sql:148-149`) with the weekday set to **today's weekday in America/New_York** so that the generator accepts an occurrence dated today.

```http
POST <APP_URL>/api/admin/operations/facility-requirements
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"activity_id":"00000000-0000-4000-8000-5f0000000004",
 "facility_id":"00000000-0000-4000-8000-5f0000000002",
 "payload":{"applicability":"applicable",
            "requirement_version_id":"<VERSION_ID>",
            "schedule_status":"confirmed",
            "schedule_rule":{"rule_version":1,"timezone":"America/New_York",
                             "recurrence":{"kind":"weekly","weekday":"<today, lowercase, e.g. thursday>"},
                             "deadline":{"time":"23:00"}}}}
```

Expected: `200` `{"configuration":{"id":"<CONFIG_ID>","status":"draft",...}}` (`facility-requirements/route.ts:74`).

```http
POST <APP_URL>/api/admin/operations/facility-requirements/<CONFIG_ID>/publish
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"effective_from":"<same instant as §4.4>"}
```

Expected: `200`, `"status":"published"`, `applicability: "applicable"`, `schedule_status: "confirmed"`.

### 4.6 One scheduled occurrence for today (sanctioned service command, SQL editor as `postgres`)

**Which and why.** The occurrence is created with `public.generate_operation_occurrences_service` (`340:956`), not by a direct insert. A direct insert of a managed row is refused by the 340 guard unless the per-transaction token from `haven.operation_command_secrets` is set, and only the definer commands can compute that token (`340:24-40`); setting it by hand would bypass the same guard the proof is meant to exercise. The generator is the writer the scheduler uses, records the run id and rule snapshot, and requires `auth.uid()` to be NULL (`340:400`), which is exactly the SQL editor's condition as `postgres`. A facility-kind activity needs no explicit binding (OWNER-DECISIONS 3c(i)); the applicable confirmed configuration enrols the site itself.

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today)
SELECT public.generate_operation_occurrences_service(
  '00000000-0000-4000-8000-5f0000000002',
  '<CONFIG_ID>',
  jsonb_build_array(jsonb_build_object(
    'occurrence_date', to_char(d.today, 'YYYY-MM-DD'),
    'period', jsonb_build_object('start_date', to_char(d.today, 'YYYY-MM-DD'), 'end_date', to_char(d.today + 6, 'YYYY-MM-DD')),
    'due_at', ((d.today::timestamp + time '23:00') AT TIME ZONE 'America/New_York'),
    'grace_ends_at', NULL, 'remind_at', NULL, 'timezone', 'America/New_York', 'adjustments', '[]'::jsonb)),
  jsonb_build_object(
    'run_id', 'staging-hfo-proof-run-0001', 'evaluator_version', 'hfo-evaluator/1',
    'date_from', to_char(d.today, 'YYYY-MM-DD'), 'date_to', to_char(d.today, 'YYYY-MM-DD'),
    'rule', (SELECT schedule_rule FROM public.operation_facility_requirements WHERE id = '<CONFIG_ID>'),
    'occurrence_kind', 'scheduled'))
FROM d;
-- Expected JSON: counts.created = 1, counts.conflict = 0, counts.invalid = 0.

SELECT id AS occ_id, status, execution_state, occurrence_kind, assigned_shift_date, due_at, subject_id
FROM public.operation_task_instances
WHERE activity_id = '00000000-0000-4000-8000-5f0000000004' AND facility_id = '00000000-0000-4000-8000-5f0000000002'
  AND occurrence_kind = 'scheduled' AND deleted_at IS NULL;
-- Expected: one row; status = 'pending'; execution_state = 'none'; subject_id = 00000000-0000-4000-8000-5f0000000005. Record id as <OCC_ID>.
```

If the shell alternative is preferred (this is the Edge scheduler's path), the same call is `POST <STAGING_URL>/rest/v1/rpc/generate_operation_occurrences_service` with `apikey: <SERVICE_ROLE_KEY>`, `Authorization: Bearer <SERVICE_ROLE_KEY>`, `Content-Type: application/json` and body `{"p_facility":..., "p_configuration":..., "p_occurrences":[...], "p_run":{...}}` with the same JSON values. Do not retain the service key in any log.

---

## 5. Role and site grants

All grants are direct inserts as `postgres` (there is no HFO grant command; `operation_subject_access` accepts `service_role` INSERT/UPDATE only, `337:22`). Apply before any sign-in (§4.3).

```sql
BEGIN;
-- Site grants (003_user_rbac.sql:31-41; 337:5 adds operation_expires_at, left NULL = no expiry)
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id, granted_by)
VALUES ('<ADMIN_UID>',     '00000000-0000-4000-8000-5f0000000002', '00000000-0000-0000-0000-000000000001', '<CORP_UID>'),
       ('<ASSISTANT_UID>', '00000000-0000-4000-8000-5f0000000002', '00000000-0000-0000-0000-000000000001', '<CORP_UID>'),
       ('<CORP_UID>',      '00000000-0000-4000-8000-5f0000000002', '00000000-0000-0000-0000-000000000001', '<CORP_UID>'),
       ('<SITEB_UID>',     '00000000-0000-4000-8000-5f0000000003', '00000000-0000-0000-0000-000000000001', '<CORP_UID>');

-- Protected-subject grant for the Site A admin (337:6-18). The proof's activity is facility-class, for which
-- lock_operation_work_authority needs no subject grant (341:322); this row exists so the same admin is
-- provably authorized for a protected subject and so the grant table is exercised by the revocation locks.
INSERT INTO public.operation_subject_access(organization_id, facility_id, user_id, scope, granted_by, reason, can_record)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-5f0000000002', '<ADMIN_UID>',
        'employee_personnel', '<CORP_UID>', 'staging-hfo-proof personnel recording authority', true);
COMMIT;
```

Who may do what (source):

| User | Role | Site grant | Recorder for the activity (`allowed_recorder_roles = {facility_admin, admin_assistant}`) | Corporate coverage |
|---|---|---|---|---|
| Site A admin | `facility_admin` | Site A | yes: uploader in §6 | no |
| Site A assistant | `admin_assistant` | Site A | yes: the non-uploader with recording authority for §7.3 | no |
| Corporate | `owner` | Site A (explicit; COL-133 requires an explicit current grant even for corporate roles, `337:27-34`) | **no** (not in the recorder list) | downloads finalized evidence (view roles, `evidence.ts:20`) |
| Site B admin | `facility_admin` | Site B only | not for Site A rows: `haven.operation_facility_access(site_a)` is false, so every Site A occurrence, receipt and evidence row is invisible | no |

Negative users are therefore: the Site B admin (other site), the corporate user (not a recorder; download only), the assistant (recorder but not the uploader), and the anonymous key (§7.9).

---

## 6. Hosted proof: exact HTTP steps (positive path)

Retention rule for this section and §7: for every request write two files under `docs/facility-operations/col143-evidence/hosted-proof/` named `NN-<step>.request.txt` (method, URL with any `token=` query value replaced by `<REDACTED>`, headers with `Cookie`, `Authorization` and `apikey` values replaced by `<REDACTED>`, the JSON body) and `NN-<step>.response.txt` (status line, response headers, JSON body with any `token`, `signedUrl`, `signedURL`, `url`, `access_token`, `refresh_token` values replaced by `<REDACTED>`). Never write object bytes; downloads go to `/dev/null`. A helper that does both:

```bash
# usage: hp <NN-step> <curl args...>
hp() { local n="$1"; shift; local dir="docs/facility-operations/col143-evidence/hosted-proof";
  printf '%s\n' "$*" | sed -E 's/(Cookie|Authorization|apikey): [^"]*/\1: <REDACTED>/g; s/token=[^&" ]*/token=<REDACTED>/g' > "$dir/$n.request.txt";
  curl -sS -D "$dir/$n.headers.tmp" -o "$dir/$n.body.tmp" -w '%{http_code}\n' "$@" > "$dir/$n.status.tmp";
  { echo "HTTP $(cat "$dir/$n.status.tmp")"; cat "$dir/$n.headers.tmp"; echo; cat "$dir/$n.body.tmp" | sed -E 's/"(token|signedUrl|signedURL|url|access_token|refresh_token)":"[^"]*"/"\1":"<REDACTED>"/g'; } > "$dir/$n.response.txt";
  rm -f "$dir/$n".*.tmp; cat "$dir/$n.response.txt" | head -c 4000; echo; }
```

Keep the **unredacted** JSON of §6.3 (the `upload.signedUrl`) and §6.10 (`download.signedUrl`) only in the shell session; they expire and are never written to disk.

### 6.1 Sign in and obtain the app cookie (each user)

Password grant (Supabase Auth):

```http
POST <STAGING_URL>/auth/v1/token?grant_type=password
apikey: <ANON_KEY>
Content-Type: application/json

{"email":"staging-hfo-proof+admin@example.invalid","password":"<PW_ADMIN>"}
```

Expected: `200` with `access_token`, `token_type: "bearer"`, `expires_in`, `expires_at`, `refresh_token`, `user`. Keep `access_token` as `<ACCESS_TOKEN_ADMIN>`. Decode the JWT payload (base64url segment 2) and confirm it contains `session_id` and, when the hook is enabled, `auth_claim_version` (`326:183-187`, the actor snapshot requires `session_id`). Record only the claim names, not the token.

The app routes read the session from the `@supabase/ssr` cookie. Two ways to obtain `<COOKIE_ADMIN>`:

- **Browser (simplest, recommended):** open `<APP_URL>/login`, sign in as the user, then in DevTools → Application → Cookies copy every cookie whose name starts with `sb-<STAGING_REF>-auth-token` (a single cookie, or chunks `.0`, `.1`, …) into one `Cookie:` header value `name=value; name2=value2`.
- **Shell:** `@supabase/ssr` 0.10.0 stores the session JSON as `base64-` + base64url (no padding) of the JSON, chunked at 3180 characters into `sb-<STAGING_REF>-auth-token.0`, `.1`, … when longer than that, else unchunked (`node_modules/@supabase/ssr/dist/main/cookies.js:7,157-159`, `utils/chunker.js:8`). The password-grant response body is the session object.

```bash
SESSION_JSON='<the exact password-grant response body>'
ENC="base64-$(printf '%s' "$SESSION_JSON" | base64 | tr -d '\n=' | tr '+/' '-_')"
NAME="sb-<STAGING_REF>-auth-token"
if [ ${#ENC} -le 3180 ]; then COOKIE_ADMIN="$NAME=$ENC"; else
  COOKIE_ADMIN=""; i=0; s="$ENC"; while [ -n "$s" ]; do COOKIE_ADMIN="${COOKIE_ADMIN:+$COOKIE_ADMIN; }$NAME.$i=${s:0:3180}"; s="${s:3180}"; i=$((i+1)); done; fi
```

Verify the cookie before proceeding (expect `200` and a JSON list, possibly empty):

```http
GET <APP_URL>/api/admin/operations/facility-requirements?facility_id=00000000-0000-4000-8000-5f0000000002
Cookie: <COOKIE_ADMIN>
```

If this returns `401 {"error":"Not authenticated"}`, the cookie is malformed; use the browser method.

Repeat sign-in for the assistant, corporate and Site B users. Retain `10-signin-admin.response.txt` etc. with tokens redacted (the helper does this).

### 6.2 Record the work: expect `performed_missing_evidence` (Site A admin)

Route: `src/app/api/admin/operations/occurrences/[id]/record/route.ts` → RPC `record_operation_work_review` (`341:812`). Payload keys allowed: `performed_at`, `performer`, `entry_kind`, `entry_reason`, `outcome`, `values`, `note`, `issue` (`341:408`). Request keys must match `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`.

```http
POST <APP_URL>/api/admin/operations/occurrences/<OCC_ID>/record
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"request_key":"staging-hfo-proof:record:0001","payload":{"outcome":"performed","note":"staging-hfo-proof generator ran"}}
```

Expected `200`:

```json
{"outcome":"receipt",
 "receipt":{"id":"<RECEIPT_ID>","receipt_kind":"performance","outcome":"performed","completion_state":"performed_missing_evidence",
            "evidence_status":"missing","missing_evidence":[{"kind":"photo","label":"Panel photo","min_count":1,"when":"always"}],
            "evidence_status_current":"missing","evidence_satisfied_at":null,"recorder_id":"<ADMIN_UID>","revision":"<RECEIPT_REVISION, 64 hex>", "...":"..."},
 "occurrence":{"id":"<OCC_ID>","status":"in_progress","execution_state":"performed_missing_evidence","occurrence_revision":"...","performed_at":"..."},
 "issue":null,"replayed":false}
```

Record `<RECEIPT_ID>` and `<RECEIPT_REVISION>` (the receipt's `revision`; finalize needs it). Retain as `20-record`.

### 6.3 Prepare evidence for the photo rule: signed upload URL (Site A admin)

**The test file.** A 1×1 RGBA PNG, 70 bytes. Base64 literal:

```
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==
```

Materialize it and compute the digests yourself; the runbook's values were computed on 2026-09-10 with the same commands and must match:

```bash
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -D > panel.png   # macOS; on Linux use base64 -d
file panel.png              # PNG image data, 1 x 1, 8-bit/color RGBA
wc -c < panel.png           # 70
openssl dgst -md5 panel.png     # b357a19c87624c7c4d131aeeb4ae677f
md5 -q panel.png                # b357a19c87624c7c4d131aeeb4ae677f  (macOS cross-check)
openssl dgst -sha256 panel.png  # 497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581
```

| Field | Value |
|---|---|
| `size_bytes` | 70 |
| `md5` | `b357a19c87624c7c4d131aeeb4ae677f` |
| `sha256` | `497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581` |

Route: `src/app/api/admin/operations/evidence/route.ts` POST → RPC `prepare_operation_evidence_review`, then `createSignedUploadUrl(object_path)` through the session client (`route.ts:86`). Body schema `src/lib/operations/evidence.ts:73` (`md5` is required by the amended schema; the pre-amendment schema at `c7b5cc30` rejects unknown keys, so if §1.2 item 4 found no `declared_md5`, omit `md5` and record that).

```http
POST <APP_URL>/api/admin/operations/evidence
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"receipt_id":"<RECEIPT_ID>","request_key":"staging-hfo-proof:prepare:0001",
 "payload":{"kind":"photo","rule_label":"Panel photo","filename":"panel.png","mime":"image/png","size_bytes":70,
            "md5":"b357a19c87624c7c4d131aeeb4ae677f",
            "sha256":"497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581"}}
```

Expected `200`:

```json
{"outcome":"receipt",
 "evidence":{"id":"<EVIDENCE_ID>","state":"prepared","evidence_kind":"photo","rule_label":"Panel photo","bucket_id":"operation-evidence",
             "object_path":"00000000-0000-4000-8000-5f0000000002/<EVIDENCE_ID>/panel.png",
             "declared_mime":"image/png","declared_size_bytes":70,"uploaded_by":"<ADMIN_UID>","checksum_verified":false,"...":"..."},
 "event":{"event_kind":"prepared","...":"..."},"replayed":false,"satisfaction":null,
 "upload":{"path":"<OBJECT_PATH>","token":"<signed upload token>","signedUrl":"<STAGING_URL>/storage/v1/object/upload/sign/operation-evidence/<OBJECT_PATH>?token=..."}}
```

`<OBJECT_PATH>` is `<SITE_A>/<EVIDENCE_ID>/panel.png` (`343:462`). If `upload` is `null` with `upload_error`, the Storage signing was refused by the insert policy at signing time; stop and record (this would mean the signed-URL path does not run under the session as designed, `route.ts:86-93`). The exact `signedUrl` string format is produced by `@supabase/storage-js`; the path shown is the SDK's convention and is **NOT DETERMINED FROM SOURCE** here beyond that. Use the returned `signedUrl` verbatim. Retain as `30-prepare` (redacted).

### 6.4 Upload the bytes with the signed URL (Site A admin)

```http
PUT <the upload.signedUrl from §6.3, verbatim>
Authorization: Bearer <ACCESS_TOKEN_ADMIN>
apikey: <ANON_KEY>
Content-Type: image/png
x-upsert: false
Content-Length: 70

<the 70 PNG bytes>
```

```bash
hp 31-storage-put -X PUT "<SIGNED_UPLOAD_URL>" -H "Authorization: Bearer <ACCESS_TOKEN_ADMIN>" -H "apikey: <ANON_KEY>" -H "Content-Type: image/png" -H "x-upsert: false" --data-binary @panel.png
```

Expected: `200`. The JSON body returned by the Storage service for a signed-URL upload is **NOT DETERMINED FROM SOURCE** (the SDK only requires a 2xx); record it verbatim with any `Key` value kept (it is the bucket path, not a secret).

### 6.5 Observe the stored object row (SQL editor)

```sql
SELECT id AS object_id, owner, owner_id, version, created_at,
       metadata->>'size' AS size, metadata->>'mimetype' AS mimetype, metadata->>'eTag' AS etag
FROM storage.objects
WHERE bucket_id = 'operation-evidence' AND name = '<OBJECT_PATH>';
```

Expected: one row; `owner = <ADMIN_UID>` (uuid, non-null); `owner_id = '<ADMIN_UID>'` (text); `size = '70'`; `mimetype = 'image/png'`; `etag` equal to `"b357a19c87624c7c4d131aeeb4ae677f"` (Storage stores the eTag quoted; the amended verifier strips quotes and any weak prefix, checksum-contracts §3). Retain as `32-storage-object-row.txt`.

### 6.6 The eTag and owner confirmation step (Site A admin; before marking uploaded)

Sign a short-lived download URL directly with Storage. The read policy allows the uploader to read its own in-flight object (`343:218`).

```http
POST <STAGING_URL>/storage/v1/object/sign/operation-evidence/<OBJECT_PATH>
Authorization: Bearer <ACCESS_TOKEN_ADMIN>
apikey: <ANON_KEY>
Content-Type: application/json

{"expiresIn":60}
```

Expected `200` with a body containing a signed path (the SDK reads `signedURL`; the exact key name is **NOT DETERMINED FROM SOURCE**; record it). Then:

```http
GET <STAGING_URL>/storage/v1<signedURL value, verbatim>
```

```bash
hp 33-storage-head -o /dev/null "<STAGING_URL>/storage/v1<SIGNED_PATH>"
```

(Whether the signed object route answers `HEAD` is **NOT DETERMINED FROM SOURCE**; `GET` with the body discarded records the same headers without retaining bytes.) Expected: `200`; `content-length: 70`; `content-type: image/png`; an `etag` header. Compare the `etag` header and the SQL `etag` of §6.5 with the MD5 `b357a19c87624c7c4d131aeeb4ae677f`.

Decision:

- `owner` is `<ADMIN_UID>` **and** the eTag (unquoted, lower-cased) equals the MD5 → continue to §6.7.
- `owner` is NULL → **stop** (§1.3). Record `owner_id`. The `mark_uploaded` object check reads `owner` (`343:392-393`) and would raise `Uploaded object not found for this evidence`; the recorded fallback is switching the command to `owner_id`.
- eTag is not a plain 32-hex MD5 (for example a `-N` multipart suffix or a different digest) → **stop**. Record the exact value. Under the amended 343 the `uploaded` step would return `checksum_unverifiable` and finalize is refused; the fallback is the app-tier verifier named in checksum-contracts §1. Do not finalize.

### 6.7 Mark uploaded (Site A admin)

Route: `src/app/api/admin/operations/evidence/[id]/uploaded/route.ts` → `runEvidenceCommand("uploaded")` (`evidence.ts:266-303`) → RPC `mark_operation_evidence_uploaded_review`.

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/uploaded
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"request_key":"staging-hfo-proof:uploaded:0001"}
```

Expected `200` (amended 343): `evidence.state = "uploaded"`, `evidence.object_id` = the §6.5 `object_id`, `evidence.object_etag` = the stored eTag, `evidence.object_size_bytes = 70`, `evidence.object_mime = "image/png"`, `evidence.checksum_verified = true`, `evidence.checksum_method = "storage_etag_md5"`, `evidence.checksum_verified_at` set, `event.event_kind = "uploaded"`, `replayed = false`, and the reply's `outcome` is `"uploaded"` per checksum-contracts §4. The committed route at `c7b5cc30` returns `outcome: "receipt"` and `checksum_verified: false` (`evidence.ts:296-302`, `343:502`); if that is what comes back, the amendment is not on the applied stack (§1.2 item 4). Retain as `40-uploaded`.

**Before §6.8, run the negative cases that need an in-flight row: §7.3, §7.4 and §7.7.** They must all refuse and must leave the row `uploaded`; confirm with `GET <APP_URL>/api/admin/operations/evidence?receipt_id=<RECEIPT_ID>` as the admin (expect the row with `state: "uploaded"` and its `object_path`, `route.ts:105-125`).

### 6.8 Finalize with the receipt revision (Site A admin)

Route: `.../evidence/[id]/finalize/route.ts` → `runEvidenceCommand("finalize")` → RPC `finalize_operation_evidence_review(p_evidence, p_request_key, p_expected_receipt_revision, p_payload)`.

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/finalize
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"request_key":"staging-hfo-proof:finalize:0001","expected_receipt_revision":"<RECEIPT_REVISION>",
 "payload":{"sha256":"497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581"}}
```

Expected `200`:

```json
{"outcome":"receipt",
 "evidence":{"id":"<EVIDENCE_ID>","state":"finalized","finalized_by":"<ADMIN_UID>","finalized_at":"...","object_id":"...","object_etag":"...","checksum_verified":true,"...":"..."},
 "event":{"event_kind":"finalized","expected_receipt_revision":"<RECEIPT_REVISION>","...":"..."},
 "replayed":false,
 "satisfaction":{"receipt_evidence_status":"complete","unmet":[],"satisfied_event_id":"...",
                 "occurrence":{"id":"<OCC_ID>","status":"completed","execution_state":"completed"}}}
```

(`343:380-381` builds `satisfaction`; the version has `review_required=false`, so the state is `completed`, `343:367`.) The finalized row no longer carries `object_path` in replies (`evidence.ts:122-129`). Retain as `50-finalize`.

Confirm in SQL that the original attribution did not move:

```sql
SELECT r.id, r.recorder_id, r.performed_at, r.recorded_at, r.evidence_status, r.evidence_status_current, r.evidence_satisfied_at, r.revision,
       t.status, t.execution_state, t.completed_at, t.verified_by, t.verified_at, t.sla_met
FROM public.operation_execution_receipts r JOIN public.operation_task_instances t ON t.id = r.task_instance_id
WHERE r.id = '<RECEIPT_ID>';
-- Expected: evidence_status = 'missing' (immutable), evidence_status_current = 'complete', evidence_satisfied_at set,
-- revision unchanged from §6.2, status = 'completed', execution_state = 'completed', verified_by = <ADMIN_UID> (343:371).

SELECT event_kind, evidence_id, actor_id, expected_receipt_revision, event_seq FROM public.operation_evidence_events
WHERE receipt_id = '<RECEIPT_ID>' ORDER BY event_seq;
-- Expected order: prepared, uploaded, finalized, satisfied (satisfied has evidence_id NULL, 343:98). Plus any 'failed' rows from §7.6.
```

Retain as `51-post-finalize-rows.txt`.

### 6.9 Receipts show the current evidence status (Site A admin)

Route: `src/app/api/admin/operations/occurrences/[id]/receipts/route.ts:34-36` selects `evidence_status_current, evidence_satisfied_at` beside the receipt columns.

```http
GET <APP_URL>/api/admin/operations/occurrences/<OCC_ID>/receipts
Cookie: <COOKIE_ADMIN>
```

Expected `200` `{"receipts":[{"id":"<RECEIPT_ID>","receipt_kind":"performance","evidence_status":"missing","evidence_status_current":"complete","evidence_satisfied_at":"...","completion_state":"performed_missing_evidence", ...}]}` and no `object_path` or filename anywhere in the body (grep the retained file for `panel.png` and `operation-evidence/`; both must be absent). Retain as `60-receipts`.

### 6.10 Corporate download (corporate user)

Route: `.../evidence/[id]/download/route.ts` (finalized only; signed URL for 60 s through the session client, `download: true`).

```http
GET <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/download
Cookie: <COOKIE_CORP>
```

Expected `200` `{"outcome":"receipt","download":{"signedUrl":"<STAGING_URL>/storage/v1/object/sign/operation-evidence/<OBJECT_PATH>?token=...&download=","expires_in":60}}`. Then within 60 seconds:

```bash
hp 71-download-get -o /dev/null "<download.signedUrl verbatim>"
```

Expected: `200`; `content-length: 70`; `content-type: image/png`; a `content-disposition` header naming an attachment. The bytes go to `/dev/null`; nothing is stored. Retain `70-download-url` (redacted) and `71-download-get` (headers only).

Also confirm the corporate user can list the evidence and sees no path:

```http
GET <APP_URL>/api/admin/operations/evidence?receipt_id=<RECEIPT_ID>
Cookie: <COOKIE_CORP>
```

Expected `200` with one row, `state: "finalized"`, and **no** `object_path` key (`evidence.ts:126-129`). Retain as `72-corp-list`.

---

## 7. Negative authorization cases

Each case is run once, with the exact request and the expected refusal. Any 2xx is a stop condition. Two request paths appear: the **app route** (proof of record) and, where the route's pre-read hides the row before the database wording can appear, the **direct PostgREST RPC** with the user's bearer token, so the database refusal itself is observed. PostgREST maps `42501` to `403` for an authenticated JWT and to `401` for the anon role; `P0001` maps to `400` with the message in the JSON `message` field.

Direct RPC request shape (used below):

```http
POST <STAGING_URL>/rest/v1/rpc/<function>
apikey: <ANON_KEY>
Authorization: Bearer <ACCESS_TOKEN_x>
Content-Type: application/json

{"p_...":...}
```

### 7.1 Other-site user prepares against the Site A receipt (Site B admin)

Run any time after §6.2.

```http
POST <APP_URL>/api/admin/operations/evidence
Cookie: <COOKIE_SITEB>
Content-Type: application/json

{"receipt_id":"<RECEIPT_ID>","request_key":"staging-hfo-proof:neg-siteb-prepare:0001",
 "payload":{"kind":"photo","rule_label":"Panel photo","filename":"panel.png","mime":"image/png","size_bytes":70,"md5":"b357a19c87624c7c4d131aeeb4ae677f"}}
```

Expected: `404 {"error":"Receipt not found","outcome":"missing"}` (session read of the receipt hides it, `route.ts:25-40`). Direct RPC `prepare_operation_evidence_review` with `<ACCESS_TOKEN_SITEB>`: expected `403` with message `Operation unavailable` (`343:330`). Confirm no row was created: `SELECT count(*) FROM public.operation_evidence WHERE request_key LIKE 'staging-hfo-proof:neg-%'` → `0`. Retain `80-neg-siteb-prepare`.

### 7.2 Other-site user PUTs to the owned path (Site B admin)

Run after §6.3 (path exists). The only way to obtain a signed upload URL is under the uploader's own session; another session is refused at signing time by the insert policy (`343:223`), and a direct create is refused by the same policy.

```http
POST <STAGING_URL>/storage/v1/object/upload/sign/operation-evidence/<OBJECT_PATH>
Authorization: Bearer <ACCESS_TOKEN_SITEB>
apikey: <ANON_KEY>
Content-Type: application/json

{}
```

Expected: `400` or `403` with a Storage error naming the row-level security policy. Then:

```http
POST <STAGING_URL>/storage/v1/object/operation-evidence/<OBJECT_PATH>
Authorization: Bearer <ACCESS_TOKEN_SITEB>
apikey: <ANON_KEY>
Content-Type: image/png
x-upsert: false

<the 70 PNG bytes>
```

Expected: `400` or `403` (`new row violates row-level security policy` or equivalent). The exact status code and body of Storage refusals are **NOT DETERMINED FROM SOURCE**; record them. Confirm `SELECT count(*) FROM storage.objects WHERE bucket_id='operation-evidence'` is unchanged (1 after §6.4). Retain `81-neg-siteb-sign`, `82-neg-siteb-post`.

### 7.3 Non-uploader `uploaded`, `finalize`, `fail` on the in-flight row (Site A assistant)

Run between §6.7 and §6.8. The assistant holds recorder authority for the activity, so only the uploader rule refuses.

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/uploaded
Cookie: <COOKIE_ASSISTANT>
Content-Type: application/json

{"request_key":"staging-hfo-proof:neg-assist-uploaded:0001"}
```

Expected via the route: `404 {"error":"Evidence not found","outcome":"missing"}`, because RLS shows an in-flight row only to its uploader (`343:109-110`) and the route reads before it commands (`evidence.ts:228-244`). Direct RPC `mark_operation_evidence_uploaded_review` `{"p_evidence":"<EVIDENCE_ID>","p_request_key":"staging-hfo-proof:neg-assist-uploaded:0002"}` with `<ACCESS_TOKEN_ASSISTANT>`: expected `400` with `message: "Evidence belongs to another uploader"` (`343:496`). Repeat for:

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/finalize
Cookie: <COOKIE_ASSISTANT>
Content-Type: application/json

{"request_key":"staging-hfo-proof:neg-assist-finalize:0001","expected_receipt_revision":"<RECEIPT_REVISION>","payload":{}}
```

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/fail
Cookie: <COOKIE_ASSISTANT>
Content-Type: application/json

{"request_key":"staging-hfo-proof:neg-assist-fail:0001","payload":{"reason":"staging-hfo-proof negative case"}}
```

Expected: `404` via the route for both; direct RPC `finalize_operation_evidence_review` / `fail_operation_evidence_review`: `400` `Evidence belongs to another uploader` (`343:525,565`). Afterwards the row is still `uploaded` and no `failed` event exists: `SELECT state FROM public.operation_evidence WHERE id='<EVIDENCE_ID>'` → `uploaded`; `SELECT count(*) FROM public.operation_evidence_events WHERE evidence_id='<EVIDENCE_ID>' AND event_kind='failed'` → `0`. Retain `83-neg-assist-uploaded`, `84-neg-assist-finalize`, `85-neg-assist-fail` (route and RPC variants suffixed `-rpc`).

### 7.4 Corporate download of an unfinalized object (corporate user)

Run between §6.7 and §6.8.

```http
GET <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/download
Cookie: <COOKIE_CORP>
```

Expected: `404 {"error":"Evidence not found","outcome":"missing"}` (in-flight row invisible to a non-uploader). Also sign directly with Storage as the corporate user:

```http
POST <STAGING_URL>/storage/v1/object/sign/operation-evidence/<OBJECT_PATH>
Authorization: Bearer <ACCESS_TOKEN_CORP>
apikey: <ANON_KEY>
Content-Type: application/json

{"expiresIn":60}
```

Expected: `400`/`403`/`404` (the read policy returns false for a non-uploader before finalization, `343:218`); record the status. Retain `86-neg-corp-download-unfinalized`, `87-neg-corp-sign-unfinalized`.

### 7.5 PUT after finalization (Site A admin)

Run after §6.8. The insert policy allows a write only while `state='prepared'` (`343:217`); a finalized path cannot be re-signed or re-created, and the client has no update policy (`343:227`).

```http
POST <STAGING_URL>/storage/v1/object/upload/sign/operation-evidence/<OBJECT_PATH>
Authorization: Bearer <ACCESS_TOKEN_ADMIN>
apikey: <ANON_KEY>
Content-Type: application/json

{}
```

Expected: `400`/`403` (policy). Then a direct overwrite attempt:

```http
PUT <STAGING_URL>/storage/v1/object/operation-evidence/<OBJECT_PATH>
Authorization: Bearer <ACCESS_TOKEN_ADMIN>
apikey: <ANON_KEY>
Content-Type: image/png
x-upsert: true

<any 70 bytes>
```

Expected: `400`/`403` (no client UPDATE policy on the bucket). Then confirm the object is byte-identical: re-run §6.5 and compare `id`, `version`, `etag` with the retained values; all unchanged. Retain `88-neg-put-after-finalize-sign`, `89-neg-put-after-finalize-put`, `90-neg-put-after-finalize-object-row.txt`.

### 7.6 Checksum mismatch (Site A admin; amended 343 only)

Run after §6.8 as a **supplementary** row (no `rule_label`), so it neither collides with the satisfied rule (prepare refuses `Evidence rule is already satisfied`, `343:452`) nor changes satisfaction. Declare a wrong MD5 (the MD5 of a different file, e.g. of the empty string `d41d8cd98f00b204e9800998ecf8427e`), upload the real 70-byte PNG, then mark uploaded.

```http
POST <APP_URL>/api/admin/operations/evidence
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"receipt_id":"<RECEIPT_ID>","request_key":"staging-hfo-proof:prepare-mismatch:0001",
 "payload":{"kind":"photo","filename":"panel-mismatch.png","mime":"image/png","size_bytes":70,"md5":"d41d8cd98f00b204e9800998ecf8427e"}}
```

Expected `200`, `state: "prepared"`, new `<EVIDENCE_ID_2>` and `upload.signedUrl`. PUT the real `panel.png` bytes as in §6.4 (expect `200`). Then:

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID_2>/uploaded
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"request_key":"staging-hfo-proof:uploaded-mismatch:0001"}
```

Expected (checksum-contracts §3-4): `409` with `outcome: "checksum_mismatch"`, class `conflict`, and the returned evidence in `state: "failed"` with `failure_reason: "checksum_mismatch"`. In SQL: the row is `failed`; a `failed` event exists whose `details` carry the declared and observed values; the receipt is still `complete` from §6.8; the §6.9 list as the admin shows the failed row (own rows are visible to the uploader, `route.ts:123`) and as the corporate user does not. If the applied 343 is pre-amendment, this case cannot run: record "not exercised: amendment absent" in §9.

### 7.7 Stale receipt revision at finalize (Site A admin)

Run between §6.7 and §6.8 on the in-flight row.

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID>/finalize
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"request_key":"staging-hfo-proof:finalize-stale:0001",
 "expected_receipt_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payload":{}}
```

Expected: `409 {"error":"Receipt changed since it was read","outcome":"conflict"}` (`343:531`; mapping `evidence.ts:146-158,189-190`). The row stays `uploaded`; no `finalized` event exists. Retain `91-neg-stale-revision`.

### 7.8 Revoked site grant mid-flow (Site A admin)

Run after §6.8 on a fresh supplementary row so the positive chain is untouched: prepare `staging-hfo-proof:prepare-revoke:0001` (`filename: "panel-revoke.png"`, correct md5), PUT, `uploaded` (expect `200`). Then revoke the grant in SQL:

```sql
UPDATE public.user_facility_access SET revoked_at = now(), revoked_by = '<CORP_UID>'
WHERE user_id = '<ADMIN_UID>' AND facility_id = '00000000-0000-4000-8000-5f0000000002' AND revoked_at IS NULL;
```

Then, with the **same** cookie and token:

```http
POST <APP_URL>/api/admin/operations/evidence/<EVIDENCE_ID_3>/finalize
Cookie: <COOKIE_ADMIN>
Content-Type: application/json

{"request_key":"staging-hfo-proof:finalize-revoked:0001","expected_receipt_revision":"<RECEIPT_REVISION>","payload":{}}
```

Expected: a refusal, one of: `401 {"error":"Sign in again to continue."}` if the 326 authority-version trigger bumped the profile's `auth_claim_version` on the grant change (the pre-request guard then rejects the old token, `326:777-781`), or `404 {"error":"Evidence not found","outcome":"missing"}` (facility access false, row invisible), or `403 {"error":"Operation unavailable","outcome":"denied"}` from `lock_operation_work_authority` (`341:323-330`). Which of the three the stack produces first is **NOT DETERMINED FROM SOURCE** for a live grant change; record the observed one. Also confirm the finalized object of §6.8 is no longer downloadable by this user (`GET .../evidence/<EVIDENCE_ID>/download` → `401`/`404`). Then restore:

```sql
UPDATE public.user_facility_access SET revoked_at = NULL, revoked_by = NULL
WHERE user_id = '<ADMIN_UID>' AND facility_id = '00000000-0000-4000-8000-5f0000000002';
```

Sign in again for any further admin calls (the old token may now be stale). The abandoned `<EVIDENCE_ID_3>` row stays `uploaded`: it attaches to nothing and blocks nothing (engineering-contracts §3, actor rule). Retain `92-neg-revoked-finalize`, `93-neg-revoked-download`.

### 7.9 Anon key without a session

```http
POST <APP_URL>/api/admin/operations/evidence
Content-Type: application/json

{"receipt_id":"<RECEIPT_ID>","request_key":"staging-hfo-proof:neg-anon:0001","payload":{"kind":"photo","filename":"x.png","mime":"image/png","size_bytes":70,"md5":"b357a19c87624c7c4d131aeeb4ae677f"}}
```

Expected: `401 {"error":"Not authenticated"}` (`current-api-actor.ts:126-128`). Direct RPC with only the anon key:

```http
POST <STAGING_URL>/rest/v1/rpc/prepare_operation_evidence_review
apikey: <ANON_KEY>
Authorization: Bearer <ANON_KEY>
Content-Type: application/json

{"p_receipt":"<RECEIPT_ID>","p_request_key":"staging-hfo-proof:neg-anon:0002","p_payload":{"kind":"photo","filename":"x.png","mime":"image/png","size_bytes":70}}
```

Expected: `401` (EXECUTE is revoked from `anon`, `343:652-655`; PostgREST reports permission denied for the anon role as 401). Storage without a token:

```http
POST <STAGING_URL>/storage/v1/object/sign/operation-evidence/<OBJECT_PATH>
apikey: <ANON_KEY>
Content-Type: application/json

{"expiresIn":60}
```

Expected: `400`/`401`/`403`; record. Retain `94-neg-anon-route`, `95-neg-anon-rpc`, `96-neg-anon-storage`.

---

## 8. Cleanup

### 8.1 Objects (Storage API as service role; the policies forbid client delete, `343:228`)

```http
DELETE <STAGING_URL>/storage/v1/object/operation-evidence
apikey: <SERVICE_ROLE_KEY>
Authorization: Bearer <SERVICE_ROLE_KEY>
Content-Type: application/json

{"prefixes":["<OBJECT_PATH>","<OBJECT_PATH_2>","<OBJECT_PATH_3>"]}
```

List the exact paths first: `SELECT name FROM storage.objects WHERE bucket_id='operation-evidence'`. Expected `200`; then `SELECT count(*) FROM storage.objects WHERE bucket_id='operation-evidence'` → `0`. Do not retain this request in the proof directory (it carries the service key); note only "objects deleted, count 0" in `RESULT.md`.

### 8.2 Rows that cannot be deleted by design

`operation_evidence`, `operation_evidence_events`, `operation_execution_receipts`, `operation_issues` and the audit tables refuse DELETE and TRUNCATE for every role, including `postgres`, through their guard triggers (`343:132,151`, `341:177-184` and the truncate guards). This is intended: evidence and receipts are immutable history. Two options:

- **Option A: keep as immutable history.** Leave the evidence, event, receipt and occurrence rows. Deactivate the fixture actors and hide the fixture sites:

  ```sql
  BEGIN;
  UPDATE public.user_facility_access SET revoked_at = now(), revoked_by = '<CORP_UID>' WHERE user_id IN ('<ADMIN_UID>','<ASSISTANT_UID>','<CORP_UID>','<SITEB_UID>') AND revoked_at IS NULL;
  UPDATE public.operation_subject_access SET revoked_at = now() WHERE reason LIKE 'staging-hfo-proof%' AND revoked_at IS NULL;
  UPDATE public.user_profiles SET is_active = false WHERE email LIKE 'staging-hfo-proof+%';
  UPDATE public.facilities SET deleted_at = now() WHERE name LIKE 'staging-hfo-proof%';
  UPDATE public.entities SET deleted_at = now() WHERE name LIKE 'staging-hfo-proof%';
  COMMIT;
  ```

  Then delete the four Auth users through the admin API (`DELETE <STAGING_URL>/auth/v1/admin/users/<uid>` with the service key). Note: `user_profiles.id` references `auth.users(id)` and the receipts reference `user_profiles`; if the Auth delete fails on the foreign key, leave the Auth users disabled (`banned_until` far future) instead and record it. **Consequence:** later HFO migrations with "nothing exists yet" pre-apply checks (as 341 and 343 have; 352/353 may have their own) will refuse to apply on this staging project, and the fixture evidence remains in staging history forever.

- **Option B: reset the staging project.** Restore staging from the backup taken before §2.5 (or delete and re-create the staging project), so the next integration rehearsal starts from a clean ledger at 335.

**Recommendation: Option B.** Staging exists to rehearse apply and proof; a disposable reset keeps every future pre-apply check meaningful and leaves no synthetic evidence rows that could be mistaken for history. Use Option A only if the staging project is shared with another rehearsal that must survive. Whichever is chosen goes into `RESULT.md`.

### 8.3 Verification that no fixture rows remain outside history tables (after Option A)

History tables are excluded on purpose (`operation_evidence`, `operation_evidence_events`, `operation_execution_receipts`, `operation_issues`, `operation_task_instances`, `operation_audit_log`, `audit_log`).

```sql
SELECT 'objects' AS what, count(*) FROM storage.objects WHERE bucket_id = 'operation-evidence'
UNION ALL SELECT 'active profiles', count(*) FROM public.user_profiles WHERE email LIKE 'staging-hfo-proof+%' AND is_active
UNION ALL SELECT 'live site grants', count(*) FROM public.user_facility_access g JOIN public.user_profiles p ON p.id = g.user_id WHERE p.email LIKE 'staging-hfo-proof+%' AND g.revoked_at IS NULL
UNION ALL SELECT 'live subject grants', count(*) FROM public.operation_subject_access WHERE reason LIKE 'staging-hfo-proof%' AND revoked_at IS NULL
UNION ALL SELECT 'live facilities', count(*) FROM public.facilities WHERE name LIKE 'staging-hfo-proof%' AND deleted_at IS NULL
UNION ALL SELECT 'live entities', count(*) FROM public.entities WHERE name LIKE 'staging-hfo-proof%' AND deleted_at IS NULL;
-- Expected: every count = 0.

-- Inventory of what stays as history (for the record only):
SELECT 'evidence' AS what, count(*) FROM public.operation_evidence WHERE facility_id = '00000000-0000-4000-8000-5f0000000002'
UNION ALL SELECT 'evidence events', count(*) FROM public.operation_evidence_events WHERE facility_id = '00000000-0000-4000-8000-5f0000000002'
UNION ALL SELECT 'receipts', count(*) FROM public.operation_execution_receipts WHERE facility_id = '00000000-0000-4000-8000-5f0000000002'
UNION ALL SELECT 'occurrences', count(*) FROM public.operation_task_instances WHERE facility_id = '00000000-0000-4000-8000-5f0000000002';
```

After Option B the check is §3.1 (ledger back at 335) plus `SELECT count(*) FROM public.facilities WHERE name LIKE 'staging-hfo-proof%'` → `0`.

---

## 9. Sign-off record

Create `docs/facility-operations/col143-evidence/hosted-proof/RESULT.md` with exactly these sections. **COL-143 closes in Linear only after this file exists with every step of §6 marked PASS, the eTag/owner confirmation of §6.6 recorded as MD5-equal and owner non-null, every §7 case marked REFUSED with its observed status, and a second person's review line.** A partial or aborted run is recorded under "Aborted" and does not close the issue.

```markdown
# COL-143 hosted Storage proof — RESULT

- Staging project ref: <STAGING_REF>  (confirmed ≠ manfqmasfqppukpobpld)
- Integration branch and head SHA: codex/hfo-staging-integration @ <SHA>
- App instance: <APP_URL> built from the same SHA (`git rev-parse HEAD`)
- Migrations applied (ledger before → after): 335 → 353; list: 336 finance_source_commands … 353 <stem>
- Ledger written by: supabase db push | manual INSERT
- 343 amendment present on the applied stack (declared_md5): yes | no
- Auth hook haven_custom_access_token_hook enabled on staging: yes | no
- Tester: <name>, second reviewer: <name>
- Run window (UTC): <start> → <end>

## Step status
| Step | Description | Status | Timestamp (UTC) | Retained file(s) | Observed status/notes |
| 3.1 | Ledger before | PASS/FAIL | | 00-ledger-before.txt | |
| 2.5 | Apply 336–353 | | | 01-ledger-after.txt | |
| 3.3 | Schema probe | | | 02-schema-probe.txt | |
| 4.x | Fixture created (ids) | | | | entity/site/activity/subject ids; version, config, occurrence ids |
| 6.2 | Record → performed_missing_evidence | | | 20-record.* | receipt id, revision |
| 6.3 | Prepare → signed upload URL | | | 30-prepare.* | evidence id, object path |
| 6.4 | Storage PUT 200 | | | 31-storage-put.* | response body verbatim |
| 6.5/6.6 | owner non-null; eTag == MD5 | | | 32-, 33- | owner uuid seen: yes/no; eTag value as stored |
| 6.7 | uploaded (checksum_verified) | | | 40-uploaded.* | outcome value seen |
| 7.3 | non-uploader refused | | | 83-85 | |
| 7.4 | corporate unfinalized download refused | | | 86-87 | |
| 7.7 | stale revision 409 | | | 91 | |
| 6.8 | finalize → completed | | | 50-, 51- | satisfaction JSON |
| 6.9 | receipts evidence_status_current complete | | | 60- | |
| 6.10 | corporate download 200, length 70, image/png | | | 70-, 71-, 72- | |
| 7.1 | other-site prepare 404/403 | | | 80 | |
| 7.2 | other-site Storage write refused | | | 81-82 | status codes |
| 7.5 | write after finalization refused | | | 88-90 | |
| 7.6 | checksum mismatch 409 / row failed | | | | or "not exercised: amendment absent" |
| 7.8 | revoked grant → refused | | | 92-93 | which refusal (401/403/404) |
| 7.9 | anon → 401 | | | 94-96 | |
| 8 | Cleanup option and verification | | | | A or B; §8.3 output |

## Facts observed that the repository could not determine (Appendix A items)
- Storage signed-upload response body: …
- Storage sign endpoint response key: …
- Storage refusal status codes: …
- eTag format as stored: …

## Aborted (if applicable)
- Step, observation, ledger state, what was reset.

## Review
- Reviewed by <name> on <date>: the retained files contain no tokens, cookies, keys or object bytes (grep for "eyJ", "token=", "apikey", "Cookie:" returned only <REDACTED>).
```

Before committing the proof directory, run from the repository root:

```bash
grep -rEl 'eyJ[A-Za-z0-9_-]{20,}|token=[^<]|apikey: [^<]|Cookie: [^<]' docs/facility-operations/col143-evidence/hosted-proof/ && echo "SECRETS PRESENT: fix before commit" || echo "clean"
npm run check:secrets
```

---

## Appendix A. Facts not determined from the repository

These must be observed on staging and written into `RESULT.md`; do not assume them.

1. The JSON body the Storage service returns for a successful signed-URL `PUT` (§6.4).
2. The response key name of `POST /storage/v1/object/sign/...` (the SDK reads `signedURL`) and of `POST /storage/v1/object/upload/sign/...` (§6.6, §7.2).
3. The exact HTTP status codes and bodies of Storage policy refusals (§7.2, §7.4, §7.5, §7.9): whether 400, 403 or 404.
4. Whether the hosted eTag for a single-request signed-URL upload is the plain quoted MD5 (the amendment's trust anchor) and whether `storage.objects.owner` (uuid) is populated for that upload path (§6.5–6.6). Both are the stated purpose of the proof.
5. Which refusal appears first after a live grant revocation (§7.8): stale-authorization 401, invisible-row 404, or authority 403.
6. The response envelope key of the two `/publish` routes (§4.4, §4.5), produced by `runRequirementPublication` in `src/lib/operations/requirements.ts`.
7. The final filename stem of the COL-146 command-drafts migration (branch-local 345), and whether 344/345 add their own "nothing exists yet" pre-apply checks that affect §8's recommendation.
8. Whether the staging project's `entities.entity_type` accepts the value used in §4.1 (declared as plain text at `002_core_hierarchy.sql:34`).
9. Whether the checksum amendment is present on the stack that is applied (§1.2 item 4): at the time of writing it is documented in `checksum-contracts.md` but not in `343_hfo_verified_evidence.sql` at `c7b5cc30`.
