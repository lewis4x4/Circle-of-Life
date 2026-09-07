# Haven Section 2 independent review handoff

Status: implementation in progress; all corrected entries remain review-pending. Scope is exactly SYS-002, SYS-003, SYS-004, NAV-003, NAV-009, FL-015. Stop for independent GPT-6 Astra High review; no PR, merge, deployment, hosted migration application or Section 3.

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
