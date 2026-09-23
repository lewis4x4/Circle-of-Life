# Floor Tablet and Kiosk: Design Contract

The prototype Brian approved on 2026-09-23 is the visual contract for COL-691 (floor app) and COL-692 (kiosk). The built screens must look at least as good as the reference renders in `reference/`: same layout, zone sizes, type scale, spacing, touch sizes, color roles, states and copy. The only departures allowed are the house-law translations in section 2. Anything else that differs is a defect the fidelity gate (section 6) catches.

- **Reference renders:** `reference/*.png`, 2x, 1180 x 820 (iPad A16 held sideways). Filenames are the state names the capture script reproduces.
- **Static snapshots:** `static/*.html`, the same states as plain HTML and CSS. Open one in a browser to inspect exact sizes, colors and spacing with dev tools.
- **Canvas source:** `source/*.dc.html`, the prototype files as they live on the Design canvas. Reference only; never import them into the app.
- **Live prototype:** "Haven Floor Tablet and Kiosk Prototype" on claude.ai (Brian's account, https://claude.ai/artifact/YFqHhqWW3sUbs5vHjYGGwr). Brian can click through it with Play; the build works from the files here.
- **Sample people and residents** in the prototype are fictional. The demo seed reuses them so built captures compare one to one. They never go into COL data.

## 1. What must match

| Area | Floor tablet (dark) | Kiosk (light) |
|---|---|---|
| Canvas | 1180 x 820 landscape; also works at 820 x 1180 portrait with no horizontal scroll | same |
| Chrome | Top bar 56 px; bottom tab bar 72 px with Now, Rounds, Residents, Report, Handoff; active tab has a 2 px top edge in the primary color | Header band 88 px (home 128 px) with title left, time and facility right, Back button 52 px |
| Main layout | Now: list column flexes, residents rail 360 px, my-shift strip 64 px above the tabs | Home: Staff card 330 px wide left, 2 x 2 entry cards right, Leaving bar 76 px full width |
| Rows and tiles | Now rows 64 px: 3 px status bar, room, resident and check, due time, status pill, Done button 108 x 48; rail tiles 76 px in two columns | Entry cards fill the grid; open-visit rows 84 px |
| Touch sizes | 44 px minimum, 48 px for list actions, 64 px or more for primary actions; PIN keys 84 px tall in a 348 px 3-column grid | Keypad keys 88 px tall in a 390 px grid; fields 60 px (PIN and employee number boxes 84 px); primary action 72 px |
| Type scale (px / weight) | Lock title 40/600; roster name 24/600; PIN name 30/600; screen titles 22 to 28/600; resident name in row 17/600 with 13 sub line; due time 14; pills 11/600; rail name 14/600 with 12 note; question 34/600 with 21/500 options; event tile word 19/600 | Facility name 36/600; welcome 30/600; entry title 24/600 with 16 sub; Staff 34/600; field label 17 to 18/600; input 20; keypad digit 32; action 22/600; confirmation 44/600 with 19 to 21 body |
| Radii | Buttons and chips 8; tiles and cards 10 to 14; PIN keys 12 | Buttons 10 to 12; cards 14 to 16; keys 14 |
| Color roles | Overdue red, due amber, upcoming neutral, done neutral with check; one event color for Something happened; primary for Done, Unlock, Save | Header band and primary actions in the deep chrome color; white cards on a light canvas; red-brown text for the sick-today warning |
| Copy | Exactly the words in the renders ("Who's on shift?", "Tap your name. Only people clocked in at the front door show here.", "Not listed? Use employee number", "Something happened", "Chart 9:30 check", "Know before you go in") | Exactly the words in the renders ("Welcome. Tap who you are.", "Leaving? Sign out here", "Your name is on every floor tablet now. Grab any tablet, tap your name and enter your PIN.") |
| Icons | lucide-react stroke icons at 16 to 30 px (map in section 4) | same |
| Motion | None beyond pressed states; respect `prefers-reduced-motion` | same |

## 2. House-law translations (the only allowed departures)

1. **Font.** The prototype uses IBM Plex Sans. Build with the house sans (`font-sans`). Keep every size and weight from section 1.
2. **No monospace for labels, rooms or times** (constitution rule 12). Room numbers, due times, the clock and counts use `font-sans` with `tabular-nums`. Monospace stays only for code-like values, of which these screens have none.
3. **No all-caps mono labels.** Section labels such as "TODAY'S CHECKS", "WHAT HAPPENED" and "MY SHIFT" become sentence case ("Today's checks", "What happened", "My shift") at the same size and position in the muted color. Status pills use the house value-derived `StatusPill` with text such as "10 min over", "Due now", "In 20 min", "Watch", "2 unsent".
4. **Semantic tokens, never raw hex.** Use the token map in section 3. The floor app sits under the forced-dark caregiver tokens (`.dark` plus `.caregiver-shell`); the kiosk sits under the forced-light tokens. Where a house token reads warmer than the prototype's cool graphite, the house token wins. Chrome must not share the canvas value (rule 11).
5. **Data-state machines.** Every data surface renders one of `idle | loading | error | success-empty | success-populated` with operator copy. The prototype only shows populated states; design the others in the same style.

## 3. Token map

| Prototype value | Role | House token |
|---|---|---|
| `#0F1318` | Floor canvas | `bg-background` (dark) |
| `#0B0F13` | Floor top bar and tab bar | `--chrome-primary`, text `--chrome-foreground` |
| `#12171D` | Residents rail, my-shift strip, action bars | `--chrome-secondary` |
| `#161C23` | Cards, tiles, list surfaces | `bg-card` |
| `#1D252E` | Raised fill (avatars, progress track) | `bg-muted` |
| `#2A333E`, `#3A4552` | Hairlines, outlined buttons | `border-border`, `border-input` |
| `#E8ECF1`, `#A3ADBA`, `#8791A0` | Text, secondary, tertiary | `text-foreground`, `text-muted-foreground`, `text-muted-foreground/80` |
| `#2F6DB0` fill, `#7FB2E5` accent, `#1B3350` selected chip | Primary action, focus and selection | `bg-primary` / `text-primary-foreground`, `text-primary`, `bg-primary/20` with `border-primary` |
| `#F0676B` on `#351B1E` | Overdue pill and bar | `StatusPill` destructive tone |
| `#E8A93A` on `#33291A` | Due, watch, unsent | `StatusPill` warning tone |
| `#C8742A` | Something happened | the token the caregiver "Something happened" button uses today |
| `#F2F3F5` | Kiosk canvas | `bg-background` (forced light) |
| `#FFFFFF` | Kiosk cards and inputs | `bg-card` |
| `#0B1D34` | Kiosk header band and primary actions | `--chrome-primary` with `--chrome-foreground` |
| `#D5DAE1`, `#B9C1CC` | Kiosk borders and input borders | `border-border`, `border-input` |
| `#121820`, `#4A5461` | Kiosk text, secondary | `text-foreground`, `text-muted-foreground` |
| `#9A3412` | Sick-today warning line | `text-destructive` |

A value with no fitting token gets a new token in the floor or kiosk theme scope, named for its role. Never inline a hex in a component.

## 4. Components and icons

Build these once and reuse them: `FloorShell`, `FloorTopBar`, `FloorTabBar`, `RosterTile`, `PinPad`, `NowRow`, `ResidentRailTile`, `MyShiftStrip`, `ChoiceChip` (`aria-pressed`), `ResidentHeader`, `InfoCard`, `EventTile`, `QuestionOption`, `KioskHeader`, `KioskEntryCard`, `KioskKeypad`, `KioskField` (label bound to input), `YesNoToggle`, `OpenVisitRow`, `ConfirmPanel` (`role="status"`). Components stay under 300 lines.

| Prototype icon | lucide-react |
|---|---|
| clock, check, back, wifi, switch | `Clock`, `Check`, `ArrowLeft`, `Wifi`, `Repeat` |
| Now, Rounds, Residents, Report, Handoff tabs | `List`, `ClipboardCheck`, `Users`, `TriangleAlert`, `ArrowLeftRight` |
| delete key, leaving, lock, search | `Delete`, `LogOut`, `Lock`, `Search` |
| provider, vendor, inspector, visitor | `Activity`, `Truck`, `Shield`, `User` |
| Fall, Hurt, Sick or not themselves, Upset or behavior | `TrendingDown`, `SquarePlus`, `Thermometer`, `Frown` |
| Wandering or left, Medicine, Family or complaint, Building or other | `MapPin`, `Pill`, `Users`, `House` |

## 5. Screens

| Ref | Route and state | Must show |
|---|---|---|
| `01-floor-lock` | `/floor/lock`, two people on the clock | Device line (facility, tablet name, online, time), title, subtitle, roster tiles 300 x 220 (last person first with "Last on this tablet"; "2 unsent" pill from the local queue), "Not listed? Use employee number", lock-rules footer |
| `02-floor-pin`, `02b-floor-pin-ready` | `/floor/lock` after tapping a name, 4 then 6 digits | "Not you" back, avatar 96 px, name, clocked-in line, 6 dots, helper line, keypad with Clear and Delete, Unlock button only at 6 digits |
| `03-floor-now` | `/floor` | Top bar (avatar, name, role, shift, since time, tablet name, sync, time, Switch), Now title and counts, 6 check rows and 2 task rows, residents rail with counts and 8 tiles, All residents link, Something happened button, my-shift strip with handoff time, tabs |
| `04-floor-resident` | `/floor/residents/[id]` | Back, name with Watch pill, room and reason line, Something happened and Chart check actions, three cards (Today's checks, Watch and follow-ups, Know before you go in), Full record and history |
| `05-floor-check` | `/floor/check/[taskId]`, overdue check | Title and room, "10 min over" pill, How is she (8 chips, one pick), Where is she (location chips from `observation_vocab`), Did you help with (3, any), Anything wrong (5, any), Why late (required when over), footer with charted-by line, Cancel and Save check |
| `06-floor-something-happened` | `/floor/report` | Who chips with room, Someone else search, eight tiles in a 4 x 2 grid, 150 px tall |
| `07-floor-fall-question`, `07b-floor-fall-sent` | `/floor/report` after Fall | Title with resident and room, step counter and progress bar, one question with large options; sent state with answers summary, Start over, Back to Now |
| `10-kiosk-home` | `/kiosk` | Header band with Circle of Life, facility, time and date; welcome line; Staff card; four entry cards; Leaving bar |
| `11-kiosk-staff-number`, `11b-kiosk-staff-pin-ready` | `/kiosk/staff` | Employee number box and PIN dots with the active one outlined, helper line, keypad with Clear and Next (Delete in PIN stage), Continue at 6 digits, privacy footer |
| `12-kiosk-clock-in`, `13-kiosk-clocked-in` | `/kiosk/staff` identified, then punched | Greeting, current state and last punch, one large valid action, time, Not you link; confirmation with the floor-tablet line and 5-second reset |
| `14-kiosk-visitor`, `14b-kiosk-visitor-sick-yes`, `15-kiosk-provider` | `/kiosk/sign-in/[kind]` | Two-column form, labeled fields, Yes and No toggle, warning line on Yes, visitor-log line, Sign in |
| `16-kiosk-signed-in` | confirmation | Check, time, reminder to sign out, Done |
| `17-kiosk-leaving`, `17b-kiosk-signed-out` | `/kiosk/leaving` | Prompt, search field, hint line, matches only after 3 letters, Sign out per row; signed-out confirmation with in and out times |

## 6. Fidelity gate

1. `scripts/floor/seed-prototype-demo.mjs` seeds the Haven Demo Workspace only with the prototype's fictional staff (Ashley W., Dana R.), residents and rooms (Evelyn Carter 101, Harold Nguyen 102, Ruth Simmons 103, Walter Brooks 104, Mae Johnson 105, Frank Delgado 106, Lorraine Pitts 107, George Adams 108, Curtis Hale 110) and checks at the rendered due times.
2. The Playwright project `floor-kiosk` freezes the clock (`page.clock.setFixedTime`) at 9:40 AM Eastern for floor states, 6:58 AM for kiosk staff states, 10:12 AM for sign-in and 11:40 AM for leaving.
3. `scripts/floor/capture-built-screens.mjs` reproduces every state in section 5 and writes `built/<ref>.png` (1180 x 820, 2x) and `built/portrait/<ref>.png` (820 x 1180). It composes `compare/<ref>.png` with the reference on the left and the build on the right by rendering both images in a Playwright page (no new image dependency).
4. The orchestrator and the oracle open every `compare/*.png` and fill `FIDELITY.md`: one row per reference with `MATCH` or `DEVIATION` and a note. A deviation is allowed only when it is one of the section 2 translations and the note names which. Any other deviation is a defect to fix and re-capture.
5. Pass: every row `MATCH` or an allowed translation, portrait captures show no horizontal scroll and no clipped control, and axe reports no violations on every route.

## 7. Accessibility floor

WCAG AA contrast on both themes; visible focus rings; every control a real `button`, `a` or `input` with a label; icon-only buttons carry `aria-label`; chips expose `aria-pressed`; confirmations and PIN errors announce through `role="status"`; `prefers-reduced-motion` respected; no text below 12 px.
