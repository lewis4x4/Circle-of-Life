# COL-137 — one recurrence and due-date evaluator

**Implemented, independently reviewed and verified locally on the feature branch; see the evidence for the gate artifact.** No hosted migration, deployment, schedule confirmation for any facility, occurrence generation from a confirmed rule, reminder delivery or operating acceptance occurred. Nothing was merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Evaluator`; branch `codex/hfo-col137-evaluator`, stacked on COL-135 `520ccbde` (catalog 336, current authority 337, applicability 338, review closures) over origin/main `fad17dcc`. COL-132, COL-133 and COL-135 are Done in Linear as reviewed, gated, unmerged source; COL-137 integrates after COL-135 in the recorded Finance-first order.

## Delivered

- `src/lib/operations/schedule-evaluator.ts`: one runtime-agnostic evaluator (no imports; `Intl` only) with a strict version-1 rule shape (weekday sets with optional holiday skipping, weekly, monthly calendar day with explicit short-month policy, monthly business-day ordinal against a versioned embedded holiday calendar, fixed months for quarterly / fixed half-year / annual, month intervals from an anchor for six-month, anniversary and two-year meanings, expiry anchors, event timing), separate deadline and reminder parts, explicit DST outcomes reported as adjustments, `listOccurrenceDates` / `nextOccurrenceDate` / `resolveOccurrence` / `previewOccurrences`, `judgeDue` (the only source of an overdue claim; `unknown` with `days_overdue: null` when no due instant exists) and `legacyTemplateRule` (translates existing template cadence columns while preserving the recorded scheduler timing).
- Same evaluator on every surface: Deno scheduler (`oce-task-scheduler`, reports `unknown_schedules` instead of inventing dates; range longer than 800 days is refused), task list / history / exception views (`server.ts` `due_judgment`, nullable `days_overdue`, `summary.schedule_unknown`; overdue filter, Today, calendar, range, overdue and pager pages, miss predictor), risk scorer overdue filter (failure policy unchanged), and the facility requirement preview (`schedule_preview` next-due list).
- Migration `339_hfo_schedule_evaluator.sql` (provisional): SQL mirror of the rule-shape validator with identical problem wording and order, a BEFORE trigger rejecting uninterpretable stored rules, publication of a confirmed schedule limited to a valid rule on an applicable configuration, and the preview exposing the proposed and in-force rules. No table, column, seed or occurrence.
- Shared fixtures `src/lib/operations/schedule-rule-fixtures.json` asserted identical in Vitest and embedded in the SQL probe, so the two validators cannot drift silently.
- Canonical contract: [evaluator](../specs/27-facility-operations-evaluator.md). Exact file hashes: [implementation manifest](col137-evidence/implementation-manifest.json).

## Acceptance

1. Unknown schedule → no due/overdue judgment, no assigned-date midnight: `judgeDue` and `due-judgment.test.ts` (past assigned date, null due → `unknown`, `days_overdue: null`, not counted overdue); the assigned-date fallbacks in `server.ts` and the overdue page are removed; scheduler unknowns are reported, not dated.
2. DST, month end, leap day, two six-month meanings, holiday calendar and expiry anchors: deterministic tested outcomes in `schedule-evaluator.test.ts` (2026-03-08 gap shifted forward, 2026-11-01 overlap first instant, day 31 clamp/skip/last, 2024-02-29 anniversary clamp/skip, interval 6 vs fixed `[1,7]` vs interval 24, business-day ordinals and uncovered calendar dates unresolved, expiry anchor then "new anchor required").
3. Same evaluator everywhere; ambiguities unactivated: scheduler, server, scorer and preview import the one module; the seven ambiguous source items carry no approved rule (Vitest and SQL probe); the evaluator source contains no facility name or source-item default; no migration stores or confirms a rule (probe start assertion).

## Boundaries kept

`needs_confirmation` stays the default and a publishable state. Confirming a schedule is a site administrator's act through the COL-135 commands, now possible only with a valid rule on an applicable configuration; no facility holds one. Q04–Q09 and Q14 stay unanswered (OWNER-DECISIONS.md 3a); three engineering policies are listed for confirmation (3b). Occurrence generation from confirmed rules is HFO-04; reminder delivery is HFO-15; Homewood's profile is HFO-26.

## Evidence

Focused suite, typecheck, lint on changed files, Deno checks of both Edge functions, native replay of 342 migration files (numbered through 339) with 23 probes including `review_hfo_schedule_evaluator.sql`, independent SQL and TypeScript reviews with dispositions, strict gate artifact: see [verification](col137-evidence/verification.json) and [review](col137-evidence/independent-review.json). Local PostgreSQL uses Supabase stubs and synthetic fixtures; hosted Auth, browser and staff acceptance are not established.

## Resume and rollback

Next dependency-ready issues after this closes: COL-139 (HFO-04 occurrence generation) needs COL-137 and COL-133; check live Linear before starting. Before deployment, rollback is reverting this segment. After application, drop the 339 trigger and restore the 338 function bodies; stored rules are additive data. Mission alignment: **PASS**; hosted and operating readiness: **RISK**.
