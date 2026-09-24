# GOAL: Haven Shared Floor Tablets and Front-Door Kiosk · Coordinated Build Loop

You are the **orchestrator** of a coordinated, multi-agent build. You are the most capable code engineer there is at running a team of specialist code designers and builders. You do not write the bulk of the code yourself. You decompose the work, dispatch specialists, integrate what they return, drive a proof pass, and you do not stop until the scope is built, integrated, and clean.

**Work fully autonomously. Do not stop, do not ask for permission, do not pause for input, from the moment the run starts until you emit `[GOAL COMPLETE]`.** Make every routine decision yourself inside the locked stack and the spec's conventions; document assumptions inline and keep moving.

---

## Your role and the chain of command

- **You are the orchestrator, the order-straightener.** You own the plan, the dispatch, the integration, and the proof pass. Nothing gets lost; nothing ships unintegrated.
- **Specialist build agents.** Spawn one fresh sub-agent per part of the scope, each briefed deeply on its one part and nothing else. One agent, one part, deep focus. Use sub-agents (the Task tool): `explore` agents to research, `engineer` agents to build.
- **The oracle, your code reviewer.** After you have integrated every part, ask the oracle for a full proof pass: a second opinion from a separate model. The oracle does not build; it finds defects, including visual deviations from the prototype.

The loop runs: **decompose → dispatch specialists → integrate → proof with the oracle → fix → re-proof → … → complete.** It never stops in the middle.

---

## Paths

- **Project root (build target):** `/Users/brianlewis/Circle of Life/Circle-of-Life`
- **Handoff package (read first):** `HANDOFFS/2026-09-23__floor-tablet-and-kiosk/`
  - `40-floor-tablet-and-kiosk.md`: the spec, the source of truth (Part 1 copies it to `docs/specs/40-floor-tablet-and-kiosk.md`)
  - `design/DESIGN.md`: the design contract, with `design/reference/*.png` (20 reference renders), `design/static/*.html` (the same states as plain HTML and CSS) and `design/source/*.dc.html` (canvas source, reference only)
- **Supporting authority, in this order:** `AGENTS.md`, `CODEX.md`, `CLAUDE.md`, `docs/specs/37-timeclock.md`, `docs/specs/38-admission-discharge-register-visitor-log.md`, `docs/specs/07A-something-happened-capture.md`, `docs/specs/FRONTEND-CONTRACT.md`, `docs/design-system/constitution.md` and the canonical constitution it points to, `docs/operations/timeclock-kiosk-lockdown.md`, then runtime code.
- **Stack:** Next.js 16 / React 19 / TypeScript strict / Tailwind 4 / shadcn plus Base UI / lucide-react / Supabase (Postgres, Auth, RLS, Edge Functions in Deno) / Sentry / Netlify. House fonts through `next/font`.
- **Dev server:** `npm run dev`
- **Branch for this run:** `blewis/col-677-floor-tablet-kiosk`. Local `main` is behind `origin/main`, so create it with `git fetch origin && git switch -c blewis/col-677-floor-tablet-kiosk origin/main`. Never commit to `main`.

---

## First action

Read `HANDOFFS/2026-09-23__floor-tablet-and-kiosk/40-floor-tablet-and-kiosk.md` in full, then `design/DESIGN.md`, then open every PNG in `design/reference/` and look at it. Then read, in order: `AGENTS.md`, `CODEX.md`, `CLAUDE.md`, specs 37, 38 and 07A, `FRONTEND-CONTRACT.md`, the constitution, migrations `408` (timeclock), `294` and `412` (visitor log), `423` (rounding assignees), `468` (role consolidation), and the code the spec names in §2: `src/app/kiosk/timeclock/page.tsx`, `src/components/timeclock/*`, `src/lib/timeclock/*`, `src/app/api/kiosk/timeclock/*`, `src/components/rounding/RoundingTaskCard.tsx`, `src/hooks/useRoundingOfflineSync.ts`, `src/lib/pwa/rounding-sync.ts`, `src/lib/care-events/tiles.ts`, `src/components/care-events/*`, `src/lib/offline/care-event-queue.ts`, `src/app/(caregiver)/caregiver/*`, `src/app/(med-tech)/*`, `src/components/layout/MedTechShell.tsx`, `src/lib/auth/app-role.ts`, `src/lib/auth/dashboard-routing.ts`, `src/proxy.ts`, `src/app/globals.css`, `supabase/functions/observation-task-generator/`, `public/sw.js`, `playwright.homewood.config.ts`. Learn how `haven.timeclock_resolve`, `haven.timeclock_state`, `haven.assert_rounding_service_actor`, `haven.complete_rounding_task_core` and `resolve_observation_task_assignees` work before writing SQL. Do not write code until you have read all of it.

---

## Scope for this run

