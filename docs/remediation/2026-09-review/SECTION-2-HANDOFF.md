# Haven Section 2 independent review handoff

Status: implementation complete; all six corrected entries remain review-pending. Scope is exactly SYS-002, SYS-003, SYS-004, NAV-003, NAV-009, FL-015. Stop for independent GPT-6 Astra High review; no PR, merge, deployment, hosted migration application or Section 3.

Approved baseline: `5686876cb7917c0a809f0adb7e9ba67b595a3e03`, independently approved per the user prerequisite. Freshly fetched origin Section 1 matched it before edits. Dedicated worktree `/Users/brianlewis/Circle of Life/Haven Section 2`, branch `codex/haven-section-2-database-rounding`. Original checkout and unrelated untracked Brand Guide / review gate files retained.

Read-only hosted migration version/name metadata and local inventory are recorded in `section-2-baseline.json`. Both numbered chains end at 329; local baseline has 332 migration files. Historical timestamps retained. Section 2 uses forward 330–332. No hosted customer rows read or hosted writes made.

## Segment 2A: SYS-002 and FL-015

Mission alignment: pass at source level. The quality view now executes with caller RLS; base result SELECT matches normative quality roles (owner, org_admin, facility_admin, nurse), current actor and accessible facilities. The latest result is greatest period_end, then greatest created_at, then descending UUID for equal creation timestamps. UUID ordering is a stable tie-break, not a claim of clinical chronology. A correction is inserted with a later creation time; all prior values and audit remain. Existing result-entry/import producer remains deferred per Module 10.

Before correction, `review_section2_quality.sql` reproduced four no-profile disclosed synthetic rows and two current rows for one corrected period, then failed the denial assertion (`section-2-quality-before.log`). After correction the same probe passed (`section-2-quality-after.log`): no profile, foreign tenant, disjoint facilities, six roles, fresh-version revoked grant, disabled account, latest period, same-period corrections, equal-time tie, deleted correction fallback, retained history.

Validation: focused Vitest 3 files / 38 passed / 0 failed; `npm run typecheck -- --incremental false` passed. Required `section-2a-quality` gate passed at `test-results/agent-gates/2026-09-07T21-08-14-258Z-section-2a-quality.json`, including native PostgreSQL replay with Supabase stubs, production build, lint, security and stress checks. UI checks are inapplicable to this SQL-only segment. Exact replay counts are in the gate JSON. No gate failure for this segment; the intentional red regression remains retained.

Local database proof is PostgreSQL with synthetic fixtures and Supabase Auth stubs, not signed-token hosted PostgREST or staff UAT. Independent review remains required.

## Segment 2B: SYS-003 and SYS-004

Mission alignment: pass at source level. Migration 331 preserves the approved core function body exactly, moving it to private `haven.complete_rounding_task_core` and revoking direct API execution. `section-2-core-preservation.json` records the body hash and unchanged authoritative-helper migrations. Its public service-only wrapper checks current actor/session/version, live facility/staff and assignment before returning or creating a receipt. A request UUID binds actor, staff, organization, facility, task and normalized clinical payload. Original time and clinical content remain stable; delivery metadata does not affect retry equivalence. Log, exception, task completion, integrity flags, receipt and audit commit or roll back together. Competing requests cannot create a second log. Existing late-entry/velocity/identical-payload thresholds are retained, with staff/facility serialization for concurrent detection.

The browser and caregiver page generate identity and observation time before first submission. Network fallback preserves the payload; the worker reuses it and removes only an acknowledged success. Legacy outbox records use their queue ID. Genuine conflicts remain for reconciliation. The compact drawer can collect a late-entry reason if an unsaved retry ages beyond the existing five-minute threshold. A saved live receipt is returned before time-dependent validation, so an exact retry needs no new reason.

Authenticated users cannot insert/update logs, insert/delete tasks, or edit protected task fields. Managers retain their own attributed, nonblank-reason excusal. Invoker guards prevent delayed manager/service updates from overwriting completed evidence. Logs and receipts reject updates/deletes even with accidental future grants. Historical observation records remain unchanged. No append-only amendment UI is added; future corrections need a reviewed attributable command.

