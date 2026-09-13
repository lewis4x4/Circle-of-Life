# Facility operations recurrence and due-date evaluator — COL-137

Status: PARTIAL — HFO-03 foundation. September 10, 2026. Extends the [catalog](27-facility-operations-catalog.md), [current authority](27-facility-operations-authority.md) and [applicability](27-facility-operations-applicability.md) contracts under BUILD-SCOPE section 5 ("one evaluator for occurrence generation, due/next-due displays, reminders and corporate overdue counts"). This is source implementation: it confirms no schedule for any facility, generates no occurrence from a confirmed rule, sends no reminder and establishes no hosted or operating acceptance.

## One evaluator

`src/lib/operations/schedule-evaluator.ts` is the only place a facility operations task acquires an occurrence date, a due instant or an overdue judgment. It is runtime-agnostic (no imports, no Node or Deno API, `Intl` only) so the same file runs in the Next server and, by relative import, in the Deno scheduler and risk scorer. Version `hfo-evaluator/1`.

Surfaces on the evaluator:

- **Scheduler** (`supabase/functions/oce-task-scheduler`): legacy template cadence columns are translated by `legacyTemplateRule` into a version-1 rule that preserves the recorded timing (shift base times 07:00, 15:00, 23:00 or 09:00 plus the first enabled escalation SLA or the estimate floor of 60 minutes; month-end clamping), then `listOccurrenceDates` and `resolveOccurrence` produce the dates and `due_at`. Templates without a recurrence (on-demand, event-driven, weekly without a weekday) are reported as `unknown_schedules` and receive no invented date. The translation is a compatibility bridge for existing templates, not an approval of any COL rule.
- **Task list, history and exception views** (`src/lib/operations/server.ts`): `judgeDue` yields `due_judgment` (`unknown`, `settled`, `not_due`, `overdue`) and `days_overdue` (null when unknown) in the facility timezone. The Today, calendar, range, overdue and pager views, the overdue filter and the miss predictor consume that judgment. The assigned-date-midnight fallback is gone: a task without a due instant shows "Schedule needs confirmation" and counts under `summary.schedule_unknown`, never under `overdue`.
- **Risk scorer** (`supabase/functions/risk-nightly-scorer`): overdue tasks are those the evaluator judges overdue, plus explicitly missed ones. The run-level failure policy is unchanged.
- **Next-due preview** (`POST /api/admin/operations/facility-requirements/[id]/preview`): the response carries `schedule_preview` with the next six occurrences (due, grace end, reminder instant, DST adjustments) computed from the draft's proposed rule at the proposed effective time, or `unresolved: "schedule needs confirmation"` when the schedule is not confirmed, or the rule's problems.

## Rule shape (version 1)

A rule is a structured object; free text, counts in parentheses and abbreviations are never interpreted.

| Field | Meaning |
|---|---|
| `rule_version` | `1` |
| `timezone` | IANA zone name; versioned with the rule, never inferred from the server |
| `recurrence` | one of `weekday_set` (weekdays, optional `on_holiday: occurs\|skipped`), `weekly` (weekday), `monthly` (day 1–31 or `last`, `short_month: clamp\|skip` required above 28), `monthly_business_day` (ordinal 1–15 from `start` or `end`, requires a calendar), `fixed_months` (unique months plus day; quarterly is `[1,4,7,10]`, a fixed half-year is `[1,7]`, annual is one month), `interval_months` (`every` 1–120 from an `anchor` date; a six-month interval, an anniversary or a two-year interval are distinct values), `expiry` (`expires_on`; a single anchored occurrence, the next needs a new anchor), `event` (`event_key`; occurrences exist only from a source event instant) |
| `deadline` | local `time` HH:MM, optional `day_offset`, `offset_minutes`, `grace_minutes` |
| `reminder` | optional `lead_minutes`; represented and previewed, never delivered here (HFO-15) |
| `calendar` | optional versioned holiday calendar: `key`, `version`, `covers_from`, `covers_to`, `weekend`, `holidays` (≤ 400 dates inside the coverage); required by business-day rules and by `on_holiday: skipped` |