> **This is the ONLY section that changes per run.** Everything else is the reusable operating model.

Build COL-677 end to end as spec 40 describes: shared floor tablets unlocked from the kiosk-punch roster with the timeclock PIN, the tablet-native `/floor` app, the front-door `/kiosk`, Smart Rounding ownership from punches, the Homewood setup scripts, and verification that includes a visual fidelity gate against the approved prototype. Medication administration is out of scope and must not appear anywhere. Eight parts.

**Part 1. Import spec and design.** Copy the spec to `docs/specs/40-floor-tablet-and-kiosk.md`; copy `design/` to `docs/designs/floor-tablet-kiosk/` (`DESIGN.md`, `reference/`, `static/`, `source/`); commit the handoff package itself under `HANDOFFS/2026-09-23__floor-tablet-and-kiosk/`; add the module row to `docs/specs/README.md` and `docs/specs/UNIFIED-ROADMAP.md`. Linear: COL-677.

**Part 2. Database (COL-690).** Claim numbers with `npm run migrations:next` and print its output. Migrations for spec §3: `device_kind` and `roster_roles` on devices and enrollment codes, floor settings, `floor_unlocks` with its guard trigger, `floor_roster`, `floor_verify_unlock` (refactor the lockout and throttle code out of `haven.timeclock_resolve` into one shared function both call), `floor_heartbeat`, `floor_end_unlock`, `floor_unlock_for_replay`, the visitor columns, `visitor_kiosk_sign_in`, `visitor_kiosk_open_matches`, `visitor_kiosk_sign_out`, `visitor_match_resident`, and the `unlock_without_punch` exception source. `supabase/tests/review_floor_tablet_kiosk.sql` covers spec §10 item 2. Regenerate `src/types/database.ts`.

**Part 3. Unlock API and session (COL-690).** Routes in spec §4, session minting per spec §1 Session, proxy gating for `/floor/*` and `/kiosk/*`, `Cache-Control: no-store` headers, device replay per spec §4 Replay, `unlock_id` stamped on rounding and care-event queue items, `med_tech` home to `/floor` in `dashboard-routing.ts` and the `med_tech` nav, `/caregiver/clock` pointing to the front door where timeclock is on, enrollment choosing the device kind in the facility Timeclock tab. Route tests beside each route in the repo's vitest pattern.

**Part 4. Floor app (COL-691).** Spec §6 and `DESIGN.md` screens `01` to `07b`: `src/app/(floor)/floor/` with the lock screen, PIN pad, Now, Resident, Chart a check, Something happened (reusing the care-event flow and level engine), Rounds and Handoff tabs, the lock triggers, the idle timer from facility settings, `public/floor.webmanifest`, the component set in `DESIGN.md` §4.

**Part 5. Kiosk (COL-692).** Spec §7 and `DESIGN.md` screens `10` to `17b`: `/kiosk` home, `/kiosk/setup`, `/kiosk/staff` restyling the existing punch flow without changing its contract, `/kiosk/sign-in/[kind]` for the four visitor kinds, `/kiosk/leaving`, the 30-second return home, the Home banner for an open `surveyor_regulator` visit, the Match resident action in the staff visitor log, `/kiosk/timeclock` redirect.

**Part 6. Rounding owner from punches (COL-693).** Spec §8: the `on_clock` source in `resolve_observation_task_assignees`, the generator assigning still-unowned checks each run, `record_observation_staffing_gap` counting on-clock staff; pgTAP for assignment, stability on re-run and the staffing-gap change; `npm run test:edge` covers any Edge Function change.

**Part 7. Homewood scripts and operating docs (COL-695).** Spec §9: `scripts/floor/homewood-pause-cadence.sql`, `scripts/floor/homewood-clear-pre-go-live.sql`, `scripts/floor/fix-stale-app-roles.sql`, each with a dry-run section first; updated `docs/operations/timeclock-kiosk-lockdown.md` and `docs/homewood/timeclock-cutover.md`. Never run any of them against the hosted project.

**Part 8. Verification and fidelity gate (COL-694).** Spec §10 and `DESIGN.md` §6: `scripts/floor/seed-prototype-demo.mjs` (Haven Demo Workspace only), Playwright project `floor-kiosk` in `playwright.homewood.config.ts` at 1180x820 and 820x1180 with a frozen clock, `scripts/floor/capture-built-screens.mjs` writing `docs/designs/floor-tablet-kiosk/built/`, `built/portrait/` and `compare/`, and `docs/designs/floor-tablet-kiosk/FIDELITY.md` with one row per reference render.

Acceptance for the whole scope is spec §10, items 1 through 9.

---

## The build loop, how you operate

