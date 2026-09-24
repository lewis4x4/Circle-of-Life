# Floor Tablet and Kiosk: Fidelity Sheet (COL-694)

The approved prototype (`reference/`) is compared with the build (`built/`, `built/portrait/`) in `compare/<ref>.png`: reference left, build right, both 1180 x 820 at 2x. Captures come from `scripts/floor/capture-built-screens.mjs` against a production build (`next start`) on Haven HFO Staging, with the demo seed `scripts/floor/seed-prototype-demo.mjs` in the facility "Fidelity Demo - Floor Kiosk" and the browser clock frozen per `DESIGN.md` §6.

Reviewed by the orchestrator image by image; the oracle reviews the same set.

## How to read a row

- **MATCH**: same zones, sizes, type scale, spacing, touch sizes, color roles, states and copy, apart from the house-law translations in `DESIGN.md` §2 that apply to every screen:
  - §2.1 house sans instead of IBM Plex Sans (the house face runs slightly wider, so a few long titles wrap where the prototype did not);
  - §2.2 no monospace: rooms, times and counts in `font-sans` with `tabular-nums`;
  - §2.3 sentence case instead of all-caps mono labels, and the house `StatusPill` (with its dot) for pills;
  - §2.4 semantic tokens: the house dark canvas is warm near-black and the chrome sits lighter than the canvas (rule 11); the house primary is a desaturated blue carrying dark text; the kiosk header band is the house deep chrome, not navy;
  - §2.5 data-state machines (not visible in populated captures).
- **Data** notes name differences that come from the seeded data or the server clock, not from the design: the facility is "Fidelity Demo - Floor Kiosk" (owner rule: all demo data in one clearly named staging facility), and times written by the server (a punch, a sign-in, a sign-out) show the real time of the capture run.
- **Spec** notes name content that spec 40 fixes and the prototype drew differently. The GOAL makes the spec the source of truth for what the screens do and `DESIGN.md` the source of truth for how they look; where the two disagree on content, the spec wins and the row says which clause.

Sizes were measured live against `DESIGN.md` §1 after the px scale fix (the app root is 14px; `.floor-shell` and `.kiosk-shell` pin Tailwind's spacing and type scale to px): roster tile 300 x 220, PIN keys 84 in a 348 grid, top bar 56, tab bar 72, Now rows 64, Done 108 x 48, rail 360 with 76 tiles, my-shift strip 64, event tiles 150, question 34/600 with 21/500 options; kiosk header 128 (home) and 88, keypad 88 in a 390 grid, fields 60, PIN and number boxes 84, primary 72.

## Landscape, 1180 x 820

| Ref | Result | Notes |
|---|---|---|
| 01-floor-lock | MATCH | §2.1 to §2.4. "Last on this tablet" in sentence case; "2 unsent" as a warning `StatusPill`. Data: facility name. |
| 02-floor-pin | MATCH | §2.1, §2.4 (avatar and dots in the house primary). |
| 02b-floor-pin-ready | MATCH | §2.1, §2.4 (Unlock in the house primary with dark text). |
| 03-floor-now | MATCH | §2.1 to §2.4. Rail shows the eight prototype residents with their notes; strip shows clock-in, "7:30 Rounds: 12 of 13 charted", "8:40 Handoff note read", "9:12 Report: Upset or behavior, Rm 106" and "Handoff 3:00 PM". Spec: the Tasks rows are the person's open witness statements (spec 40 §6.3 "the signed-in person's assigned tasks"; Haven has no staff task list with due times, so "Water pitchers" and "Shower assist" cannot exist); the strip carries the chip kinds spec 40 §6.3 names (clock-in, rounds charted, reports filed, handoff read, handoff time), so the prototype's "Follow-up, Ruth S." chip has no source. Data: check sub-lines read "Safety check" (no other check kind in the data); "12 of 13" counts the overdue 9:30 check as due; rail notes come from real escalations, watches, holds and next checks; "All 35 residents" counts George Adams on hospital hold. |
| 04-floor-resident | MATCH | §2.1 to §2.4. Data: the seeded watch, follow-up and know-before-you-go-in fields (one watch; "High fall risk", "Walker within reach", special instructions) instead of the prototype's sample lines. Charted-by names come from `floor_staff_display_names`. |
| 05-floor-check | MATCH | §2.1 to §2.4. Same chips, same selections (Awake, In chair, Offered fluids). "Refused help" wraps to a second row (§2.1 wider face). |
| 06-floor-something-happened | MATCH | §2.1, §2.3, §2.4. Medicine uses lucide `Pill` as `DESIGN.md` §4 specifies. |
| 07-floor-fall-question | MATCH | §2.1 to §2.4. Spec: the third answer reads "Badly (bleeding will not stop, cannot move or stand, bone looks wrong, passed out)" from `src/lib/care-events/tiles.ts`, because spec 40 §6.6 requires the same data and level engine as `/caregiver/report`; the prototype's "Needs more than first aid" is the separate care question. |
| 07b-floor-fall-sent | MATCH | §2.1 to §2.4. Spec: "Did anyone see it happen?" answers Yes or No from `tiles.ts` (spec 40 §6.6); the prototype's "I arrived after" is not an answer the level engine knows. The flow also shows one send screen before this receipt (the level read-back the caregiver flow has); it is not a reference state. |
| 10-kiosk-home | MATCH | §2.1, §2.3 ("Circle of Life" in normal case), §2.4. "Healthcare provider" and "Inspector or official" wrap (§2.1). Data: facility name. |
| 11-kiosk-staff-number | MATCH | §2.1, §2.2 (employee number in `tabular-nums`), §2.4. Data: facility name. |
| 11b-kiosk-staff-pin-ready | MATCH | §2.1, §2.2, §2.4. |
| 12-kiosk-clock-in | MATCH | §2.1, §2.2, §2.4. Data: "Last clock out: Tuesday, 7:06 PM" (the seeded shift the day before the capture date). |
| 13-kiosk-clocked-in | MATCH | §2.1, §2.4. Data: "Clocked in at" shows the server's punch time for the capture run. |
| 14-kiosk-visitor | MATCH | §2.1, §2.4. The sick question starts unselected (constitution: primitives never pre-select); the capture taps No, as rendered. |
| 14b-kiosk-visitor-sick-yes | MATCH | §2.1, §2.4 (warning line in `text-destructive`). |
| 15-kiosk-provider | MATCH | §2.1, §2.4. Capture taps No, as rendered. |
| 16-kiosk-signed-in | MATCH | §2.1, §2.4. Data: "Signed in at" shows the server's time for the capture run. |
| 17-kiosk-leaving | MATCH | §2.1, §2.2, §2.4. Nothing listed before 3 letters (verified in Playwright). |
| 17b-kiosk-signed-out | MATCH | §2.1, §2.4. Data: "out" shows the server's sign-out time for the capture run. |

## Portrait, 820 x 1180

All 20 states captured in `built/portrait/`. Every state: no horizontal scroll (`scrollWidth <= clientWidth`) and no clipped control. Layout adaptations: the Now residents rail sits under the list and "Something happened" gets its own bar above My shift below 1024 px; the kiosk home Staff card sits above the entry grid; the kiosk staff keypad stacks under the fields; the sign-in form is one column below 1000 px.

## Accessibility

axe (`@axe-core/playwright`, WCAG 2 A and AA) reports zero violations on every floor, kiosk and setup route at both orientations in the Playwright `floor-kiosk` project.
