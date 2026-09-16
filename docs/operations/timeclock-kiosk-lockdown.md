# Timeclock kiosk lockdown (COL-352)

Mission alignment: pass. The tablet is a single purpose punch station; it holds no user session, no manager capability and no resident data, and nothing here changes clinical or payroll decisions.

This document describes how a Mosyle managed, supervised iPad is locked to the Haven kiosk at `https://circleoflifealf.com/kiosk/timeclock`. Any Mosyle or iOS step not verified against current Mosyle or Apple documentation is marked `TBD verify`. Keep device serial numbers, Wi-Fi passwords and Mosyle credentials out of this repository; they belong in the private operating evidence.

## What the kiosk needs from the device

- A modern Safari (or the Mosyle web clip) with JavaScript, cookies and IndexedDB allowed for `circleoflifealf.com`. The device token and the offline punch queue live in IndexedDB; clearing site data un-enrolls the tablet.
- Network access to `https://circleoflifealf.com` and `https://manfqmasfqppukpobpld.supabase.co`. Nothing else is required.
- The device clock set automatically. A punch whose device time differs from server time by more than 120 seconds is flagged `clock_skew` for the manager; it is never rejected.
- Screen stays on while charging. The kiosk clears typed input after 30 seconds without input and resets its receipt after 5 seconds, so an always-on screen shows no personal data.
- A badge reader that behaves as a keyboard (keyboard wedge). It types into the focused `Badge or employee number` field and its trailing Enter moves focus to `PIN`. No camera, NFC or Bluetooth pairing is used.

## Supervision and enrollment in Mosyle

1. Add the iPad to Apple Business Manager and assign it to the Mosyle MDM server so it enrolls supervised on activation. `TBD verify` the current Apple Business Manager and Mosyle enrollment path.
2. In Mosyle, put the device in a dedicated device group (for example `Homewood timeclock`) so the profiles below apply only to punch stations. `TBD verify` current Mosyle group and profile names.
3. Name the device in Mosyle with the facility and its location inside the building (for example `Homewood front hall`). Use the same label when enrolling it in Haven.

## Lock the tablet to the kiosk

Mosyle offers two ways to hold an iPad on one screen. Choose one.

- **Kiosk mode (Single App Mode) on a Mosyle web clip.** Create a web clip for `https://circleoflifealf.com/kiosk/timeclock` with full screen enabled, then apply Mosyle Kiosk Mode to that web clip so the home button, app switcher and notifications are unavailable. `TBD verify` that Mosyle Kiosk Mode accepts a web clip as the locked app on the current iPadOS.
- **Single App Mode on Safari with a restrictions profile.** Lock Safari as the single app and restrict it to the allowlist below. `TBD verify` the exact restriction keys in Mosyle for URL allowlists.

Either way, apply a restrictions profile that:

- Blocks Settings, the App Store, Screen Time changes, and account changes.
- Disables Control Center and Notification Center on the lock screen and inside the locked app.
- Sets Auto-Lock to Never and keeps the screen on while charging. `TBD verify` the Mosyle key for Auto-Lock while on power.
- Turns off AirDrop, iCloud sign in, Safari private browsing, and clearing website data by the user.
- Allows only `circleoflifealf.com` and `manfqmasfqppukpobpld.supabase.co` in the web content filter. `TBD verify` the Mosyle content filter format.

## Mounting and power

- Mount at a height that a seated or standing person can reach, with the badge reader fixed beside the screen. Face the screen away from resident common areas so a PIN entry is not visible from a chair or bed.
- Use a locking wall or counter mount and a captive charging cable. The tablet should never need to leave the mount; a low battery is a maintenance ticket, not a reason to unplug.
- Keep the wall uPunch clock in place during the parallel run (see `docs/homewood/timeclock-cutover.md`).

## Enroll the tablet in Haven

1. An owner or organization administrator opens the facility in Haven, chooses the `Timeclock` tab under facility settings, and taps `Enroll a tablet`. Haven shows an 8 character code that is valid for 15 minutes and can be used once.
2. On the tablet, the kiosk shows `Set up this tablet`. Enter the code and a tablet name. The kiosk confirms the facility name and moves to the punch screen.
3. The facility `Timeclock` flag must be on before anyone can punch. Turn it on from the same tab.
4. Confirm a test punch with a synthetic or administrator credential, then void it from the timesheet with the reason `duplicate`.

## Replacement or loss

1. In Haven, open the facility `Timeclock` tab and tap `Revoke` beside the tablet. The device token stops working on the next call; a queued offline punch on that tablet can no longer sync.
2. In Mosyle, mark the device lost and wipe it remotely. `TBD verify` the current Mosyle lost mode and wipe commands.
3. Enroll the replacement with a new code. Codes and tokens are never reused.
4. Ask the staff who used that tablet during the last shift to confirm their punches with the manager; a punch that was still queued when the tablet was lost shows as a gap on the timesheet and is corrected with `device_outage`.

## What is not on the tablet

- No user session and no manager screen. Revoking a device or a credential happens in Haven admin, never on the kiosk.
- No PIN in storage. A queued offline punch keeps its PIN in page memory only; a reload loses it and the server records the replay as `rejected_offline_sync` for the manager.
- No badge number in storage. The server only ever holds an HMAC of the badge; rotating `TIMECLOCK_BADGE_HMAC_SECRET` invalidates every badge and requires a re-scan.
