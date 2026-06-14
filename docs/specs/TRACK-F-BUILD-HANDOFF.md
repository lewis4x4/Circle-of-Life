# Track F — Build Handoff (loop operating prompt)

**Status:** ACTIVE — hand this file to a fresh agent session to build Track F autonomously
**Created:** 2026-06-12
**Scope authority:** `docs/specs/UNIFIED-ROADMAP.md` §2 (Track F — Employee Workspace & Office Suite)

> **How to drive this:** in a fresh session run a loop where **each iteration = one bounded Track F segment**, e.g.
>
> ```
> /loop /ultracode Build the next unbuilt Track F segment per docs/specs/TRACK-F-BUILD-HANDOFF.md. One segment per iteration. Stop the loop if blocked on an owner decision.
> ```
>
> Dynamic pacing (no fixed interval): finish a segment → record → next iteration. `/ultracode` is the implementation pass inside each iteration; everything around it (BOOT, gates, RECORD, commit) follows this file.

---

## BOOT — read at the start of every session (not every iteration)

1. `docs/specs/UNIFIED-ROADMAP.md` §2 — Track F scope, segment tables, reuse mandate
2. `AGENTS.md` + `CODEX.md` — build rules, gate contract, commit discipline
3. `docs/Autonomous.md` — latest RECORD entry (where the last session stopped)
4. `git log -10` — recent merges
5. `ls supabase/migrations | tail -3` — confirm next free migration number (UNIFIED-ROADMAP §1 says `289`; trust the folder)

## FIND — pick the next segment

Work the Track F order from UNIFIED-ROADMAP §2:

**F1-1 → F1-2 → F1-3 → F1-4 → F2-1 → F2-2 → F2-3 → F2-4 → (F4-2, F4-3) → F3-* → F4-1 → F4-4 → F5-***

A segment is "built" when its row in the **Track F build log** (bottom of this file) shows a PASS gate artifact and commit hash. The first unbuilt row is next.

### F0 gating — **F0 RATIFIED 2026-06-12** (see UNIFIED-ROADMAP §2 F0 table for the binding positions)

All F0-gated segments (F3, F5, F2-3 publish coupling) are **unblocked**. The ratified positions are implementation requirements, not suggestions:

- **F0-1:** break-glass access (owner/org_admin, typed reason, fully audited) must ship **in the same segment** as the first private-content table — never a follow-up.
- **F0-2:** audit trigger + soft deletes + retention on all private-content tables from their first migration.
- **F0-3:** offboarding transfer/legal-hold is part of F3 scope, not optional.
- **F0-4:** publish flow is draft → submit → facility_admin/DON review → publish. No one-click share to group.
- **F0-5:** Google Drive cutover **2026-07-01** — F5 must be production-ready before that date; sequence accordingly.

**Remaining block:** F4-1 (eFax) still needs an owner vendor pick. If the next segment in order is blocked, skip to the next unblocked one; if everything remaining is blocked, stop the loop and report what's needed.

## SPEC-FIRST rule

