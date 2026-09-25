# Homewood Test Window: Test Plan

Everything to test on the real iPads at Homewood before the Sept 30 wipe. Check a box when it works; write what you saw when it doesn't.

Window opened 2026-09-25 4:24 PM ET. Everything created at Homewood after that is test data and is wiped on the evening of Sept 30.

## Before testing

- [ ] All four iPads on iPadOS 27.0 (Mosyle, Devices Overview)
- [ ] Auto-Lock set by hand: HL-FLOOR-01 to 03 at 5 minutes, HL-KIOSK-01 at Never (Settings, Display & Brightness, Auto-Lock)
- [ ] Two med techs have an employee number and 6-digit PIN in Haven (Staff profile, Timeclock access)
- [ ] HL-KIOSK-01 enrolled: Haven Timeclock devices, kiosk code, typed into the Haven Kiosk web clip within 15 minutes, tablet name `HL-KIOSK-01`
- [ ] HL-FLOOR-01, 02 and 03 enrolled: floor code, typed into the Haven web clip, tablet names `HL-FLOOR-01` to `03`
- [ ] Smart Rounding test cadence open (the `homewood-test-window-open.sql` script)

## Kiosk: staff

- [ ] Med tech A clocks in with their PIN; confirmation says their name is now on the floor tablets
- [ ] Kiosk returns to home 5 seconds after a confirmation, and 30 seconds after no input on any screen
- [ ] Meal start, then meal end
- [ ] Only the one valid next action is offered (no clock in twice)
- [ ] Wrong PIN shows how many tries are left
- [ ] 5 wrong PINs lock that person for 15 minutes; an administrator unlocks them in Haven
- [ ] Clock out; the punch pair shows on the timesheet with the right times
- [ ] Offline: turn off the kiosk's Wi-Fi, clock in, turn Wi-Fi back on; the punch arrives with the time it was made

## Kiosk: visitors

- [ ] Visiting a resident: name, phone, resident's name typed, not sick; confirmation shows
- [ ] Visiting a resident, answering Yes to feeling sick: "Please see the front desk before you go in." and the entry is flagged
- [ ] Healthcare provider: agency or practice is required
- [ ] Vendor or contractor: company is required, purpose recorded
- [ ] Inspector or official: agency required; the administrator's Haven Home shows the inspector banner while the visit is open
- [ ] Leaving: nothing is listed until 3 letters are typed; sign-out works for each of the four
- [ ] No resident name appears anywhere on the kiosk
- [ ] Each entry shows in the staff visitor log with the typed name, Match resident works, and the AHCA print pack includes it

## Floor iPad: unlock

- [ ] "Who's on shift?" lists only people clocked in at the kiosk, most recent first
- [ ] Tap name, enter PIN, unlock; Unlock appears only at 6 digits; no system keyboard
- [ ] Wrong PIN message; lockout matches the kiosk
- [ ] "Not listed? Use employee number" unlocks someone not clocked in and flags it on their timesheet
- [ ] Switch from A to B; B sees only their own session
- [ ] Idle 3 minutes: Haven locks (the facility setting is 3; the iPad's own Auto-Lock is 5)
- [ ] A clocks out at the kiosk: the floor iPad locks A out within about a minute

## Floor iPad: work

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

## Sept 30, evening

- [ ] Run the wipe dry run; confirm the counts look like the testing that was done
- [ ] Run the wipe; the verification section shows 0 test rows left and every protection back on
- [ ] Timeclock off at Homewood; the 5:30 AM Oct 1 job turns it back on
- [ ] iPads stay enrolled; PINs stay set
