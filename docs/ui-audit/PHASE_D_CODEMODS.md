# PHASE_D_CODEMODS.md

Companion to `PHASE_D_PLAN.md`. Specifies the AST codemods that will run in Phase D's PR D1 (the codemod sweep).

**Status: PLANNING ONLY.** No codemod is written or run as part of the planning PR that introduces this document. Each codemod below is specified to the level of detail required to write it correctly the first time and to catch the two-bug pattern that bit Phase C's `strip-dead-sys-imports`.

## The two-bug-check pattern

Phase C's `strip-dead-sys-imports.ts` had two latent bugs caught only because the agent ran the codemod on a tree it knew should be a no-op:

1. **Aliased imports.** The codemod checked references to the import's _name_ (`Dialog`) instead of its _local binding_ (`SheetPrimitive` in `import { Dialog as SheetPrimitive }`). 90+ files would have lost legitimately-used imports.
2. **Side-effect-only imports.** `import "./globals.css"` has no `ImportClause`; the codemod's "drop the whole declaration if no specifiers remain" path would have deleted the global CSS import, blanking the app's styles.

Each codemod below specifies its equivalent two-bug check: a known no-op scenario where running the codemod must produce zero mutations. Run that check before applying the codemod to the live tree. If the no-op scenario produces mutations, the codemod has a latent bug; fix and re-test before sweep.

## Codemod 1 — `strip-moonshot-residue`

### Target pattern

The dominant DRIFT pattern (~70 of 97 routes). Each route file contains:

1. An import of `@/components/ui/moonshot/{v2-card,ambient-matrix,kinetic-grid,sparkline,pulse-dot}` — referencing the audit-defanged stubs. The stubs are already `return null;` so the JSX renders nothing, but the imports + JSX usages remain.
2. JSX usage of the imported names: `<AmbientMatrix … />`, `<KineticGrid … />`, `<V2Card>…</V2Card>`, `<Sparkline … />`, `<PulseDot … />`.
3. Often a leading or inline `{/* MOONSHOT: … */}` block comment describing what the moonshot pattern used to be.

### Codemod logic

For every file in `src/app/**/page.tsx` and `src/components/**/*.tsx`:

1. **Find moonshot imports.** Iterate `ImportDeclaration` nodes; match `getModuleSpecifierValue()` against the regex `^@/components/ui/moonshot/`.
2. **Collect imported bindings.** For each matched import, gather the local-binding names (use `getAliasNode() ?? getNameNode()` per the aliased-imports lesson from Phase C). Track which file-level bindings are now "moonshot-tainted".
3. **Strip JSX usage of tainted bindings.** Walk every `JsxElement` and `JsxSelfClosingElement`; if the tagName resolves to a tainted binding, replace the element with empty text. **Special case for `V2Card`:** it wraps children (`<V2Card>…</V2Card>`), and the children must survive — replace the opening + closing tags with empty text, but leave the inner JsxChildren alone. (Implementation: `jsx.getOpeningElement().replaceWithText("")` + `jsx.getClosingElement().replaceWithText("")` leaves the children in place inside the now-orphaned children list.) Actually, since orphan children break JSX validity, better: replace the entire `JsxElement` with a `JsxFragment` containing the children, then collapse the fragment if it has only one child.
4. **Remove the imports.** Delete the `ImportDeclaration` after stripping JSX usage.
5. **Strip MOONSHOT comments.** Walk every JSX comment node (`{/* MOONSHOT … */}`) and standalone block-level comments matching `/\bMOONSHOT\b/i` and remove them.

### Two-bug check (must produce a no-op)

Pick a file that's already AUDITED (zero moonshot residue) — e.g., `src/app/(admin)/billing/page.tsx`. Running the codemod against this file must mutate nothing. If it does:

- The "tainted binding" walk is over-matching (likely a non-moonshot `<AmbientMatrix>` somehow getting tagged).
- Investigate before sweeping.

