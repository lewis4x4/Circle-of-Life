# Tablet lockdown: front-door kiosk and floor tablets (COL-352, COL-677)

Mission alignment: pass. The front-door kiosk is a punch and visitor sign-in station; it holds no user session, no manager capability and never shows a resident name. A floor tablet belongs to the building, not a person: it holds a session only while one person has it unlocked, every entry is attributed to that person, and nothing clinical stays on it after it locks. Nothing here touches medication administration, which stays in the eMAR software, or changes clinical or payroll decisions.

This document describes how Mosyle managed, supervised iPads are locked to Haven. Any Mosyle or iOS step not verified against current Mosyle or Apple documentation is marked `TBD verify`. Keep device serial numbers, Wi-Fi passwords and Mosyle credentials out of this repository; they belong in the private operating evidence.

## The two kinds of tablet

| | Front-door kiosk | Floor tablet |
|---|---|---|
| Homewood devices | `HL-KIOSK-01` at the front door | `HL-FLOOR-01` and `HL-FLOOR-02` for the two med techs on shift; `HL-FLOOR-03` is the spare, set up the same way |
| Web clip | `https://circleoflifealf.com/kiosk` | `https://circleoflifealf.com/floor` |
| Enroll with | A `Front-door kiosk` code, typed at `/kiosk/setup` | A `Floor tablet` code, typed at `/floor/setup` |
| iPad passcode | None | None. The Haven lock screen is the lock. |
| Auto-Lock | Never, screen on while charging | 5 minutes |
| Who uses it | Staff clocking in and out; visitors, healthcare providers, vendors and inspectors signing the AHCA visitor log | Med techs on shift: Smart Rounding, Something happened reports, assigned tasks, resident context and handoff |
| Session | None, ever | One person at a time, from unlock to lock |

The old kiosk address `https://circleoflifealf.com/kiosk/timeclock` now redirects to `/kiosk/staff`. Point every web clip at `/kiosk`, not at the old address.

Name each device in Mosyle with its label (`HL-KIOSK-01`, `HL-FLOOR-01` and so on) and use the same label as the tablet name when enrolling it in Haven, so the facility `Timeclock` tab and Mosyle list the same names.

## What both kinds need from the device

- A modern Safari (or the Mosyle web clip) with JavaScript, cookies and IndexedDB allowed for `circleoflifealf.com`. The device token and the offline queues live in IndexedDB; clearing site data un-enrolls the tablet.
- Network access to `https://circleoflifealf.com` and `https://manfqmasfqppukpobpld.supabase.co`. Nothing else is required. Both kinds work briefly offline and sync when the network returns; walk the building on the facility Wi-Fi before go-live to find dead spots.
- The device clock set automatically. A punch whose device time differs from server time by more than 120 seconds is flagged `clock_skew` for the manager; it is never rejected. Offline entries replay in the order the tablet captured them, so a clock that jumps backwards can reorder them.
- For the kiosk, a badge reader that behaves as a keyboard (keyboard wedge) is optional. It types into the focused `Badge or employee number` field and its trailing Enter moves focus to `PIN`. No camera, NFC or Bluetooth pairing is used.

## Supervision and enrollment in Mosyle

1. Add each iPad to Apple Business Manager and assign it to the Mosyle MDM server so it enrolls supervised on activation. `TBD verify` the current Apple Business Manager and Mosyle enrollment path.
2. In Mosyle, put the kiosk and the floor tablets in separate device groups (for example `Homewood kiosk` and `Homewood floor tablets`) so each kind gets its own web clip, Auto-Lock and passcode profile. `TBD verify` current Mosyle group and profile names.
3. Name each device with its label (see the table above).

## Lock each tablet to its web clip

Mosyle offers two ways to hold an iPad on one screen. Choose one, and use the same choice for every tablet of that kind.

- **Kiosk mode (Single App Mode) on a Mosyle web clip.** Create a full screen web clip for the address in the table above, then apply Mosyle Kiosk Mode to that web clip so the home button, app switcher and notifications are unavailable. `TBD verify` that Mosyle Kiosk Mode accepts a web clip as the locked app on the current iPadOS.
- **Single App Mode on Safari with a restrictions profile.** Lock Safari as the single app and restrict it to the allowlist below. `TBD verify` the exact restriction keys in Mosyle for URL allowlists.

Either way, apply a restrictions profile to both kinds that:

- Blocks Settings, the App Store, Screen Time changes, and account changes.
- Disables Control Center and Notification Center on the lock screen and inside the locked app.
- Turns off AirDrop, iCloud sign in, Safari private browsing, and clearing website data by the user.
- Allows only `circleoflifealf.com` and `manfqmasfqppukpobpld.supabase.co` in the web content filter. `TBD verify` the Mosyle content filter format.

Then, by kind:

- **Kiosk:** Auto-Lock Never, and keep the screen on while charging. `TBD verify` the Mosyle key for Auto-Lock while on power.
- **Floor tablets:** Auto-Lock 5 minutes and no passcode policy, so no iPad passcode is set. `TBD verify` the Mosyle keys for Auto-Lock and for leaving the passcode unset on a supervised device. Anyone can wake a floor tablet; what they see is the Haven lock screen, because Haven locks the moment the screen is hidden.

