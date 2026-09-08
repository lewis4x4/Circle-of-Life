# Reviewed aggregate CSV import

This operator CLI handles normalized standup aggregate CSVs. It does not parse the supplied January workbook layout or import prospect records. Business-definition equivalence, historical facility coverage and owner approval are not inferred from labels.

Required columns: `week_of,facility_name,metric_key`. Optional value columns: `value_numeric,value_text`; optional labels: `section_key,metric_label`. Dates use `YYYY-MM-DD`; numeric currency uses whole cents, counts use integers, hours/percent values allow two decimal places. Use `Total` explicitly for portfolio rows. Blanks remain null. Ambiguous values such as `1.21` for an event count reject for source review. No automatic totals are fabricated.

Use the existing environment variables `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service key remains in the operator environment. Do not put it in a review plan or command argument. Publication is a privileged operator action; ordinary authenticated clients cannot call the publication RPC.

## Review

```sh
node scripts/import-executive-standup-csv.mjs normalized.csv ORGANIZATION_UUID --dry-run > reviewed.json
```

The default is also dry-run. Only reads occur, with full pagination. Review added/changed/removed cells, nulls and expected versions. Completeness uses the **current active facility and metric registry**, including expected portfolio metrics. That denominator is a declared review basis, not an approved historical population. Source-as-of remains unknown. A file with only two of five facilities must not appear complete merely because all submitted cells contain numbers.

## Publish the reviewed file

```sh
node scripts/import-executive-standup-csv.mjs normalized.csv ORGANIZATION_UUID \
  --publish --plan reviewed.json \
  --definition-reference 'Actual approved mapping or domain review reference' \
  --correction-reason 'Actual reason for replacing an existing week'
```

Replace the example references with real review evidence. The plan pins active facility IDs and the full metric registry. The command rejects changed source bytes, row mappings or registry/coverage context. The database revalidates mappings and expected versions while publishing. If another editor changed a week, generate and review a new plan. A retry of an already committed identical file returns its original receipt without another import. Reusing a fingerprint with changed parsed data or definition reference rejects.

All weeks, metrics, prior-version archives and the receipt commit together. Any error rolls back the entire file. Corrections soft-delete replaced metric rows and preserve a full original header/metric archive. Original source records remain attached as provenance. A correction clears the prior PDF attachment on the current snapshot; its original path remains in the archive.

## Retrieve correction evidence

Authorized organization owners/admins can read `exec_standup_snapshot_versions`, scoped by `organization_id` and `snapshot_id`, ordered by `published_version`. `header_json` is the original snapshot header; `metrics_json` preserves the original metric records. Filter original metric records by `deleted_at IS NULL` to reconstruct that revision's active values. `exec_standup_import_receipts` provides the file fingerprint, parsed evidence and immutable result.

These archive reads are restricted to organization owners/admins because the stored JSON includes the portfolio. The same restriction applies to their audit payloads. Existing snapshot IDs and current-week links remain stable. A dedicated leadership revision picker, version-pinned PDF/board-packet retrieval and protection of every non-import publication path remain follow-on HCOL-05 work.

## Verification

```sh
HCOL_TEST_RUN_DIR=/absolute/run-owned/scratch node --test scripts/import-executive-standup-csv.test.mjs
npm run migrations:verify:pg
npm run typecheck
npm run segment:gates -- --segment hcol-reviewed-csv
```

Create and record scratch provenance before running the CLI fixture. The SQL probe `supabase/tests/review_standup_import.sql` is synthetic and rolls back. Do not run probes against production.

The legacy Python workbook importer is a separate path and has not been converted to this protocol. Do not use it to correct published history. Full HCOL-02/03/05 acceptance remains open beyond this bounded CSV segment.
