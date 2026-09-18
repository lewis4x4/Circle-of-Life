# COL-410 — blank action buttons

`tailwind.config.ts` and `globals.css` declare `primary` as `DEFAULT` + `foreground` only.
There is no numeric scale, so every `*-primary-<shade>` utility compiles to nothing:
`bg-primary-600 text-white` puts white text on a transparent background and the control
is invisible except for its shadow.

Filed against 19 files. The actual reach was **61 files, 486 utilities**.

## What changed

Each utility moved onto the semantic token, carrying its shade over as an alpha step:

| Before | After |
|---|---|
| `bg-primary-600`, `bg-primary-500` | `bg-primary` |
| `hover:bg-primary-700` | `hover:bg-primary/90` |
| `bg-primary-50` / `bg-primary-100` | `bg-primary/5` / `bg-primary/10` |
| `bg-primary-100/50` | `bg-primary/5` (tint × alpha composed, not `/50`) |
| `border-primary-200` | `border-primary/20` |
| `text-primary-600/700/800` | `text-primary` |
| `dark:*-primary-*` beside a light sibling | dropped — `--primary` is already theme-aware (42% light, 54% dark) |

Twenty action sites also dropped `bg-primary … text-white` overrides that were fighting
`buttonVariants({ variant: "default" })`, which already supplies `bg-primary
text-primary-foreground`. `text-white` on a primary fill was a live dark-mode contrast bug:
`--primary-foreground` is near-black under `.dark`.

Two raw `<button>`s became `Button` / `buttonVariants` (`incidents/new` retry,
`compliance/deficiencies/analysis` segmented control).

## Gate

`scripts/lint-constitution.ts` gained `no-undefined-color-scale`, which flags any
`{bg,text,border,…}-{primary,secondary,muted,accent,destructive}-<digits>` under `src/`.
Unlike the other constitution rules it always walks all of `src/`, not the current
segment — an invisible control is not a segment-local concern.

Verified by reintroducing `bg-primary-600` into `src/app/(admin)/search/page.tsx`:

```
Constitution lint failed (1 finding):
src/app/(admin)/search/page.tsx:332 [no-undefined-color-scale] "bg-primary-600" names a
shade tailwind.config.ts does not declare, so it emits no CSS and the element renders
unstyled.
```

## Evidence

`node docs/ui-audit/col-410/verify-primary-token-rendering.mjs` → `PASS`.

The issue asked for a before/after capture of Reviews Due and the med-tech cockpit.
`.env.local` points at production (`manfqmasfqppukpobpld`), so an authenticated capture of
those two routes would commit real resident data to the repo. The probe asks the same
question of the same Tailwind theme with no resident record involved.

The naive form of this test is circular: once the repair lands the old class names are
gone from `src`, so Tailwind would not emit them whether or not the theme defines the
shade. The probe therefore writes **both** class families into a scanned source file and
compiles the project's own `globals.css` over it — anything Tailwind can express, it
emits. `bg-emerald-600` is the control.

```
ok   bg-emerald-600           1 rule(s)  — control — stock Tailwind scale
ok   bg-primary-600           0 rule(s)  — undefined shade (the defect)
ok   bg-primary-50            0 rule(s)  — undefined shade
ok   border-primary-200       0 rule(s)  — undefined shade
ok   text-primary-800         0 rule(s)  — undefined shade
ok   bg-primary               1 rule(s)  — the repair
ok   text-primary-foreground  1 rule(s)  — the repair
```

Computed colours, light theme — every "before" string is transparent, every "after" is the
steel-blue token `rgb(78, 112, 136)` = `hsl(205 27% 42%)`:

```
[before] care-plan-reviews-due       bg=rgba(0, 0, 0, 0)   fg=rgb(255, 255, 255)
[after ] care-plan-reviews-due       bg=rgb(78, 112, 136)  fg=rgb(255, 255, 255)
[before] med-tech-resident-drawer    bg=rgba(0, 0, 0, 0)   fg=rgb(255, 255, 255)
[after ] med-tech-resident-drawer    bg=rgb(78, 112, 136)  fg=rgb(255, 255, 255)
```

Full table in `computed-styles.json`; rendered sheets in `before-after-light.png` and
`before-after-dark.png`.

## Gates

`npm run lint`, `npm run typecheck`, `npm run test` (784 files, 6082 tests), `npm run build`
— all pass.

## Not covered

- No authenticated screenshot of the two named routes, for the PHI reason above. If a
  staging capture is wanted, it needs a synthetic fixture on `iwcnajanvjvynolltflw`.
- `src/components/med-tech/IncidentModal.tsx` keeps `text-white` on a `bg-primary/20`
  wash: that modal is a fixed-dark surface, so white is correct there and it is not a
  token defect. The modal's severity picker is COL-452's subject, untouched here.
