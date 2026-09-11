# Stand Up bridge and Monday pilot

This segment adds `/admin/stand-up` in Haven and `/stand-up` in Front Office. Legacy executive debt snapshots remain separate. All facility entries are **reported**, not automatically source-verified.

## Monday operator rehearsal

1. Use an authorized owner, organization administrator or facility administrator. Open **Command → Weekly Stand Up** in Haven. Facility users see only permitted facilities; organization administrators can stage history and make reasoned historical corrections.
2. Sunday opens the upcoming Monday report; otherwise the current Monday is selected. Staffing covers the preceding Monday–Sunday. Save a draft, enter or confirm the sixteen fields, then mark Ready after the staffing period closes. Ready does not certify staffing verification. Blank means missing; enter 0 for a genuine zero.
3. Confirm the facility, Monday date, last-week staffing period, save receipt and reporting coverage. Test a wrong-role account and another facility before broad rollout.
4. Download the saved report's canonical JSON or CSV. The CSV uses integer cents for rent roll. Make a test edit in that copy, upload it, inspect baseline/Haven/file values, resolve each conflict and explicitly confirm clears. Do not edit another facility/week or replace the baseline identifier.
5. For outage rehearsal, make one change in Haven and a different change in the fallback. Verify compatible changes merge. Change the same field differently in both and verify that review is required. Save another Haven revision after preview and verify stale application is refused. Repeat an uncertain save with the same request to retrieve its receipt.
6. Confirm Front Office displays reporting week, facility coverage, source time (or Unknown), missing figures and unverified status. A full transport snapshot is not proof that every facility submitted.
7. Sign off actual staff/provider results separately from the synthetic/native test reports. Keep current forms available until the full live rehearsal passes.

## Historical import

The parser uses only Python's standard library and never executes formulas. It preserves source identity, sheet/range and schema version. It rejects ambiguous layouts, input formulas/errors, duplicate facility-weeks, fractional counts/cents, and non-Monday report dates. Old combined metrics are held for mapping rather than reinterpreted. Empty future blocks are not imported as zero-valued reports.

Create a local JSON mapping of the exact five source headers (`Homewood`, `Oakridge`, `Rising Oaks`, `Plantation`, `Grande Cypress`) to verified Haven facility UUIDs. Never infer UUIDs from column order.

```sh
python3 scripts/stand-up/workbook.py /private/path/standup.xlsx \
  --facility-map /private/path/facility-map.json \
  --file-id ORIGINAL_DRIVE_FILE_ID \
  --sheet September --week 2026-09-07 \
  --output /private/path/september7-review.json
```

Output is an API-compatible historical staging payload (`rows`, `reason`, `provenance`, `issues`), not a production import. Upload through Haven's Historical import section. Review the staged rows, then publish. Existing report versions require explicit correction; repeated imports cannot overwrite by accident. Use the batch ID and a reason to reverse a batch through audited supersession. Later independent edits are preserved and reported as conflicts.

The actual 2026 workbook contains dates/fields requiring review outside the sampled September 7 packet, and the 2025 workbook contains both September and September (NEW). Do not select an entire year and clear those errors automatically. Explicit sheet/week selection narrows the intended import and preserves other source data.

## Google and publisher configuration

No unattended Google OAuth connection was present during discovery/build. Browser sign-in is not an integration credential. Missing configuration leaves the worker inactive; local recovery tests do not prove Google activation.

Set these variables privately on the worker host, never in frontend-prefixed variables or source control:

```text
NEXT_PUBLIC_SUPABASE_ANON_KEY=
HAVEN_STAND_UP_REFRESH_TOKEN=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
STAND_UP_REHEARSAL_FILE_ID=
STAND_UP_PRODUCTION_FILE_ID=
STAND_UP_PROVIDER_PROOF=
FRONT_OFFICE_INGEST_KEY_ID=
FRONT_OFFICE_INGEST_SECRET=
```

Haven credentials represent an explicitly authorized reporting operator, not a fabricated identity. Use a dedicated login session for that operator; do not copy the refresh token from a browser session that will also refresh it. Tokens rotate into the private state file before business operations. The bridge requires access to all five reviewed mapped facilities. Host URLs are pinned to Haven and Front Office; redirects are refused. Front Office never receives a Haven credential or resident/employee details.

