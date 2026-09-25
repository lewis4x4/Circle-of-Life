# Homewood Lodge timeclock cutover (COL-352, COL-677)

Mission alignment: pass. Haven replaces the uPunch FN1000 wall clock and the uPunch Punch-to-Pay app only after a parallel run proves it, with every punch on an append only ledger and every manager change carrying a reason on record. Payroll submission stays with COL-357.

This plan has phases and gates, not dates. Each phase ends when its gate is met and the person named for the gate says so in the Linear issue. Rollback is available at every phase.

## Who decides

- **Facility administrator (Charlene):** runs the reconciliation each pay period, resolves exceptions, and confirms the tablet is usable by every shift.
- **Payroll and Jessica Murphy:** confirm that the workweek, meal treatment, rounding and pay period frequency match ADP, and accept the payroll export.
- **Brian:** sets the number of consecutive clean pay periods required (TBD), turns the facility flag on and off, and approves the move to each phase.

## Phase 1: enroll while uPunch continues

Homewood staff keep punching on uPunch. In parallel:

1. Confirm the organization pay period in Haven (`Timeclock` page, owner or organization administrator): frequency and anchor Monday. This must match ADP; record the TBD confirmation from Jessica Murphy and payroll on COL-352 before leaving Phase 1.
2. Give every active Homewood staff member timeclock access from the staff profile (`Timeclock access`): generate a Haven timeclock ID and a separate PIN, hand over the PIN once, and scan a badge where one exists. The timeclock ID is an internal sign-in identifier, not a payroll number. Badge registration needs `TIMECLOCK_BADGE_HMAC_SECRET` on the server; timeclock ID and PIN work without it.
3. Enroll the front-door kiosk per `docs/operations/timeclock-kiosk-lockdown.md` and turn the facility `Timeclock` flag on.
4. Ask staff to punch on both the uPunch clock and the Haven kiosk for every in, meal and out. The floor tablets depend on the Haven punch (see "Floor tablets depend on the kiosk" below), so the Haven punch is not optional even while uPunch is still the payroll record.

**Gate to Phase 2:** every active staff member has a credential, the tablet has stayed enrolled through a full week of shifts, and the pay period is set.

**Rollback:** turn the facility flag off. Staff keep using uPunch cards; nothing else changes.

## Phase 2: parallel run

Each pay period:

1. Managers review the `Timeclock` page and resolve every exception on the person's timesheet with a correction (add, void, change time) or an acknowledgment, each with a coded reason.
2. Export the uPunch app CSV for the same period and run `Compare with uPunch`. Every staff week should read `Match` (within five minutes). Record the count of unexplained differences in the COL-352 issue for that period.
3. Download the Haven payroll CSV and hand it to payroll alongside the uPunch figures. Payroll compares the two and records acceptance or the differences.

**Gate to Phase 3 (all required):**

- Consecutive pay periods with zero unexplained differences: count TBD by Brian.
- Payroll export accepted by payroll for those periods.
- ADP alignment from COL-357 confirmed (submission path documented and accepted).
- Jessica Murphy confirms the workweek start, meal paid or unpaid, rounding and pay period frequency TBDs.

**Rollback:** turn the facility flag off and resume uPunch cards as the only record. Haven punches recorded so far stay on the ledger for reference.

## Phase 3: stop punching on uPunch

1. Announce the change to staff: from the start of the next pay period, the Haven tablet is the only clock. Post the badge or number plus PIN instructions beside the tablet.
2. Keep the FN1000 wall clock and the uPunch account in place for one pay period of records access. Do not cancel yet.
3. Export the full uPunch history from the app and store it in the private operating evidence, not in this repository.
4. After that pay period, cancel the uPunch account and remove the wall clock.

**Rollback during the records-access period:** turn the facility flag off, reload uPunch cards, and resume punching on the wall clock. Haven keeps its ledger; nothing is deleted.

## Floor tablets depend on the kiosk (COL-677)

A floor tablet lists only the staff clocked in right now at the front-door kiosk (spec `docs/specs/40-floor-tablet-and-kiosk.md`). The schedule is never the roster. So before `HL-FLOOR-01`, `HL-FLOOR-02` or `HL-FLOOR-03` is usable on a shift, all of these must already be true:

- The facility `Timeclock` flag is on.
- Everyone who will use a floor tablet has timeclock access: an employee number and a PIN. The PIN they punch with is the PIN that unlocks the floor tablet.
- `HL-KIOSK-01` is enrolled at the front door and staff clock in there at the start of every shift.
- Each floor account has a login with a current profile in a floor roster role (med tech by default) and is linked to its staff row. `scripts/floor/fix-stale-app-roles.sql` does this for the Homewood floor accounts.

Someone who clocked in but is not on the roster (for example, the kiosk was offline) taps "Not listed? Use employee number" and unlocks with employee number and PIN. Haven records that unlock as off the clock, and the manager sees an `unlock_without_punch` exception on that person's timesheet to resolve like any other exception.

Rollback for the floor tablets alone: revoke them on the `Timeclock` tab. Turning the facility `Timeclock` flag off turns off the kiosk and the floor tablets together.

## Oct 1 setup order (COL-695)

Go-live is the Homewood day shift start on 2026-10-01. Before then, in this order:

1. Run the three setup scripts in `scripts/floor/`, each as a dry run first, read the report, then apply. The exact commands, including the link check, are in each file's header and in `scripts/floor/README.md`.
   1. `homewood-pause-cadence.sql`: no Smart Rounding cadence in force at Homewood until the day shift start on Oct 1; the current observation windows are scheduled to come back at that instant.
   2. `homewood-clear-pre-go-live.sql`: excuse checks due before go-live that are missed or upcoming, and close open escalations with the reason `before go-live`. Run it again on the morning of Oct 1 before the day shift starts.
   3. `fix-stale-app-roles.sql`: the Homewood floor accounts get a profile, the med tech role, a linked staff row and Homewood access. Work through anything it lists under "manual review" before step 2.
2. Issue timeclock access (employee number and PIN) for all 20 Homewood staff from each staff profile.
3. Enroll `HL-KIOSK-01` with a `Front-door kiosk` code, and `HL-FLOOR-01`, `HL-FLOOR-02` and `HL-FLOOR-03` with `Floor tablet` codes, per `docs/operations/timeclock-kiosk-lockdown.md`.
4. Turn the facility `Timeclock` flag on.
5. Walk the building on the facility Wi-Fi with a floor tablet unlocked: every hall and resident wing, and the front door. Note any spot where the tablet goes offline, and confirm that a check charted there syncs once back in range.

## After cutover

- Timeclock corrections remain append only. A manager never edits a punch.
- Terminated staff are refused at the kiosk from the moment employment status changes (COL-349); automatic credential revocation is COL-355.
- Overtime prefill for Stand Up staffing from timeclock totals is a follow on recorded in `docs/specs/37-timeclock.md`.