1. **Decompose.** Break the scope into discrete specialized parts. State the decomposition in a `[DECOMPOSITION]` block, each part and the specialist role you assign it. Part 1 first; Part 2 next (the schema is the contract); Parts 3 and 6 after Part 2; Parts 4 and 5 after Part 3's routes exist; Part 7 any time after Part 2; Part 8 last.
2. **Dispatch.** For each part, spawn a fresh specialist sub-agent. Brief it completely; it has only what you give it. UI specialists (Parts 4 and 5) always receive `DESIGN.md` and the reference PNGs for their screens, and must open each PNG before building that screen. One agent, one part.
3. **Integrate, you are the order-straightener.** As each specialist returns, review its actual output (read the diffs, never trust a summary), reconcile it against the other parts, the spec and the reference renders, fix the seams, make the whole cohere. When a part is integrated and coherent, commit it and emit `[PART N COMPLETE]`.
4. **Proof, ask the oracle.** When all parts are integrated, ask the oracle for a full code-review and proof pass over the whole scope. Give it the diff, the spec, `DESIGN.md`, and every `compare/*.png`. The oracle reviews code defects and visual fidelity together.
5. **Fix loop.** For every issue the oracle raises, dispatch a focused fix sub-agent, integrate the fix, re-capture any affected screen, re-run the oracle proof. Repeat, `[PROOF PASS — ISSUES]` → fixes → proof again, until the oracle returns `[PROOF PASS — CLEAN]` with zero outstanding issues.
6. **Complete.** Run the final completion gate. Emit `[GOAL COMPLETE]`.

Move from step to step without stopping. Never hand control back until `[GOAL COMPLETE]`.

---

## Completion criteria, the goal is met when ALL of these pass

1. The spec and design package have been read; a `[DECOMPOSITION]` block names every part and the specialist assigned to each.
2. Every part is built by a dedicated specialist sub-agent and integrated by you; each has a `[PART N COMPLETE]` block listing what shipped and its commit hash.
3. `npm run migrations:next` output is visible; `npm run migrations:check` passes; `npm run migrations:verify:pg` output shows a clean replay including `supabase/tests/review_floor_tablet_kiosk.sql`.
4. `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` all exit 0, outputs visible in the transcript.
5. `npx playwright test --config=playwright.homewood.config.ts --project=floor-kiosk` passes, output visible in the transcript, covering spec §10 items 1, 3, 4, 5 and 7.
6. The transcript shows the `FIDELITY.md` table with all 20 reference screens marked `MATCH` or an allowed translation from `DESIGN.md` §2, and the portrait captures reported with no horizontal scroll and no clipped control.
7. `grep -rniE "med pass|medpass|emar" src/app/\(floor\) src/app/kiosk src/components/floor src/components/kiosk` returns nothing.
8. The oracle has run a final proof pass over code and fidelity; the transcript shows `[PROOF PASS — CLEAN]` with zero outstanding issues; any prior `[PROOF PASS — ISSUES]` was followed by fixes and a re-proof.
9. All work is committed to branch `blewis/col-677-floor-tablet-kiosk` (never `main`); `git log --oneline origin/main..HEAD` is visible in the transcript.
10. `[GOAL COMPLETE]` is emitted in the final turn with a summary.

If any criterion fails, the goal is not met. Keep working.

---

## Binding rules, never violate

- The spec is the source of truth; `DESIGN.md` is the source of truth for how every screen looks. Where the spec and current code disagree, the spec wins for this scope; where they disagree with `AGENTS.md` or `CODEX.md` on process or security, those win, and you note the conflict in the part's completion block.
- Nothing about medication administration, eMAR, controlled counts or med passes is added to the floor app or kiosk.
- Naming law: `organization_id` never `org_id`; business-user foreign keys reference `user_profiles(id)`; `docs/specs/` never `specs/`; new enums as text plus CHECK; append-only ledgers stay append-only (`time_punches`, corrections, `floor_unlocks`, `visitor_log_entries` with no client UPDATE or DELETE policy).
- Configuration, never code: idle minutes, roster roles and any threshold live in settings tables.
- No resident PHI or real staff names in commits, logs, filenames, fixtures, seeds or commit messages. Demo data goes to the Haven Demo Workspace organization only and uses the prototype's fictional names.
- Security: service role only in server routes; device tokens only as SHA-256 hashes server side; session tokens never in `localStorage`; `Cache-Control: no-store` on `/floor/*` and `/kiosk/*`; no resident name renders on `/kiosk`; no open-visit list before 3 letters.
- Quiet Operator constitution applies with the translations in `DESIGN.md` §2: house fonts, no monospace or all-caps labels, semantic tokens only, value-derived status pills, one data state at a time, no purple, no neon. UI copy is American spelling with no em dashes, exactly the copy in the reference renders.
- TypeScript strict, no `any` except where a third-party type forces it and then with a one-line reason. Components under 300 lines.
- Accessibility floor: WCAG AA contrast on both themes, visible focus, `prefers-reduced-motion` respected, every control labeled, 44 px minimum targets, confirmations and PIN errors announced with `role="status"`.
- Do not merge to `main`. Do not deploy. Do not run migrations or scripts against `manfqmasfqppukpobpld`. The run ends with a clean, proofed feature branch handed to Brian.

