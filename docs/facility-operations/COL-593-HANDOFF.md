# Segment handoff — COL-593 (Facility Operator Home, W1)

**See also:** `docs/Autonomous.md`; the build handoff this segment was cut from is
`Circle of Life/Claude outputs/Facility-Operator-Home-Handoff.md` (Brian, 2026-09-22).

## Summary

- **Segment id:** COL-593
- **Mission alignment:** `pass` — one facility-scoped Home for the three operator titles,
  composed from engines that already exist, every row clearable on the row through the
  existing audited completion path; AI nowhere in the loop.
- **Scope:**
  - Roles (COL-571): `manager` resolves to the `facility_admin` dashboard config; both
    titles open Weekly Stand Up; neither gets an Executive rail item; the Med-Tech cockpit
    is never offered (COL-303). Single-building operators see "My facility" and a static
    facility chip.
  - Data: migration `459_home_on_tap.sql` — `facility_assets.run_check_*`,
    `facilities.operator_end_of_day_local`, `facility_executives` (+ Homewood → COO,
    Plantation → CFO seeds), the Homewood generator asset + COL-133 subjects + facility
    template, `home_on_tap`, `home_claim_task`, `home_escalate_uncleared`,
    `home_escalations_for_executive`.
  - Scheduler: `oce-task-scheduler` reads `asset_ref` → asset schedule override (Tue
    10:00 from the asset, reset by a vendor visit) and stamps the facility/asset subject
    so operators can read what it writes.
  - App: `/admin` renders `FacilityOperatorHomePageClient` for `facility_admin` and
    `manager`; owners/org admins unchanged. Completion route accepts `outcome` and
    requires a note on `did_not_run`. Executive overview gains "Escalated to you".
  - Census (COL-569, Cut 1 per Brian lock §9.5): migration `460_home_census_confirmation.sql`.
    On the facility's first business day (Mon–Fri; no holiday calendar exists yet) Home
    shows "Confirm census for {prior month}" with counts from `census_daily_log` and the
    Stand Up roster. **Confirm** freezes a server-computed snapshot, stamps the actor and
    the Facility Executive it notifies (executive overview "Monthly census" panel, same
    in-app path as escalations); **Something wrong** requires a note and keeps it open.
    Writes are `facility_admin` / `manager` only through `home_record_census` (definer;
    browser DML revoked). Counts only.
    Numbered 460 (contiguous after main 459; #670/#671 renumbered upward).
    reports the 460–462 gap on this branch until those merge — renumber if they do not.
  - Quick links (locked): Stand Up · Referrals · My facility · EMP · Report incident live;
    Record payment (W2) · Call-out (W4) · Quick note (W3) week-badged and disabled.
    Maintenance ticket dropped from the strip.
  - Ops: `scripts/operator-home/cron-schedules.sql` (Homewood scheduler daily, escalation
    sweep every 15 min); `scripts/operator-home/col-571-homewood-operator-profiles.sql`.
- **Out of scope:** rent rows and Record payment (W2, COL-594), Quick note (W3, COL-595),
  Call-out (W4, COL-596), maintenance ticket (COL-578), the AHCA roster row (COL-570),
  push/email delivery of escalations and census notices (COL-152), Undo on a cleared row
  (no reinstate exists for `completed`). Census gaps: an unconfirmed month does not carry
  past the first business day or join the end-of-day sweep yet; facility holidays are
  not modelled (`haven.first_business_day` is the seam); the bookkeeper is not notified
  (no bookkeeper assignment exists — only `facility_executives`).

## Findings (production, 2026-09-22)

1. **The engines existed as code only.** Zero `operation_task_instances` in any facility,
   zero `facility_assets`, zero `operation_activity_subjects`, zero `workspace_cards` at
   Homewood, and no cron job or Vault secret for `oce-task-scheduler`. W1 therefore
   wires generation end to end rather than composing existing rows.
2. **COL-133 hides unclassified rows.** `operation_task_readable` needs a current subject;
   the legacy scheduler path wrote none, so nothing it generated could ever be read by a
   signed-in operator. The scheduler now stamps facility/asset subjects.
3. **Mindy has a login but no profile.** `auth.users` row with `app_role=facility_admin`
   and Homewood access; no `user_profiles` row; never signed in. The COL-571 data fix is
   the profile insert (script above), not a role change.
4. Grande Cypress's administrator/executive has no Haven login, so no
   `facility_executives` row is seeded there; Rising Oaks and Oakridge stay unset until
   named (COL-571).

## Implementation notes

- `home_on_tap` is `SECURITY INVOKER`; RLS on `operation_task_instances` is the scope.
  FYI rows are built in the app from `admin_command_center_projection.workflowQueues`
  so the queue counts are not re-implemented in SQL; ranking and the 7-row cap live in
  `src/lib/home/on-tap-model.ts` with unit tests.
- Completion never bypasses `complete_operation_task_review`: Home POSTs the existing
  route, which resolves the actor server-side and keeps the audit row.
- Cron is a hand-run script, not a migration (repo policy; see
  `scripts/census/cron-schedules.sql`). The scheduler job is pinned to Homewood and to the
  `safety` category, which today holds exactly the generator template — one live
  behaviour per week (DEC-2026-09-21-11).
- Follow-ups: COL-568 failure routing — done in COL-602 (migration 462,
  `home_record_did_not_run`: "Did not run" escalates to level 1 in the same
  transaction as the completion and shows on the executive panel and the executive
  facility page's Needs attention list); a deep link to a single task on
  `/admin/operations/work`; W2–W4 as their own children.

## Verification

- `npm run test`, `npm run lint`, `npm run typecheck` — see closeout.
- `npm run migrations:verify:pg` on a native PG17 scratch cluster, including
  `supabase/tests/review_home_on_tap.sql` (RLS: A never reads B, caregiver refused,
  weekend empty, night row hidden, claim/release, escalation once, executive-only read)
  and `supabase/tests/review_home_census_confirmation.sql` (first business day only,
  weekend 1st and second business day empty, A never reads/writes B, caregiver and
  org_admin refused, flag needs a note, confirm stamps actor + executive once, no direct
  insert, executive-only notices).
- `npm run segment:gates -- --segment "COL-593" --ui` — artifact under
  `test-results/agent-gates/`.
- Playwright `tests/homewood-launch/11-operator-home-generator.spec.ts` (skips when no
  open generator row exists for today).

## Commit

- `feat(home): facility operator Home with the On-tap feed (COL-593, COL-571)`
- `feat(home): monthly census confirmation on tap and locked quick links (COL-569, COL-593)`