A second check: pick a file where a moonshot import is _aliased_ (`import { V2Card as Card } from "@/components/ui/moonshot/v2-card"`, if any exist). The local-binding logic must use `Card`, not `V2Card`, for the JSX walk. If sweep produces no mutations there but the source clearly has `<Card>` usages, the codemod is checking the wrong binding name.

### Idempotency

After the codemod runs, re-running it must produce zero mutations. (No tainted bindings remain → no JSX to strip → no imports to remove → no comments to find.)

### Estimated route impact

70 of 97 DRIFT routes have their hit list reduced or zeroed. Of those, ~65 are L-complexity (codemod-only — they go AUDITED in one pass) and ~5 are M-complexity (codemod plus residue work in a per-group batch).

## Codemod 2 — `strip-gradient-backgrounds`

### Target pattern

`bg-gradient-to-{br,r,t,b,bl,tr,tl,l}` className utilities on chrome elements (route pages and shells). ~20 DRIFT routes carry this. The standard chrome is flat semantic tokens (`bg-background`, `bg-card`); gradients are forbidden on chrome per `DESIGN_PRINCIPLES.md` §12.

### Codemod logic

For every file in `src/app/**/page.tsx` and `src/components/**/*.tsx`:

1. **Find className attributes.** Walk every `JsxAttribute` with `name === "className"`. Handle three string-source patterns:
   - Static string literal: `className="bg-gradient-to-br from-X to-Y …"`
   - Template literal with static head: `` className={`bg-gradient-to-br from-X to-Y … ${maybe}`} ``
   - `cn(...)` call argument: `className={cn("bg-gradient-to-br …", maybe)}`
2. **Strip the gradient tokens.** Remove the matching `bg-gradient-to-{br,r,…}`, `from-{color}`, `via-{color}`, `to-{color}` tokens from the className string. Preserve all other tokens. Special care: the `from-X` / `to-Y` tokens are NOT always part of a gradient (they can appear in `border-from-X` etc.) — match only when preceded by whitespace and followed by whitespace OR end-of-string, and only when a `bg-gradient-to-*` token also exists in the same className string. Without that constraint the codemod will strip legitimate `from-*` / `to-*` from other utilities.

### Two-bug check (must produce a no-op)

Pick a file with no `bg-gradient-to-` tokens. The codemod must not modify any `from-*` / `to-*` tokens (e.g., `from-blue-500/10` inside a `border-gradient` or some other non-gradient utility). If it does, the "co-occurs with `bg-gradient-to-*`" constraint is too loose.

### Risks

- **Decorative gradient blobs.** Some files use a fixed-position `<div className="bg-gradient-to-br …">` as a decorative ambient backdrop (the old caregiver "ambient gradient blobs" pattern). Stripping the gradient leaves an invisible element. For each route the codemod modifies, the residue review must check the screenshot for "missing ambient feel" — but per design principles, the answer is to delete the decorative element entirely, not restore the gradient.
- **Codepaths with conditional gradients.** Some files use `${active ? "bg-gradient-to-r from-X to-Y" : "bg-card"}` patterns. The codemod must handle these — strip just the gradient tokens from inside the ternary's gradient branch.

### Estimated route impact

20 routes have `bg-gradient-to-` hits. Most are M-complexity (codemod plus a screenshot regression check during residue work).

## Codemod 3 — `rewrite-tracking-widest`

### Target pattern