Reproduction: `section-2-rounding-before.txt` retains three baseline notices: exact retry rejected after the atomic core committed, late integrity evidence absent from that transaction, and assigned caregiver direct task finalization/log time rewrite. `section-2-client-before.txt` retains two failed identity assertions before client corrections. Existing core atomicity is explicitly recognized, not misreported as absent.

Validation on final segment source:

- Focused rounding/PWA/API/caregiver tests: **29 files, 288 passed, 0 failed**.
- Full Vitest: **527 files, 3,237 passed, 2 pre-existing opt-in performance skips, 0 failed**.
- `npm run typecheck -- --incremental false` and full `npm run lint`: **PASS**.
- Local replay: **334 migrations, 16 SQL probes PASS**. Rounding SQL regression: **149 named PASS assertions**, including six-role protected-field matrix and rollback at each of six write stages; output in `section-2-rounding-after.txt`.
- Independent Python multi-connection runner: **4 cases PASS**, recorded in `section-2-concurrency.json`: six identical retries yield one log/exception/flag/receipt; different keys yield one success and one conflict; three tasks cross a velocity threshold with three late flags plus one pattern flag; concurrent grant revocation rejects with zero writes.
- Required final UI gate: **PASS**, `test-results/agent-gates/2026-09-07T21-32-47-720Z-section-2b-rounding-final.json`. Twelve checks passed, only absent `apps/web` skipped; required native replay, build, lint, security, stress, design and axe passed. The earlier passing `2026-09-07T21-29-10-136Z-section-2b-rounding.json` precedes the final late-reason recovery verification and is retained as intermediate evidence.
- Public preview design checks cover four viewport screenshots of `/`; axe covers `/`. Authenticated rounding behavior is proven with rendered orchestration tests and local SQL, not claimed as authenticated browser/hosted acceptance.

Limitations: paired migration/application deployment is required after independent review. New online requests without identity/time are rejected; existing legacy queued records are supported. Pre-migration completions have no retroactively fabricated receipt and may require outbox reconciliation. Observation timestamps must be finite and not future-dated relative to database time. Watch lifecycle/plan-save multi-statement workflows and external escalation delivery are unchanged. Hosted Auth/PostgREST, real device disconnection and clinical staff UAT remain unverified.

## Segment 2C: NAV-003 and NAV-009

Mission alignment: pass at source level. The resident index trigger now updates organization and facility in the same source transaction. Migration 332 repairs stale identity/scope/search content, backfills missing resident rows, mirrors soft deletion and retires orphan index entries without deleting history. It leaves other producers' rows intact. Resident index reads also require a matching, currently authorized resident row under caller RLS, including family linkage. A stale external index entry cannot authorize resident disclosure.

Unified Search explicitly searches resident names only. Its supported-source catalog opens staff search, the vendor directory and incident records through verified canonical module paths. Those links remain available beside results. Empty results are resident-specific; database errors remain errors; obsolete query responses cannot replace the current results. Missing staff/vendor/incident indexing is disclosed and remains outside this resident index, rather than inventing unverified producers.

`section-2-search-before.txt` reproduces a stale transfer scope and one former-facility identity disclosure. `section-2-search-ui-before.txt` retains four failing rendered assertions before correction. `section-2-search-after.txt` has **15 named PASS assertions** for facility/tenant transfers, current source equality, grants/revocation, stale index defense, family linkage and revocation, soft deletion/restoration, disable and no-profile access. `section-2-search-backfill.json` records **5 passed assertions against the actual migration SQL**: scope/content repair, missing-row creation, soft deletion, orphan retirement and byte-for-byte preservation of another producer's row.

Final combined focused run: **33 files, 331 passed, 0 failed**. Final full Vitest: **528 files, 3,242 passed, 2 existing opt-in performance skips, 0 failed**. Repository typecheck passed. The final native replay passed **335 migrations and 17 SQL probes**. Strict final UI gate passed **12 checks, 0 failures, 1 absent-apps/web skip** at `test-results/agent-gates/2026-09-07T21-46-15-507Z-section-2c-search-final.json`.

The failed `test-results/agent-gates/2026-09-07T21-42-38-327Z-section-2c-search.json` is retained: one required lint warning about a changing ref in effect cleanup. A shared cancellation callback replaced that cleanup pattern; focused tests, full suite, typecheck and the strict gate were rerun. No check was waived or downgraded. Its other 11 checks passed and do not replace the final gate.

