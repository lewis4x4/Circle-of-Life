# Segment handoff — COL-420 resident quick-entry dialogs

**See also:** Autonomous loop continuity (BOOT / FIND / RECORD) — `docs/Autonomous.md`.

## Summary

- **Segment id:** `COL-420-quick-entry-dialogs`
- **Mission alignment:** `pass` — caregivers and administrators can read and complete the three resident
  quick-entry forms (behavior, condition, general note) on the Haven shell in either theme; clinical defaults,
  validation, attribution, timestamps, notification flags and save destinations are unchanged.
- **Scope:** `src/components/admin/resident-log-modals.tsx` (rebuilt on the shared Haven primitives, one
  neutral palette, labelled controls, footer actions, viewport-bounded scrolling, deterministic focus return),
  new `src/components/admin/resident-log-modals.test.tsx`, and a silent post-save refresh in
  `src/components/residents/ResidentDetailOverviewClient.tsx` so a successful save no longer unmounts the open
  dialog and drops its confirmation.
- **Out of scope:** the caregiver route-group shells, the shared `Button` disabled treatment (the dialogs
  override it locally), and the working-facility rule (still the header's selected facility, not the resident row).

## Implementation notes

- Root cause was hardcoded caregiver dark-palette classes (`bg-zinc-950`, `bg-black/25`, `text-primary-200`,
  `text-rose-200`, `text-teal-200`, `text-white`) inside a `DialogContent` that correctly renders `bg-card`.
  Theme variables did reach the portal; the classes simply never adapt to the theme.
- Native `<select>` replaced by the Radix `Select` primitive (themed popover menus, keyboard accessible).
  "Intervention effective?" maps its empty value through a `not_recorded` sentinel because Radix items cannot
  carry an empty string; the saved value is still `null` / `true` / `false`.
- Escape now returns focus to the opener (captured in `onOpenAutoFocus`, restored in `onCloseAutoFocus`).
  Radix alone left focus on `<body>` because the content focus scope re-runs during the exit animation.
- General note: heading matches the entry point; the note and vitals sections keep their separate save
  operations and the vitals section says it also runs the alert check.
- Debt: `eslint-suppressions.json` still carries six `react-hooks/set-state-in-effect` entries for this file
  (the effects are unchanged). The lint baseline should shrink when those effects are reworked.

## Verification

- Browser proof (light + dark, each opened dialog, contrast, axe, focus, select menus, narrow, duplicate
  Recent-activity actions; validation / aborted-save recovery / real saves on Haven HFO Staging):
  `/Users/brianlewis/Circle of Life/Haven Quick Entry Dialogs Evidence/SUMMARY.md`.
- `npx vitest run src/components/admin/resident-log-modals.test.tsx` — 4 passed.
- Gate artifact path: `test-results/agent-gates/2026-09-16T12-21-05-995Z-COL-420-quick-entry-dialogs.json`
- `npm run segment:gates -- --segment "COL-420-quick-entry-dialogs" --ui` result: PASS (migration replay skipped with `SKIP_PG_VERIFY=1`: no SQL changed and local Docker is off-limits on this Mac; CI runs the replay).

## Commit

- `fix(residents): quick-entry dialogs render on the Haven theme (COL-420)`