`tracking-widest` (Tailwind's `letter-spacing: 0.1em`) paired with tiny font sizes. Per `DESIGN_PRINCIPLES.md` §11: replace with `tracking-wider` (`letter-spacing: 0.05em`) and bump font size from `text-[10px]` to `text-[11px]` where applicable for legibility.

### Codemod logic

For every className string:

1. **If `tracking-widest` is present:** replace with `tracking-wider`.
2. **If `text-[10px]` is also present in the same className string and the className contains `uppercase`:** bump `text-[10px]` → `text-[11px]`.
3. Preserve all other tokens.

### Two-bug check (must produce a no-op)

Pick a file with no `tracking-widest`. The codemod must not bump any `text-[10px]` to `text-[11px]` (the `tracking-widest` co-occurrence guard prevents this).

### Risks

- **Tabular-data labels.** Some `text-[10px] uppercase tracking-widest` patterns label tabular columns where 10px-tight is legible. The bump to 11px-wider may visually shift table layout. Per design principles, this is intentional — the standard is 11px-wider regardless of context — but residue review must check that no table column header now wraps where it didn't.

### Estimated route impact

8 routes. All become AUDITED after this codemod plus moonshot strip.

## Codemod 4 — `strip-font-display`

### Target pattern

`font-display` utility on heading elements. The alias resolves to Inter today (same as `font-sans`) and the weight typically paired with it (`font-light`) is wrong per `DESIGN_PRINCIPLES.md` §11. Replace with `font-semibold` if no weight token is already present.

### Codemod logic

For every className string:

1. **Remove `font-display`.**
2. **If no `font-{weight}` token remains in the same className:** add `font-semibold`.
3. **If `font-light` is present:** also remove it (paired with `font-display` per the original moonshot pattern).

### Two-bug check (must produce a no-op)

Pick a file with no `font-display`. The codemod must not modify any `font-light` (the `font-display` co-occurrence guard prevents this).

### Risks

- **Hero typography that intentionally uses `font-light`.** None known in the audited surfaces; per design principles, `font-light` is wrong everywhere. Residue review confirms.

### Estimated route impact

3 routes. All become AUDITED after this codemod (caregiver landing + caregiver rounds also need other codemods; the landing-home route is out of Phase D scope).

## Codemod 5 — `downsize-page-radii`

### Target pattern

`rounded-3xl`, `rounded-[2rem]`, `rounded-[2.5rem]`, `rounded-[1.8rem]`, `rounded-[3rem]` on page-level chrome. Per `DESIGN_PRINCIPLES.md` §12: hero/card radii max out at `rounded-xl` on cards, `rounded-2xl` only when justified.

### Codemod logic

For every file in `src/app/**/page.tsx` and `src/components/**/*.tsx` _except_ `src/components/ui/**` (UI primitives may intentionally use larger radii):

1. **Replace `rounded-3xl` → `rounded-xl`.** Conservative downsize.
2. **Replace `rounded-[2rem]` / `rounded-[2.5rem]` / `rounded-[3rem]` / `rounded-[1.8rem]` / `rounded-[1.75rem]` → `rounded-xl`.**

### Two-bug check (must produce a no-op)

Pick a file under `src/components/ui/` that legitimately uses `rounded-3xl` (e.g., a primitive's intentional design choice). The codemod must skip it. If sweep modifies anything under `src/components/ui/`, the path filter is wrong.

### Risks

- **Visual regression on hero surfaces.** The `rounded-[2.5rem]` floating dock in Family was the most extreme case; Phase C step 5 already retired that pattern. The remaining ~6 routes have hero tiles at `rounded-3xl` that visually shrink to `rounded-xl`. Each residue review verifies the screenshot.

### Estimated route impact

6 routes (mostly caregiver + family route pages).

## Codemod 6 — `strip-glass-utilities`

### Target pattern

`glass-card`, `glass-card-light`, `glass-panel` className utilities on route pages. Per `DESIGN_PRINCIPLES.md` §12: flat `bg-card border-border` is the standard chrome.

### Codemod logic

For every className string:

1. **Remove `glass-card`, `glass-card-light`, `glass-panel`.**
2. **If any of those tokens was removed and the className doesn't already contain `bg-card` or `bg-background`:** add `bg-card border border-border`.

### Two-bug check (must produce a no-op)

Pick a file that already uses `bg-card border-border` without any `glass-*`. The codemod must not add a duplicate `bg-card`. The "already-has" check prevents this; verify.

A second check: pick a file under `src/components/ui/moonshot/v2-card.tsx`. It contains the string `glass-card` only inside a JSX-text comment ("Audit-defanged: was a `rounded-[2rem] backdrop-blur-3xl glass-card` …"). The codemod operates on className strings only — JSX text and block comments must be ignored. If sweep modifies `v2-card.tsx`, the scope is wrong.

### Risks

- **Glass utilities in legitimate primitives.** None — `glass-*` is forbidden everywhere per design principles. The Phase C step 5 closeout retired the last shell-level usage. Any remaining usage in the codebase is residue.

### Estimated route impact

5 routes (caregiver/tasks, caregiver/meds, family/billing, family/calendar; also caregiver/meds has the dual-token pattern).

## Codemod 7 — `strip-text-5xl` (manual; not a codemod)

### Target pattern

`text-5xl`, `text-6xl`, `text-7xl` on KPI/hero tiles. Only 2 occurrences across 97 routes. The replacement pattern is judgment-heavy (depends on what the tile is showing, surrounding chrome, density).

### Why not a codemod

The two occurrences are `/admin/compliance/scan` (text-5xl) and the `/caregiver` landing (text-5xl in a hero). Each needs a per-tile redesign decision, not a mechanical token swap. Handle in the residue PR for each route.

### Risks

A mechanical swap (text-5xl → text-2xl, say) is technically possible but produces visually wrong results without consideration of surrounding layout. Skip the codemod; flag the routes for residue work.

## Codemod 8 — `strip-gradient-text` (manual; not a codemod)

### Target pattern

`bg-clip-text text-transparent bg-gradient-to-*` combo for gradient text. 1 occurrence: `src/app/(admin)/reports/page.tsx`.

### Why not a codemod

One occurrence isn't worth a codemod. Handle in the D-command residue PR.

## Sweep execution plan

The D1 codemod sweep runs in this order (each one idempotent, so re-running has no effect):

1. `strip-moonshot-residue` — biggest sweep; ~70 routes
2. `strip-gradient-backgrounds` — ~20 routes
3. `rewrite-tracking-widest` — ~8 routes
4. `strip-font-display` — ~3 routes
5. `downsize-page-radii` — ~6 routes
6. `strip-glass-utilities` — ~5 routes

After all six run, the working tree is the proposed D1 PR. Run `npm run lint` (must pass — codemods remove imports cleanly), `npx next build` (must pass), and regenerate `ROUTE_COVERAGE.md`. Expected DRIFT count drop: 97 → ~20–30.

Then commit + push as a single PR with a body that lists each codemod's pre/post DRIFT count and the routes it touched. Reviewer can spot-check the diff against the codemod spec; the bulk of the review is "do any of these routes look wrong" via screenshots, not "is this line correct" via diff.

## Why not just one big codemod?

Composability + diagnosability. If sweep produces broken output, knowing _which_ codemod broke it (via the 6-step ordered run) is much faster than bisecting one monolithic codemod. Each codemod is independently testable (the no-op two-bug check) and independently re-runnable.

## What the codemod sweep does NOT cover

- Hover/active migration. Caregiver + Family residue PRs handle this manually because adding `active:X` paired with every `hover:X` requires per-element judgment (some hover colors don't need a separate active state because they're already on a touch-incompatible surface like a desktop-only table).
- Per-page hero card layout rewrites. Where a route's hero tile uses oversized text + bespoke gradient borders + extra-large icons, the codemods strip the surface tokens but leave the structural layout. Residue PRs polish.
- Reorganizing nested route groups, renaming files, moving components. Out of scope; D1 is a chrome sweep, not a refactor.

## Acceptance for the codemod implementation

When PR D1 ships, the agent that writes each codemod must:

1. Implement the codemod in `scripts/codemods/<name>.ts` following the `strip-dead-sys-imports.ts` template (ts-morph + `Project` + `main().catch()`).
2. Run the codemod's two-bug check against a known no-op file. Report mutations = 0 in the PR description.
3. Apply the codemod to the live tree. Report mutations count per file (file path + lines changed) in the PR description.
4. Run `npm run lint` + `npx next build`. Both must pass.
5. Regenerate `ROUTE_COVERAGE.md`. Report the DRIFT count delta.
6. Commit the codemod + the bulk-mutation diff in a single PR.

If any step fails, the codemod is the bug — fix the codemod, do not patch around it in the diff.