Use a separate state directory per Google file, mode 0700, outside the repository. State files contain tokens, immutable baseline references and durable pending operations; restrict backup access accordingly. Do not delete/reset state to clear an uncertain outcome or reset a source sequence.

```sh
python3 scripts/stand-up/worker.py \
  --state-dir /private/stand-up-rehearsal \
  --facility-map /private/path/facility-map.json --mode rehearsal --probe-google
```

The rehearsal ID and production ID must be different. The probe tests rejection of an invalid If-Match, a unique-byte write resolved by fresh readback, and restoration of exact original bytes. It changes only a ZIP comment in the rehearsal copy and retains restoration evidence on interruption. Lack of ETag/412 support keeps overwrites disabled. Provider capability is established only by this real test, not an assumption about Google APIs.

Then run a rehearsal input change and open it in the actual Excel/Google viewer. Confirm totals/average rent recalculate and layout/formatting remain usable. Record that evidence and set `recalculation_verified: true` in the private provider-proof JSON only after that observation. The patcher preserves formulas and requests full recalculation on open; it does not claim cached formula results have already recalculated. Production mode requires both automated provider proof and that recorded observation.

```sh
python3 scripts/stand-up/worker.py \
  --state-dir /private/stand-up-rehearsal \
  --facility-map /private/path/facility-map.json --mode rehearsal \
  --google --adopt file
```

First adoption is an explicit authority decision. `--adopt file` imports source values through authenticated versioned saves; `--adopt haven` starts from the reviewed Haven values. Omit `--adopt` on subsequent runs. Do not use either to bypass later conflicts. Unmapped or absent weekly blocks stop the Google lane without modifying the source file.

After registration through Front Office's disabled-only `scripts/register-stand-up.mjs` and approved source/key/dataset activation:

```sh
python3 scripts/stand-up/worker.py \
  --state-dir /private/stand-up-production \
  --facility-map /private/path/facility-map.json --mode production \
  --google --publish
```

Run the once-only command under an approved supervisor at the desired interval (proposed one minute; not an established SLA). Google and Front Office lanes report independent results. Google mapping errors, conflict review, or outages must not prevent the publisher from reading current Haven values. Nonzero exit requires operator attention; log metadata only. The implementation does not install a scheduler or create credentials automatically.

## Recovery and restart behavior

- Before a remote write, persist the exact body, expected source version/ETag and intended baseline.
- On a lost Google response, read back the exact resulting file digest. If still at the original digest, retry conditionally. If neither original nor intended, stop and preserve evidence; never overwrite unknown edits.
- Definite conditional rejection does not advance the baseline. Subsequent runs compare the newly read file against the old immutable baseline.
- Haven conflicts/clears appear in the same operator's pending recovery queue. Choosing Haven or rejecting a clear is recorded as an immutable decision. The worker matches that decision to the exact baseline and incoming values, then updates the file conditionally and advances the baseline only after readback. A later independent Haven edit is preserved. State deletion is not conflict resolution.
- On rollover the Google lane checks retained baseline weeks for file edits and processes that backlog before the current week. A missing or changed old layout is a visible review requirement, not a silent discard.
- Front Office retries use identical batch ID/body/sequence after an unknown result. Registration/sequence rejection remains an operator configuration issue, not a reason to claim successful synchronization.
- A restored worker with older state must reconcile server receipts/sequence before resuming. One active supervisor owns the private state lock; do not run duplicate hosts with copied state.

## Checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/stand-up -p 'test_*.py'
npx vitest run src/lib/stand-up src/components/stand-up src/app/api/stand-up
```

Native PostgreSQL probes are in `supabase/tests/review_stand_up_pilot.sql`; use the repository's native run-owned replay path. No local Docker is required. Full segment gates, source/hosted migration parity, browser/a11y and provider/staff results belong in the release evidence.

For operational rollback, restore the preceding Netlify deployment and run `scripts/stand-up/disable-pilot.sql` against the verified Haven project. It removes entry/export access without deleting history. Stop the bridge supervisor first and retain its pending state. Front Office has a matching `docs/operations/stand-up-disable.sql`.

Google reference: https://developers.google.com/workspace/drive/api/guides/manage-uploads and https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update. These document binary file updates, not acceptance of our concurrency/recalculation behavior; the rehearsal above remains mandatory.
