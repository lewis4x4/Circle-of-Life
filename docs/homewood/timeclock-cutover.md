# Homewood Lodge timeclock cutover (COL-352)

Mission alignment: pass. Haven replaces the uPunch FN1000 wall clock and the uPunch Punch-to-Pay app only after a parallel run proves it, with every punch on an append only ledger and every manager change carrying a reason on record. Payroll submission stays with COL-357.

This plan has phases and gates, not dates. Each phase ends when its gate is met and the person named for the gate says so in the Linear issue. Rollback is available at every phase.

## Who decides

- **Facility administrator (Charlene):** runs the reconciliation each pay period, resolves exceptions, and confirms the tablet is usable by every shift.
- **Payroll and Jessica Murphy:** confirm that the workweek, meal treatment, rounding and pay period frequency match ADP, and accept the payroll export.
- **Brian:** sets the number of consecutive clean pay periods required (TBD), turns the facility flag on and off, and approves the move to each phase.

## Phase 1: enroll while uPunch continues

Homewood staff keep punching on uPunch. In parallel:

1. Confirm the organization pay period in Haven (`Timeclock` page, owner or organization administrator): frequency and anchor Monday. This must match ADP; record the TBD confirmation from Jessica Murphy and payroll on COL-352 before leaving Phase 1.
2. Give every active Homewood staff member timeclock access from the staff profile (`Timeclock access`): employee number, a generated PIN handed over once, and a badge scan where a badge exists. Badge registration needs `TIMECLOCK_BADGE_HMAC_SECRET` on the server; employee number and PIN work without it.
3. Enroll one tablet per `docs/operations/timeclock-kiosk-lockdown.md` and turn the facility `Timeclock` flag on.
4. Ask staff to punch on both the uPunch clock and the Haven tablet for every in, meal and out.

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

## After cutover

- Timeclock corrections remain append only. A manager never edits a punch.
- Terminated staff are refused at the kiosk from the moment employment status changes (COL-349); automatic credential revocation is COL-355.
- Overtime prefill for Stand Up staffing from timeclock totals is a follow on recorded in `docs/specs/37-timeclock.md`.
