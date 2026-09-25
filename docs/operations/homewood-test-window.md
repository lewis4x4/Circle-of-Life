# Homewood test window (COL-849): runbook and test checklist

Brian tests every floor tablet and front-door kiosk feature on production at Homewood Lodge with the real iPads, real staff PINs and Homewood's real residents. The window opened at **2026-09-25 20:24:02 UTC (4:24 PM ET)**, when Homewood's Timeclock was switched on. Everything created at Homewood from that instant is test data. On the **evening of Sept 30** the wipe removes it and puts Homewood back the way it was before the window, ready for the Oct 1 go-live.

| File | What it does |
|---|---|
| `scripts/floor/homewood-test-window-open.sql` | Timeclock on; a Smart Rounding test cadence (version 3's four windows: 6 AM, 10 AM, 2 PM, 6 PM) in force now and ending at 8:00 PM ET Sept 30; outside alerts to Brian only; a snapshot of the configuration it changes |
| `scripts/floor/homewood-test-window-photos.mjs` | Removes the window's incident photos from Storage (run before the wipe) |
| `scripts/floor/homewood-test-window-wipe.sql` | Deletes every row the window created at Homewood, restores the configuration from the snapshot, turns Timeclock off, clears lockouts, verifies |
| `HANDOFFS/2026-09-25__homewood-test-window/WRITE-INVENTORY.md` | Every table the flows write, how each is scoped to the window, the delete order, and what is kept and why |
| `supabase/tests/review_homewood_test_window.sql` | The end-to-end proof: both scripts against test activity driven through the real functions |

Every SQL script is dry run by default and needs its apply switch. Every run starts in a checkout linked to production:

```bash
test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
```

## Before testing: open the window (now)

1. Dry run and read it:

   ```bash
   supabase db query --linked -f scripts/floor/homewood-test-window-open.sql
   ```

   Expect: `cadence in force` is version 2 with 0 enabled windows (the COL-695 pause); `cadence scheduled` is version 3 at `2026-10-01 10:00:00+00` with 4 enabled windows; `test windows` lists the six windows with the 22:00 and 02:00 ones disabled; `cron` shows `col695-homewood-timeclock-on` active; `alerts` shows Brian's user id.

2. Apply:

   ```bash
   { echo "SET haven.col849_apply = 'homewood-test-window-open';"; cat scripts/floor/homewood-test-window-open.sql; } > /tmp/col849-open-apply.sql
   supabase db query --linked -f /tmp/col849-open-apply.sql
   ```

   The last line reads `applied | verified | test cadence in force until 2026-10-01 00:00:00+00; version 3 still scheduled; Brian on every routed rung; fence on`. It is one transaction: if anything is off it rolls back and changes nothing. Running it again reports `already open`.

3. To receive the test alerts yourself: sign in to Haven on your phone and allow notifications (push goes to your user), and add your mobile number to your Haven profile if you want the last-rung text. Today your profile has no phone and no push subscription, so without this the alerts are recorded for you but nothing buzzes.

4. Tell Charlene (see [Note for Charlene](#note-for-charlene)).

## While the window is open

- **Alerts.** Every push, text, call or email about Homewood goes to Brian only. The delivery fence writes the rest as `skipped` (`col849_test_window`) before any sender sees them. In-app alerts still appear in Haven for the administrators, the same as they would after go-live; that is what Charlene will see.
- **Volume.** The test cadence makes a check for every resident at 6 AM, 10 AM, 2 PM and 6 PM. Checks nobody charts escalate through every rung, so expect a steady stream of in-app escalations and pushes to Brian.
- **A fall report places a monitoring order.** A Level 2 or higher fall starts the watch protocol, which places an hourly monitoring order for that resident. Its checks keep coming until the wipe. Cancel it in Smart Rounding if it gets in the way; the wipe removes it either way.
- **The kiosk is at the real front door.** Any real visitor who signs in on it during the window is test data and is wiped. Keep the paper visitor log in use until Oct 1.
- **Punches are not payroll.** Punches made in the window are wiped. Do not build a Homewood payroll packet in the window (the wipe stops if one exists), and keep uPunch or paper for this week's hours.
- **Test incidents are not reports.** Do not mark a test incident's AHCA obligation submitted (the wipe stops if one is).
- **Chart a check needs the floor capture fix.** On 2026-09-25 the floor tablet's Chart a check could not save a Smart Rounding check: the database requires where the resident was, how they presented and at least one meal, mood or medication chip, and the tablet sent none of them. The fix is its own pull request (Linear COL-861). Until it is deployed, that checklist item fails with "Where the resident was and how they presented are required on every check"; every other item can be tested.

## Sept 30, evening: close the window

Run these in order, after the last test and before 05:30 ET Oct 1. The wipe refuses to apply at or after `2026-10-01 09:30:00+00`. Running it after the test cadence ends (8:00 PM ET) means no new checks appear while it runs; start the apply away from 7 minutes past the hour, when the watchlist engine re-reads every Homewood signal.

1. **Empty every iPad's unsent queue.** Put each iPad on Wi-Fi and open Haven.
   - Floor tablets (HL-FLOOR-01 to 03): the lock screen shows no amber "n unsent" pill on any name, and the Rounds tab shows no "waiting to send".
   - Kiosk (HL-KIOSK-01): the Staff screen shows no "saved punches sending" or "waiting".
   Anything still queued replays after the wipe as a new row. If that happens before 09:30 UTC, run the wipe again; it removes only what is new.

2. **Check the backup.** Production has point-in-time recovery. Confirm it is current:

   ```bash
   supabase backups list --project-ref manfqmasfqppukpobpld
   date -r <LATEST TIMESTAMP>   # should be within the last few minutes
   ```

   `PITR` must say `true`. If it does not, stop and take a backup first (Supabase dashboard, Database, Backups).

3. **Remove the photos** (production `.env.local`; prints paths and counts, never keys):

   ```bash
   node scripts/floor/homewood-test-window-photos.mjs           # dry run: which photos
   node scripts/floor/homewood-test-window-photos.mjs --apply   # removes them; ends "0 test photos left"
   ```

4. **Wipe dry run:**

   ```bash
   supabase db query --linked -f scripts/floor/homewood-test-window-wipe.sql
   ```

   Read it:
   - `dry run` lists all 42 tables with "window rows to delete" and "pre-window rows (kept)". The counts should look like the testing that was done (a handful of punches, visitors and reports; checks for every resident for every window since the open).
   - "window rows from other producers kept" is normal for exec alerts from other modules, staff-typed visitor entries and admission notes.
   - "push, SMS, voice or email sent to someone other than Brian" must be `0`.
   - `stops` must all be `0`, and there must be **no `STOP` section**. A `STOP` names what needs a decision; do not work around it.
   - `guards before` must show all seven enabled.

5. **Wipe apply:**

   ```bash
   { echo "SET haven.col849_apply = 'homewood-test-window-wipe';"; cat scripts/floor/homewood-test-window-wipe.sql; } > /tmp/col849-wipe-apply.sql
   supabase db query --linked -f /tmp/col849-wipe-apply.sql
   ```

   It is one transaction. It only commits if every window row is gone, every pre-window row hashes the same as before, all seven guards are back on, and the configuration equals the snapshot. If it rolls back with "Pre-window rows of ... changed" or "... window rows are still in ...", a background job (the generator, the escalation engine, the watchlist engine) wrote at Homewood while it ran; nothing was changed, so run it again. Read the `verification` section:
   - every table reads `window rows now 0` and `(unchanged)`;
   - all seven guards `enabled`;
   - cadence version 2 `active`, version 3 `scheduled from 2026-10-01 10:00:00+00`, and nothing else;
   - `timeclock_enabled false`, `delivery fence triggers 0`, `cron col695-homewood-timeclock-on 30 9 1 10 *, active`.

6. **After.** The iPads stay enrolled and the PINs stay set. At 05:30 ET Oct 1 the cron job turns Timeclock back on and unschedules itself; at 06:00 ET version 3 takes effect.

If the open script was never applied, the wipe still removes every window row and turns Timeclock off; it reports "open script applied: no" and has no configuration to restore.

## Note for Charlene

> Brian is testing the floor iPads and the front-door kiosk at Homewood with real residents until the evening of Wednesday, Sept 30. Until then you will see test alerts in Haven: missed checks, escalations and incident notices for Homewood. They are expected and you do not need to act on them. You will not get texts or pushes for them. Everything from the test is removed on Sept 30, and the real alerts start with the day shift on Oct 1.

## Test checklist

The full test plan (from `HANDOFFS/2026-09-25__homewood-test-window/TEST-PLAN.md`). Check a box when it works; write what you saw when it does not.

### Before testing

- [ ] All four iPads on iPadOS 27.0 (Mosyle, Devices Overview)
- [ ] Auto-Lock set by hand: HL-FLOOR-01 to 03 at 5 minutes, HL-KIOSK-01 at Never (Settings, Display & Brightness, Auto-Lock)
- [ ] Two med techs have an employee number and 6-digit PIN in Haven (Staff profile, Timeclock access)
- [ ] HL-KIOSK-01 enrolled: Haven Timeclock devices, kiosk code, typed into the Haven Kiosk web clip within 15 minutes, tablet name `HL-KIOSK-01`
- [ ] HL-FLOOR-01, 02 and 03 enrolled: floor code, typed into the Haven web clip, tablet names `HL-FLOOR-01` to `03`
- [ ] Smart Rounding test cadence open (the `homewood-test-window-open.sql` script)

### Kiosk: staff

- [ ] Med tech A clocks in with their PIN; confirmation says their name is now on the floor tablets
- [ ] Kiosk returns to home 5 seconds after a confirmation, and 30 seconds after no input on any screen
- [ ] Meal start, then meal end
- [ ] Only the one valid next action is offered (no clock in twice)
- [ ] Wrong PIN shows how many tries are left
- [ ] 5 wrong PINs lock that person for 15 minutes; an administrator unlocks them in Haven
- [ ] Clock out; the punch pair shows on the timesheet with the right times
- [ ] Offline: turn off the kiosk's Wi-Fi, clock in, turn Wi-Fi back on; the punch arrives with the time it was made

### Kiosk: visitors

- [ ] Visiting a resident: name, phone, resident's name typed, not sick; confirmation shows
- [ ] Visiting a resident, answering Yes to feeling sick: "Please see the front desk before you go in." and the entry is flagged
- [ ] Healthcare provider: agency or practice is required
- [ ] Vendor or contractor: company is required, purpose recorded
- [ ] Inspector or official: agency required; the administrator's Haven Home shows the inspector banner while the visit is open
- [ ] Leaving: nothing is listed until 3 letters are typed; sign-out works for each of the four
- [ ] No resident name appears anywhere on the kiosk
- [ ] Each entry shows in the staff visitor log with the typed name, Match resident works, and the AHCA print pack includes it

### Floor iPad: unlock

- [ ] "Who's on shift?" lists only people clocked in at the kiosk, most recent first
- [ ] Tap name, enter PIN, unlock; Unlock appears only at 6 digits; no system keyboard
- [ ] Wrong PIN message; lockout matches the kiosk
- [ ] "Not listed? Use employee number" unlocks someone not clocked in and flags it on their timesheet
- [ ] Switch from A to B; B sees only their own session
- [ ] Idle 3 minutes: Haven locks (the facility setting is 3; the iPad's own Auto-Lock is 5)
- [ ] A clocks out at the kiosk: the floor iPad locks A out within about a minute

### Floor iPad: work

- [ ] Now screen: due and overdue checks in time order, my tasks, residents rail with status dots, my-shift strip
- [ ] Smart Rounding: a check due after A clocked in is assigned to A within 15 minutes
- [ ] Chart a check: every quick status, a location, each "helped with" and "anything wrong" chip at least once
- [ ] Late check requires a late reason
- [ ] Charted check shows A's name, even after B unlocks the iPad
- [ ] A missed check names its owner and raises an escalation (the alert reaches Brian only during the window)
- [ ] Resident screen: status, today's checks, watch and follow-ups, know-before-you-go-in, Full record opens
- [ ] Something happened: each of the eight tiles once; the fall report takes a photo; receipt shows
- [ ] Rounds tab lists the queue; Handoff tab writes a handoff and the incoming person reads it
- [ ] Offline: turn off Wi-Fi, chart a check as A, lock, unlock as B, turn Wi-Fi on; the check arrives as A's
- [ ] Restart the iPad: it comes back into Haven (after App Lock is on), not a blank white screen

### Sept 30, evening

- [ ] Run the wipe dry run; confirm the counts look like the testing that was done
- [ ] Run the wipe; the verification section shows 0 test rows left and every protection back on
- [ ] Timeclock off at Homewood; the 5:30 AM Oct 1 job turns it back on
- [ ] iPads stay enrolled; PINs stay set