Deterministic outcomes, each tested:

- **DST.** A local time that does not exist (spring forward) is shifted forward past the gap; a repeated local time (fall back) resolves to its first instant. Both are reported in `adjustments`, never silent.
- **Month end and leap day.** Days above 28 require an explicit `short_month` policy: `clamp` uses the last day, `skip` produces no occurrence that month. `last` always means the last day. An anniversary anchored on February 29 follows the same policy.
- **Six-month meanings.** `interval_months: 6` from an anchor and `fixed_months: [1, 7]` are different rules; "bi-annual" is not a recurrence kind and cannot be stored (Q07 stays open).
- **Holiday calendars.** Business-day and holiday-skipping rules need a calendar whose coverage includes the date; a date outside the coverage is unresolved ("calendar does not cover …"), not a guess.
- **Expiry anchors.** Due on the supplied expiry date; after it, the next occurrence is unresolved until a new anchor is supplied.
- **Unknown.** No rule, no due instant, an event without its source instant, or an uncovered calendar date yields an unresolved result or an `unknown` judgment with `days_overdue: null`.

## Database

`339_hfo_schedule_evaluator.sql` (provisional number) mirrors the version-1 shape in `haven.operation_schedule_rule_problems(jsonb)` with the same problem wording and order as `validateScheduleRule`; the shared fixtures (`src/lib/operations/schedule-rule-fixtures.json`) are asserted identical in the Vitest suite and embedded in `supabase/tests/review_hfo_schedule_evaluator.sql`. A BEFORE trigger rejects any stored rule the evaluator cannot interpret (`22023`, "contains an invalid value: schedule rule …"). Publication of a `confirmed` schedule now requires a valid rule and an `applicable` configuration; `needs_confirmation` remains the default and a publishable state. The facility preview exposes `proposed_schedule_rule`, `in_force_schedule_rule` and `schedule_rule_version`. No table, column, occurrence or seed row is added; no configuration is confirmed by the migration, and the seven ambiguous source items (fire drills, elopement drills, drill review, hood cleaning, bi-annual license renewal, manager 12-hour update, community support plan) carry no approved rule.

## Boundaries kept

Occurrence generation from confirmed rules, subject-scoped identity and period snapshots are HFO-04. Reminder delivery is HFO-15. Homewood's approved profile is HFO-26. Q04–Q09 and Q14 remain unanswered; the evaluator can express the candidate meanings so an answer can be recorded without code changes, and refuses to pick one.

## Verification

1. `npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts`
2. `npm run typecheck`; `deno check --no-lock supabase/functions/oce-task-scheduler/index.ts supabase/functions/risk-nightly-scorer/index.ts`; `npm run segment:gates -- --segment COL-137-HFO-EVALUATOR --ui`
3. Migration replay executes `supabase/tests/review_hfo_schedule_evaluator.sql`: no migration stores or confirms a schedule; the shared fixtures validate identically; an invalid rule cannot be drafted and names its first problem; a confirmed schedule previews and publishes only on an applicable configuration with a valid rule, with approver and audit rows; the published rule is immutable for the session and the service identity; the next draft inherits the confirmed schedule and returning it to `needs_confirmation` publishes as its own state; the seeded catalog's ambiguous items carry no approved rule. The 338 probe keeps asserting that its fixtures confirm no schedule.

## Migration and rollback

`339_hfo_schedule_evaluator.sql` follows this branch's unapplied 336–338 and replaces two 338 functions in place. Numbers are branch-local; integrate after COL-135 in the recorded Finance-first order and re-read the hosted ledger before assigning final numbers. Before application, rollback is reverting this segment. After application, roll back by dropping the trigger and restoring the 338 bodies of `operation_facility_requirement_problems` and `preview_operation_facility_requirement_publication`; stored rules are additive data and stay.

Mission alignment: PASS for the bounded foundation. Operating readiness: RISK pending occurrence generation, hosted release and Homewood configuration.
