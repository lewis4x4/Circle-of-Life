# HFO source migration reconciliation

Mission alignment: **pass**. Preserve the shared operations stack, current authority and audit history while making the source integration reviewable. This run authorizes source work and local verification only.

## Integration decision

`codex/hfo-source-migration-reconciliation` starts at existing integration `08fd3a43`, with current `origin/main` at `50bc07c4c877b65e17f471895e4446ff11c4d69c`. It reuses the reviewed integration instead of creating competing migration identities. Main, Finance `0d0e7763`, HFO `b83bf7b5`, and the existing integration remain ancestors. No existing branch was rebased, reset, force-pushed or retargeted.

The requested HFO 336–349 is already reconciled here. HFO's subsequent 350 reminders (integrated 362) and forward audit repair 363 are retained because they are part of the recorded installed boundary. This is not an authorization to expand implementation or operate reminders. Later corporate-history draft work is not imported.

**No application or SQL changes are necessary.** This run adds the reconciliation record, an executable read-only checksum verifier, and fresh local evidence. All 342 main migration files and all 366 integration migration files retain their exact bytes. Historical comments, handoffs, migration names and application manifests are preserved as historical records.

## Exact collisions and order

| Original number | Main claim | Finance draft claim | HFO draft claim → integration |
|---|---|---|---|
|336|stand_up_pilot|finance_source_commands →340|activity_catalog →347|
|337|stand_up_experience|audit_export_scope_and_snapshot →341|current_authority →348|
|338|stand_up_field_state|resident_money_snapshot →342|requirement_versions →349|
|339|officer_capability_catalog|finance_event_outbox →343|schedule_evaluator →350|
|340|—|finance_batch_approval →344|occurrences →351|
|341|—|finance_review_queue →345|execution_receipts →353|
|342|—|finance_credential_lifecycle →346|issue_lifecycle →354|
|343|—|—|verified_evidence →355|
|344|—|—|corrections →356|
|345|—|—|command_drafts →357|
|346|—|—|source_links →358|
|347|—|—|drill_generator_sources →359|
|348|—|—|dietary_admin_sources →360|
|349|—|—|task_help_handover →361|
|350 (retained extension)|—|—|in_app_reminders →362|

Exact full filenames, pinned input hashes, and all competing local `codex/` branch claims at 336–349 are in [source-check.json](source-reconciliation-evidence/source-check.json). Insurance, InsureFlow, operating-evidence and remaining-roadmap drafts remain separate; their number collisions do not authorize importing or renumbering them.

The replay order is the existing complete filename order, including the three historical timestamp migrations. Numbered main 001–339 precedes Finance 340–346, then the HFO sequence above. Do not invent fillers or move timestamp history to make it resemble a new ledger.

Dependencies that constrain that order:

- Finance 341 changes `audit_log_export_jobs.row_count` to bigint before HFO 348 installs policies referencing that column. Installing that policy first prevents the Finance type alteration.
- HFO catalog → current authority → requirement versions → evaluator → occurrences supplies the identities, grants, effective requirements and occurrence keys used by receipt and later lifecycle commands.
- 352 `audit_export_current_authority_reconcile` follows Finance's immutable export implementation and HFO authority. It preserves Finance snapshots while enforcing HFO current scope. Its original historical-number comments are retained without editing installed SQL.
- Execution receipts precede issue/evidence history, corrections, command drafts and source links. Source adapters then precede help/handover and reminders; the existing complete ordering is retained rather than attempting a minimal reordering.
- 363 `audit_export_hfo_history_scope` follows the later HFO tables/policies and extends the export predicate to their restricted history. It remains a forward repair, not an amendment to 352.

Existing source conflict resolutions remain unchanged: Finance's database-backed export handler plus HFO authorization SQL/probes; unioned clinical fixtures with Finance business dates and HFO approved catalog bindings; current main shell behavior; compatible test fixtures and tooling. The exact conflict paths and rationale are in the [original integration manifest](col217-evidence/integration-manifest.json).

## Installed-history boundary

This run reads repository evidence only. **No live ledger was queried and no hosted state was changed.** The historical COL-217 manifests report installation in separate staging; they are not fresh hosted verification or acceptance by this run.

The [timestamped source manifest](col217-evidence/staging/applied-source-manifest-20260912T234558.json) matches all 366 canonical SQL files. The [final applied manifest](col217-evidence/staging/applied-source-manifest.json) records 27 deliberate synthetic bootstrap variants, with both original and applied hashes. All 366 original hashes match this branch; all applied hashes match the variant manifest. In particular, the catalog's synthetic attribution and historical enum/seed adaptations remain separate from canonical SQL. Do not copy them over canonical migrations or repair ledger hashes to erase the distinction.

Any future installation requires separately authorized target identification, a fresh ledger and hash comparison, and an environment-specific forward plan. The draft 336–349 numbers are not installable against current main. This source report does not authorize replaying canonical seed data into existing staging or production.

## Fresh verification

See [verification.json](source-reconciliation-evidence/verification.json) for commands, exit results, revision, limits and worktree preservation evidence. Native PostgreSQL 17 runs only in a private run-owned local cluster with Supabase Auth/Storage stubs. Reproduce the source/hash check from this checkout with:

```sh
python3 docs/facility-operations/source-reconciliation-evidence/verify-source.py
```

The checker fails if fetched main moved, any canonical migration changes, any draft-to-integration bytes differ, or the historical original/applied hash records disagree. It does not connect to a database. Fresh local evidence supersedes neither the original draft histories nor separate release/acceptance issues.

No merge, deployment, hosted migration application, staff action, authenticated browser acceptance, provider activation or operating-cycle acceptance is performed or claimed. The next action is technical review of this source-only draft PR. Hosted and staff acceptance remain separate authorized work.