## Mounting, carrying and power

- **Kiosk:** mount in the locked enclosure at the front door at a height a seated or standing person can reach, with the badge reader, if used, fixed beside the screen. Use a captive charging cable. Face the screen away from resident common areas so a PIN entry is not visible from a chair or bed. The tablet should never need to leave the enclosure; a low battery is a maintenance ticket, not a reason to unplug.
- **Floor tablets:** med techs carry them on shift. Charge `HL-FLOOR-01` and `HL-FLOOR-02` between shifts, and keep `HL-FLOOR-03` charged and enrolled so it can replace either one without setup. Where they charge is the facility's choice; keep it out of resident rooms.
- Keep the wall uPunch clock in place during the parallel run (see `docs/homewood/timeclock-cutover.md`).

## Enroll a tablet in Haven

1. An owner or organization administrator opens the facility in Haven and chooses the `Timeclock` tab under facility settings.
2. Under `What is this tablet for?`, choose `Front-door kiosk` or `Floor tablet`, then tap `Enroll a tablet`. Haven shows an 8 character code that is valid for 15 minutes, can be used once, and only enrolls that kind of tablet.
3. On the tablet, open the setup screen Haven names under the code (`/kiosk/setup` for the kiosk, `/floor/setup` for a floor tablet), enter the code and the tablet's label. The tablet confirms the facility name and moves to its home screen.
4. The facility `Timeclock` flag must be on before anyone can punch or unlock. Turn it on from the same tab.
5. Kiosk: confirm a test punch with a synthetic or administrator credential, then void it from the timesheet with the reason `duplicate`. Floor tablet: once someone is clocked in at the kiosk, confirm their name appears on the floor tablet and that they can unlock it with their PIN, then tap `Switch`.

## How a floor tablet locks

A floor tablet lists only the staff clocked in right now at the kiosk (or on a meal break) in the facility's floor roster roles (by default med tech and facility administrator; set on the `Timeclock` tab). A person unlocks it by tapping their name and entering the same 6 digit PIN they punch with. The same lockouts as the kiosk apply: 5 wrong PINs lock that PIN for 15 minutes, and 20 wrong PINs on one tablet in 10 minutes pause that tablet for 5 minutes.

The tablet locks, and returns to the lock screen, when any of these happens:

- The screen is hidden: the iPad sleeps (Auto-Lock after 5 minutes, or the side button) or the web clip leaves the screen.
- Nobody touches it for the facility's idle setting (`Timeclock` tab, default 3 minutes).
- The person taps `Switch` to hand it to someone else.
- The heartbeat, every 60 seconds, finds the person has clocked out at the kiosk or the tablet has been revoked.
- 12 hours have passed since the unlock.

On lock, Haven ends the unlock record, signs the session out on the tablet and clears what was on screen.

"Not listed? Use employee number" lets someone unlock with employee number and PIN when they are not on the roster (for example, the kiosk was offline when they clocked in). Haven records that unlock as off the clock, and the manager sees an `unlock_without_punch` exception on that person's timesheet.

## Replacement or loss

1. In Haven, open the facility `Timeclock` tab and tap `Revoke` beside the tablet. The device token stops working on the next call; an unlocked floor tablet locks on its next heartbeat, and an offline entry still queued on that tablet can no longer sync.
2. In Mosyle, mark the device lost and wipe it remotely. `TBD verify` the current Mosyle lost mode and wipe commands.
3. Enroll the replacement with a new code of the same kind (for a floor tablet, bring out `HL-FLOOR-03`). Codes and tokens are never reused.
4. Kiosk: ask the staff who punched there during the last shift to confirm their punches with the manager; a punch still queued when the tablet was lost shows as a gap on the timesheet and is corrected with `device_outage`. Floor tablet: ask the people who used it during the last shift to check that their rounding checks and reports are there, and re-enter anything missing.

## What is and is not stored on a tablet

Front-door kiosk:

- The device token, in IndexedDB.
- The offline punch queue, in IndexedDB, until it syncs. A queued punch keeps its PIN in page memory only; a reload loses it and the server records the replay as `rejected_offline_sync` for the manager.
- No user session, no manager screen, no PIN in storage and no badge number in storage. The server only ever holds an HMAC of the badge; rotating `TIMECLOCK_BADGE_HMAC_SECRET` invalidates every badge and requires a re-scan.
- No resident names, ever. Visitors type the name of the resident they are visiting; the front desk matches it in Haven. Signing out lists visitor names only after 3 letters are typed.

Floor tablet:

- The device token, in IndexedDB.
- Offline Smart Rounding checks and Something happened reports, in IndexedDB, until they sync. Each queued entry carries the unlock it was captured under, so it syncs as the person who entered it even after someone else unlocks the tablet. These are the only clinical entries that stay on the tablet, and only until they sync; keep the tablets on Wi-Fi so the queues drain.
- A session only while someone has it unlocked. After it locks there is no session on the tablet, and the screens and cached data from the last person are cleared.
- No PIN in storage, and no medication administration, eMAR, controlled counts or med passes.

Revoking a device or a credential happens in Haven admin, never on a tablet.
