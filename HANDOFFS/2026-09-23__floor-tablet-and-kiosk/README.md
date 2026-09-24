# Floor Tablet and Kiosk Build Package (COL-677)

Everything Claude Code needs to build the shared floor tablets and the front-door kiosk end to end, in one autoloop run, to the approved prototype.

| File | What it is |
|---|---|
| `GOAL.md` | The autoloop briefing. Claude Code reads it first and runs the whole build from it. |
| `40-floor-tablet-and-kiosk.md` | The spec (becomes `docs/specs/40-floor-tablet-and-kiosk.md` in Part 1). |
| `design/DESIGN.md` | The design contract: what must match the prototype, the token map, the component list and the fidelity gate. |
| `design/reference/*.png` | 20 renders of the prototype at iPad size (the look the build must hit). |
| `design/static/*.html` | The same 20 states as plain HTML and CSS, for exact sizes and colors. |
| `design/source/*.dc.html` | The prototype's canvas files, reference only. |

## Fire it

```
cd "/Users/brianlewis/Circle of Life/Circle-of-Life"
claude
```

First message:

```
Read HANDOFFS/2026-09-23__floor-tablet-and-kiosk/GOAL.md in full and treat it as your briefing for this session. Then follow its First action.
```

Then:

```
/goal Every part of COL-677 (Parts 1 to 8 of HANDOFFS/2026-09-23__floor-tablet-and-kiosk/GOAL.md) shows a [PART N COMPLETE] block and was integrated by the orchestrator; npm run typecheck, lint, test and build exit 0 and the Playwright floor-kiosk project passes with output visible in the transcript; the transcript shows the FIDELITY table with all 20 reference screens MATCH or an allowed translation; the oracle's final review shows [PROOF PASS — CLEAN] with zero outstanding issues; all work is committed to branch blewis/col-677-floor-tablet-kiosk; output [GOAL COMPLETE] in the final turn.
```

Watch for `[DECOMPOSITION]`, then `[PART 1 COMPLETE]` to `[PART 8 COMPLETE]`, then `[PROOF PASS — CLEAN]`, then `[GOAL COMPLETE]`.

## Handing off the prototype: when and how

- **When:** at the start of this run. The prototype is already inside this package, so there is nothing separate to send. Part 1 commits it to `docs/designs/floor-tablet-kiosk/`, the floor and kiosk specialists must open each reference PNG before building that screen, and the oracle reviews every screen against it at the end.
- **How the build is held to it:** Part 8 seeds the prototype's sample people, freezes the clock at the same times, captures every built screen at iPad size, and writes a side-by-side image per screen (`docs/designs/floor-tablet-kiosk/compare/`, prototype left, build right). `FIDELITY.md` marks each one `MATCH` or names the allowed house-rule change (Haven's font, no monospace or all-caps labels, Haven's color tokens). Anything else goes back through the fix loop.
- **If you change the prototype before you fire it:** tell Claude to re-export the prototype into this package first, so the run starts from the current look.
- **After the run:** open the `compare/` images. That is the fastest way to confirm the build looks at least as good as what you approved.

## Linear

| Issue | Part |
|---|---|
| COL-677 | Parent |
| COL-690 | Parts 2 and 3: device kind, roster, PIN unlock, session |
| COL-691 | Part 4: `/floor` app |
| COL-692 | Part 5: `/kiosk` (delivers COL-450 and COL-169) |
| COL-693 | Part 6: rounding checks owned by on-clock staff |
| COL-694 | Part 8: verification and fidelity gate |
| COL-695 | Part 7 scripts, then your Oct 1 setup |

## Before and after

- Local `main` is behind `origin/main`; the briefing branches from `origin/main`, so nothing on your checkout needs to change first.
- PR #728 (COL-668, med-tech shift writer) is superseded. Close it unmerged.
- After you review and merge: work COL-695 in order. Run each `scripts/floor/*.sql` dry-run section first, then apply; issue PINs for all 20 Homewood staff; enroll HL-KIOSK-01 and HL-FLOOR-01 to 03; walk the building on Wi-Fi.
