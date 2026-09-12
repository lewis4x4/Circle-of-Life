# COL-153 / HFO-16 — source handoff

Status: implemented, independently reviewed and verified as source only. The source-only draft PR remains unmerged.

## Scope and source

Task help, local duty split and replacement-person handover only. The isolated worktree is `/Users/brianlewis/Circle of Life/Haven Facility Help Handover`, branch `codex/hfo-col153-help-handover`, based on `codex/hfo-col159-dietary-admin` at `205ac0305473acdf8f0aba3e50ae17b3d7f4b345`.

Live Linear prerequisite states and the HFO source stack are retained in [Linear readiness](col153-evidence/linear-readiness.json) and [source readiness](col153-evidence/source-readiness.json). COL-135, COL-148 and COL-144 were Done for source delivery. COL-143's hosted Storage work remains open. COL-132's review closure was cherry-picked into the stack as `8ee6d8f2`; its migration guards are present even though its original tip is not an ancestor by SHA.

The [bounded specification](../specs/27-facility-operations-help-handover.md) records the behavior, authority and unknown-rule boundaries. Migration `349_hfo_task_help_handover.sql` is provisional on this stack; main has unrelated stand-up migrations 336–338. Reconcile the full stack before any future application.

## Delivered behavior

- Optional Task help and handover disclosure in the existing task row. Normal completion remains available without help acknowledgement.
- Versioned supplemental how-to, examples and contact, with protected procedure references and access to prior guidance. Pinned governing central/local task rules stay separate.
- Append-only local duty proposals and separate self-acceptance by owner and backup, with effective and acceptance times. Current permission is separate from historical acceptance.
- Open activity work and issues for replacement review. A handover does not complete tasks, resolve or reassign issues, change recorder identity, or grant access.
- Expected-version conflict handling and exact-request retry after uncertain saves. Shared-device actor changes discard the prior actor's in-memory state.

## Preserved boundaries

Q02's actual Homewood role/duty split and absence coverage remain unconfirmed. Q12's task-effort measurement remains unperformed. No named live assignments, operating rules, schedules, reminders or deadlines were created or activated.

Local SQL probes use synthetic users/data and Supabase stubs. Component tests use mocked sessions. The strict browser gate's unauthenticated routes do not prove the authenticated task panel. No hosted Auth/PostgREST/Storage flow or staff acceptance is claimed.

## Evidence and next action

Verification: **4,024 tests passed / two skipped**, configured typecheck and lint passed, native replay passed **352 migration files / 33 SQL probes**, and **four observed-lock races passed**. Independent review: **APPROVE**, no unresolved findings. Strict `--ui` segment gate: **PASS**, no downgrades. See [verification](col153-evidence/verification.json), [gate artifact](col153-evidence/strict-gate.json), and [independent review](col153-evidence/independent-review.json). The initial full-suite failure was an inherited wall-clock-dependent September 10 workspace test; its Date-only clock is now fixed and restored after each test. All 35 sibling worktree heads, dirty states and original dirty file hashes remained unchanged. The observed-lock concurrency script is `scripts/facility-operations/test-help-handover-concurrency.py`.

Next action: review the bounded draft PR against its HFO source base. Integration and release work must separately reconcile stacked migrations, prove real authorization/storage/recovery surfaces under COL-161, and obtain the authorized staff/operating acceptance. Do not merge or deploy this draft as part of this handoff.

Rollback before application is reverting this bounded segment. After a future application, preserve the immutable ledger and use a reviewed forward retirement migration; do not delete duty/guidance history.

Mission alignment: pass for source delivery. Hosted and staff acceptance: unproven.

The draft PR title and pushed commit carry `[skip netlify]` to keep this a source-only delivery; Netlify documents that marker for skipping branch deployments and PR previews ([official deploy controls](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)). Do not remove it during source review.