## Independent GPT-6 Astra High review request

Review **only Section 2** on `codex/haven-section-2-database-rounding`, compared with approved source `5686876cb7917c0a809f0adb7e9ba67b595a3e03`. Use a fresh independent context. The implementation commits are bounded quality, rounding and search segments. Resolve and record the immutable review head with `git rev-parse origin/codex/haven-section-2-database-rounding` after fetching. Do not treat later branch movement as reviewed. The complete changed-file inventory and machine-readable checks are in `section-2-verification.json`.

The prerequisite approval is the user's explicit attestation; this task verified the exact supplied Section 1 head against fetched origin before editing. Do not reinterpret the inherited Section 1 review-pending ledger labels as authorization to reopen or alter Section 1. Only the six requested Section 2 finding objects changed in roadmap-status.json; every other entry and top-level field is preserved, including inherited historical stop text. This handoff and the user's Section 2 instruction define this task's stop boundary.

Review acceptance:

1. Challenge quality-view caller RLS and correction ordering together. Verify tenant/facility/role boundaries and whether the documented `period_end DESC, created_at DESC, id DESC` correction rule is acceptable. Equal-time UUID ordering is a deterministic tie-break, not inferred clinical chronology; historical data remains intact.
2. Inspect the preserved private rounding core and immutable receipt wrapper. Confirm current authority precedes replay; changed actor/task/payload conflicts; concurrent identical requests settle once; every integrity/audit failure rolls back all completion state. Challenge the request/task/staff lock order and the SQL translation of existing detection rules.
3. Attempt ordinary role mutations of protected task/log/receipt fields. Confirm manager excusal and existing reassignment still function, terminal clinical evidence survives stale updates, and no untrusted request setting can authorize an internal command.
4. Trace both online clients through lost response, retry, delayed reason recovery, offline queue delivery and acknowledgment. Pre-migration completed observations have no invented receipts; genuine legacy conflicts remain for reconciliation. Check finite/nonfuture time validation and clock-alignment implications.
5. Verify actual resident transfer/backfill and live source authorization, including revoked family links; confirm other index producers' rows are preserved. Confirm source-specific search claims, failure/empty separation and real module navigation.

Reproduce with `npm ci`, `npm run typecheck -- --incremental false`, `npx vitest run`, and `REQUIRE_PG_VERIFY=1 npm run migrations:verify:pg` in an isolated checkout. The latter supports a fresh Docker PostgreSQL 17 replay or a run-owned native cluster configured through `PG_VERIFY_NATIVE_SOCKET`, `PG_VERIFY_NATIVE_PORT` and `PG_VERIFY_NATIVE_BIN`. Native sockets must sit beneath `~/.hermes/tmp/agent-runs/<run-id>` with a private manifest containing matching `created_by: codex` and `run_id`; never use a hosted/application DSN. On that fresh native cluster, run `python3 scripts/verify-rounding-concurrency.py` and `python3 scripts/verify-search-backfill.py`. Each creates/drops only its own disposable databases. Run `npm run segment:gates -- --segment section-2-independent-review --ui` with required local replay configured. Inspect retained red artifacts before evaluating green receipts.

Return APPROVE or REQUEST CHANGES with severity, reproducible trigger, source location, evidence and exact required correction. This handoff is an implementation submission, not its independent approval. Do not create a PR, merge, deploy, apply hosted migrations or begin Section 3.

## Remaining boundaries

All evidence is local source/runtime proof. The final read-only hosted ledger recheck still has no numbered migration 330 or later; Section 2 is unapplied. Hosted signed-token Auth/PostgREST behavior, real offline-device recovery, external producer compatibility and named-user clinical/customer UAT remain unverified. The UI gates cover the public preview root at four viewports plus root axe; rendered authenticated-workflow tests are not authenticated browser UAT. Existing module-specific searches remain separate until their indexing is deliberately implemented. Historical corrections, audit evidence and facility boundaries are retained.

Run cleanup: the isolated PostgreSQL server was stopped. Storage Steward validated private manifests before exact run-owned deletion of 3,510 files and 28 empty directories. Private provenance/cleanup manifests remain; the review worktree, installed dependencies and build output are retained. See `section-2-cleanup.json`.
