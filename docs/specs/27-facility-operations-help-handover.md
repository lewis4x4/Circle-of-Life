# HFO-16 — Task help, local duties and replacement handover

Bounded source contract for COL-153. This adds optional guidance and an attributable local duty ledger to the existing site work surface. It does not establish Homewood operating policy, activate a schedule, grant access, or change task/receipt/issue history.

## Authority and readiness

Live Linear checked September 12, 2026 UTC: COL-153 was Backlog; its direct prerequisites COL-135, COL-148 and COL-144 were Done for source delivery. COL-143 remains In Progress for hosted Storage proof. The source base is `codex/hfo-col159-dietary-admin` at `205ac0305473acdf8f0aba3e50ae17b3d7f4b345`, with the prerequisite implementations present. HFO draft PRs remain unmerged. See the retained readiness JSON under `docs/facility-operations/col153-evidence/`.

Migration 349 is provisional on the HFO stack. Main independently has stand-up migrations 336–338. This segment does not renumber existing migrations or claim that the stack can be applied to main or a hosted database unchanged.

## Behavior

- A staff member may open Help and handover from a task. Routine completion does not require opening or acknowledging help.
- Concise how-to, examples and contact text are versioned supplemental guidance for this activity at this site. Older versions remain available. The task's pinned central/local requirement references remain distinct and unchanged.
- Sensitive procedure attachments use existing authenticated document access. No new public object URL or document access grant is created by a help reference.
- A manager may propose an explicit local duty scope, owner, optional backup and effective time. No staff identity or duty scope is inferred from workbook names, job titles or Q02.
- Owner and backup acceptance are attributable to the nominated person's own authenticated action. A proposal is not accepted coverage; an effective time does not imply acceptance. Prior proposals and acceptances remain available with their event times.
- Handover displays open activity occurrences and issues through current authorization. It does not reassign historical recorders, resolve issues, complete work, or grant the replacement access. Current role/site permissions continue to govern work.
- Expired or revoked access invalidates protected reads, writes and retries. Uncertain saves cannot silently become success or a new changed command.

## Preserved unknowns

Q02: whether Homewood's “manager” is the administrator assistant, the actual duty split, and absence coverage remain unconfirmed. Local duty records require deliberate values; this delivery creates no live assignments.

Q12: representative task effort requires observation. No invented target duration, task-time estimate or mandatory training dialog is added. Staff testers and real workflow comparison remain separate acceptance work.

## Verification contract

Behavioral component and route tests cover optional help, unknown states, identity/scope boundaries, historical guidance, explicit acceptance and retry behavior. Native PostgreSQL replay with synthetic Supabase stubs covers append-only history, authorization, conflict/replay, effective timing and rollback. Independent review must assess spec coverage and security before closeout. Required segment gates run in strict mode, including the UI flag, without downgrading checks.

Local fixtures, mocked sessions and unauthenticated browser routes are labeled as such. They cannot establish hosted Auth/PostgREST/Storage behavior or staff acceptance. No merge, deployment or schedule activation is authorized.

## Rollback

Before application, abandon or revert only this segment. After any future application, preserve help and duty history and use a reviewed forward migration to retire writes; do not drop the ledger or rewrite historical requirement/receipt references. Release integration owns migration reconciliation and its rollback plan.

Mission alignment: pass for source scope; hosted and staff acceptance remain unproven.