- Before the first F1/F2/F4 segment: create **`docs/specs/35-office-suite.md`** (DDL, RLS, API, UI screens for that segment's slice; grow the spec per segment — PARTIAL status is fine).
- Before the first F3/F5 segment: create **`docs/specs/36-employee-workspace.md`** likewise.
- Each segment implements only what its spec section defines. Spec edits land in the same commit as the segment.

## BUILD — per iteration

1. **Mission gate:** state `pass` | `risk` | `fail` + one sentence before writing code.
2. **Spec:** write/extend the relevant `35-`/`36-` spec section first.
3. **DDL (if any):** next free `NNN_*.sql`; RLS enabled before data (helpers: `haven.organization_id()`, `haven.app_role()`, `haven.has_facility_access()`, `haven.accessible_facility_ids()`); audit trigger on mutable clinical/financial tables; soft deletes; money in cents; UTC; UUID PKs; denormalized `organization_id` + `facility_id`. Run `npm run migrations:verify:pg` when migrations touched.
4. **Implementation pass:** run `/ultracode` (or equivalent deep-implementation flow) scoped to this segment only. Reuse mandate from UNIFIED-ROADMAP §2 is binding — KB for published docs, OCE for tasks, Storage RLS for files, `dispatch-push` for notifications. No parallel systems, no `as any`, design-system tokens for UI, admin routes under `src/app/(admin)/admin/...`.
5. **Scope discipline:** no architecture resets, no pulling forward later segments, no F3 semantics smuggled into F1/F2 surfaces.

## GATES — per iteration (required)

```bash
npm run segment:gates -- --segment "F<n>-<m>-<slug>"   # add --ui when routes/layouts/visuals changed
```

PASS JSON must exist under `test-results/agent-gates/` before the segment is "done". No artifact → not done, regardless of how it looks.

## RECORD — per iteration

1. Append a row to the **Track F build log** below (segment, date, gate artifact, commit, mission alignment).
2. Update the segment's row/status in `docs/specs/UNIFIED-ROADMAP.md` §2 if scope shifted.
3. Update `docs/Autonomous.md` RECORD when the session ends (not every iteration).
4. **Commit:** one atomic conventional commit per segment (`feat(office): ...` / `feat(workspace): ...`), staged to segment files only, then push. Production publishes from `main` only.

## STOP conditions (end the loop and report)

- All remaining segments blocked on F0 / owner decisions
- A gate fails twice on the same root cause
- A segment genuinely requires breaking the reuse mandate or repo invariants
- Migration parity ambiguity with the remote DB that an agent should not resolve alone

---

## Owner inputs outstanding (loop must not guess these)

| Input | Blocks |
|-------|--------|
| ~~F0-1..F0-5~~ | **Ratified 2026-06-12** — positions in UNIFIED-ROADMAP §2 |
| eFax vendor selection | F4-1 |

## Track F build log

| Segment | Date | Gate artifact | Commit | Mission |
|---------|------|---------------|--------|---------|
| F1-1-unified-approvals-inbox | 2026-06-12 | `test-results/agent-gates/2026-06-12T20-53-16-681Z-F1-1-unified-approvals-inbox.json` (PASS, `--ui`) | `369528ea` | pass — one "waiting on me" queue over existing RLS-governed approval tables (swaps, punches, mileage, KB reviews); no new data surfaces |
| F1-2-morning-huddle-briefing | 2026-06-12 | `test-results/agent-gates/2026-06-12T21-02-06-774Z-F1-2-morning-huddle-briefing.json` (PASS, `--ui`) | `b7fc28dc` | pass — per-facility printable daily briefing (incidents, census, roster, OCE tasks, med flags) from existing RLS-scoped tables; read-only, no DDL |
| F1-3-meeting-hub | 2026-06-12 | `test-results/agent-gates/2026-06-12T21-12-44-510Z-F1-3-meeting-hub.json` (PASS, `--ui`) | `b45727b1` | pass — migration `289` meeting templates/minutes/action items with RLS + audit; action items materialize as OCE task instances (reuse mandate, escalation-chased) |
| F1-4-facility-master-calendar | 2026-06-12 | `test-results/agent-gates/2026-06-12T21-20-04-106Z-F1-4-facility-master-calendar.json` (PASS, `--ui`) | `c2e8b87b` | pass — read-only month calendar layering six existing RLS-scoped dated sources (transport, meetings, in-services, drills, doc expirations, surveys) + `.ics` export; no DDL |
| F2-1-letter-document-generator | 2026-06-12 | `test-results/agent-gates/2026-06-12T21-29-06-970Z-F2-1-letter-document-generator.json` (PASS, `--ui`) | `7a866121` | pass — migration `290` letter templates + immutable generated-letter log (RLS office roles, audit, verbatim rendered body); merge fields from governed resident/staff/facility records; letterhead print-to-PDF |
| F2-2-internal-forms-builder | 2026-06-12 | `test-results/agent-gates/2026-06-12T21-37-10-602Z-F2-2-internal-forms-builder.json` (PASS, `--ui`) | `bf072a2f` | pass — migration `291` admin-built forms (jsonb field schema) + status-tracked submission queue (submitted → in_progress → resolved/rejected) with RLS (staff submit/see own, office roles work queue) + audit (grievance evidence) |
| F2-3-esignature-read-acknowledgment | 2026-06-12 | `test-results/agent-gates/2026-06-12T21-48-15-155Z-F2-3-esignature-read-acknowledgment.json` (PASS, `--ui`) | `7efb0723` | pass — migration `292` per-role requirements on **published** KB docs only (F0-4 coupling honored) + immutable typed-name signature log (no UPDATE/DELETE policies); direct AHCA survey evidence |
| F2-4-contact-directory-on-call | 2026-06-13 | `test-results/agent-gates/2026-06-14T01-37-39-840Z-F2-4-contact-directory-on-call.json` (PASS, `--ui`) | `63c4702b` | pass — migration `293` per-facility rolodex (pharmacy/hospice/physician/AHCA/MCO) + after-hours on-call schedule; all staff read, office roles manage; audit + soft delete |
| F4-2-front-desk-kit | 2026-06-13 | `test-results/agent-gates/2026-06-14T01-42-50-736Z-F4-2-front-desk-kit.json` (PASS, `--ui`) | `93112c1d` | pass — migration `294` visitor log (with IC health screening) + package/mail custody log + resident-linked family call log; staff record/read, audit + soft delete |
| F4-3-petty-cash-resident-trust | 2026-06-13 | `test-results/agent-gates/2026-06-14T01-48-31-316Z-F4-3-petty-cash-resident-trust.json` (PASS, `--ui`) | `e6e4934f` | pass — migration `295` petty cash + per-resident trust ledgers (Rep Payee/SSA-787), money in cents, immutable insert-only ledgers (no UPDATE/DELETE), finance-role RLS + audit |
| F3-1-personal-notes-pages | 2026-06-13 | `test-results/agent-gates/2026-06-14T01-54-35-026Z-F3-1-personal-notes-pages.json` (PASS, `--ui`) | `9f28febd` | pass — migration `296` first private-content table ships F0-1 break-glass (typed reason, RLS-enforced live grant, audited) + F0-2 audit/soft-delete + F0-3 ownership-transfer primitive; pages, version history, single-editor lock |
| F3-2-private-file-drive | 2026-06-13 | `test-results/agent-gates/2026-06-14T01-59-47-345Z-F3-2-private-file-drive.json` (PASS, `--ui`) | `d5f4d189` | pass — migration `297` private file drive; `workspace-files` Storage bucket with object-path break-glass (foldername[2]=grant resource_id), owner-only RLS, reuses F0-1 grants + F0-2 audit/soft-delete |
| F3-3-publish-to-group | 2026-06-13 | `test-results/agent-gates/2026-06-14T02-05-52-607Z-F3-3-publish-to-group.json` (PASS, `--ui`) | `88e16003` | pass — migration `298` F0-4 governed publish (draft→submit→facility_admin/DON review→KB document); immutable snapshot, reviewer-role RLS, audit + soft-delete |
| F3-4-team-spaces | 2026-06-13 | `test-results/agent-gates/2026-06-14T02-12-05-854Z-F3-4-team-spaces.json` (PASS, `--ui`) | `89a11615` | pass — migration `299` team spaces + membership + page sharing (visibility=team); membership-based RLS read, single-editor preserved, audit + soft-delete |
| F3-5-personal-kanban | 2026-06-13 | `test-results/agent-gates/2026-06-14T02-17-31-416Z-F3-5-personal-kanban.json` (PASS, `--ui`) | `fe2c54fe` | pass — migration `300` private kanban cards (owner-only RLS) + read-only OCE task mirror (OCE stays system of record); audit + soft-delete |
| F3-6-shift-handoff-board | 2026-06-13 | `test-results/agent-gates/2026-06-14T02-22-16-766Z-F3-6-shift-handoff-board.json` (PASS, `--ui`) | `819f6065` | pass — migration `301` facility shift handoff board (post + acknowledge, resident-linkable, priority sort); facility-staff RLS, audit + soft-delete |
| F3-7-comments-mentions | 2026-06-13 | `test-results/agent-gates/2026-06-14T02-27-31-472Z-F3-7-comments-mentions.json` (PASS, `--ui`) | `66924418` | pass — migration `302` polymorphic comments + @mentions; RLS inherits subject visibility (private-page comments stay private via RLS-filtered subqueries); audit + soft-delete |