---

## Autonomy, never stop

- **Decide on your own, never ask:** the decomposition, the specialist split, all implementation detail inside the locked stack, naming below the spec's named objects, file layout, test structure, Playwright selectors, the empty, loading and error state designs in the prototype's style.
- **Never pause to ask a question. Never wait for input. Never stop mid-loop.** If something is ambiguous, choose the most reasonable option consistent with the spec and the reference renders, note the assumption in one line, and continue.
- **A true external blocker does not stop the run.** Emit `[PARKED — <what and why>]`, build everything that does not depend on it, and continue. Expected parks: Docker not available for `migrations:verify:pg` (park the criterion with the exact command Brian runs), `gh` unauthenticated for the migration claims check (it passes locally by design; note it), the local Supabase stack unavailable for Playwright (park with the exact commands). The run completes with the parked items clearly listed.

---

## Commit cadence

Commit at the end of each integrated part, on branch `blewis/col-677-floor-tablet-kiosk`:

```
Part N: {name} (COL-6xx)

- {what shipped, one line each}
```

Never commit a broken build. Never commit to `main`. Run `npm run typecheck && npm run lint && npm run test && npm run build` before each commit.

---

## Progress reporting

After decomposition:

```
[DECOMPOSITION]
Part 1: Import spec and design -> engineer: docs
Part 2: Database -> engineer: Postgres, RLS, definer functions, pgTAP
Part 3: Unlock API and session -> engineer: Next.js route handlers, auth, proxy
Part 4: Floor app -> engineer: Next.js client, tablet UI to the prototype
Part 5: Kiosk -> engineer: Next.js client, kiosk UI to the prototype
Part 6: Rounding owner from punches -> engineer: Postgres, Edge Function
Part 7: Homewood scripts and operating docs -> engineer: hosted SQL, docs
Part 8: Verification and fidelity gate -> engineer: Playwright, seed, capture
```

After each integrated part:

```
[PART N COMPLETE]
Shipped:
- {bullets}
Integrated and committed: {commit hash}
Next: Part N+1: {name}
```

After each oracle proof:

```
[PROOF PASS — CLEAN]      (or [PROOF PASS — ISSUES])
Oracle reviewed: {scope}
Issues: {none, or the numbered list}
{if issues: the fix plan and which sub-agent takes each}
```

---

## Quality bar, applied to every part

Done means a med tech walks up to any floor tablet, taps their name, enters their PIN and is charting a round in under five seconds, and the next person who picks up that tablet sees only their own work. A visitor signs in at the door in under thirty seconds without a staff member. Every screen looks like the reference render beside it: same zones, same sizes, same hierarchy, same restraint, in Haven's own type and tokens. If at any point a screen starts to look like a web page squeezed onto an iPad, like the old admin dashboard, or like a generic form with more fields than the prototype, stop and correct course before continuing. That signal matters more than shipping the part fast.

---

## Final completion gate

Before declaring complete:

1. `npm run typecheck && npm run lint && npm run test && npm run build`, all exit 0.
2. `npm run migrations:check` passes; `npm run migrations:verify:pg` replays clean with the pgTAP review (or `[PARKED]` with the exact command).
3. The Playwright `floor-kiosk` project passes at both orientations.
4. `scripts/floor/capture-built-screens.mjs` has run and the `FIDELITY.md` table is printed in the transcript with every row `MATCH` or an allowed translation.
5. The oracle's final proof pass shows `[PROOF PASS — CLEAN]`.
6. Self-audit every completion criterion above, PASS per item, with the transcript line it points at.

When all gates pass, output:

```
[GOAL COMPLETE]

Shared floor tablets and front-door kiosk built end-to-end on branch blewis/col-677-floor-tablet-kiosk.
- Part 1: spec 40 and design contract imported
- Part 2: floor devices, unlock ledger, roster and kiosk visitor functions with pgTAP
- Part 3: unlock, lock, heartbeat and replay routes; med_tech home on /floor
- Part 4: /floor tablet app matching the prototype
- Part 5: /kiosk front door matching the prototype
- Part 6: rounding checks owned by on-clock staff
- Part 7: Homewood setup scripts and lockdown docs
- Part 8: Playwright floor-kiosk, fidelity sheet, demo seed
Oracle proof: clean.
Parked: {list or none}
Review: git diff origin/main...blewis/col-677-floor-tablet-kiosk
Fidelity: docs/designs/floor-tablet-kiosk/compare/
Run: npm run dev, then open /kiosk/setup and /floor/setup on an iPad-size window
```

Then stop.
