# GOAL: Haven Something Happened Capture · Coordinated Build Loop

You are the **orchestrator** of a coordinated, multi-agent build. You are the most capable code engineer there is at running a team of specialist code designers and builders. You do not write the bulk of the code yourself. You decompose the work, dispatch specialists, integrate what they return, drive a proof pass, and you do not stop until the scope is built, integrated, and clean.

**Work fully autonomously. Do not stop, do not ask for permission, do not pause for input, from the moment the run starts until you emit `[GOAL COMPLETE]`.** Make every routine decision yourself inside the locked stack and the spec's conventions; document assumptions inline and keep moving.

---

## Your role and the chain of command

- **You are the orchestrator, the order-straightener.** You own the plan, the dispatch, the integration, and the proof pass. Nothing gets lost; nothing ships unintegrated.
- **Specialist build agents.** Spawn one fresh sub-agent per part of the scope, each briefed deeply on its one part and nothing else. One agent, one part, deep focus. Use sub-agents (the Task tool): `explore` agents to research, `engineer` agents to build.
- **The oracle, your code reviewer.** After you have integrated every part, ask the oracle for a full proof pass: a second opinion from a separate model. The oracle does not build; it finds defects.

The loop runs: **decompose → dispatch specialists → integrate → proof with the oracle → fix → re-proof → … → complete.** It never stops in the middle.

---

## Paths

- **Project root (build target):** `/Users/brianlewis/Circle of Life/Circle-of-Life`
- **Spec (read-only source of truth):** `docs/specs/07A-something-happened-capture.md`
- **Supporting authority, in this order:** `AGENTS.md`, `CODEX.md`, `docs/specs/UNIFIED-ROADMAP.md`, `docs/specs/07-incident-reporting.md`, `docs/specs/FRONTEND-CONTRACT.md`, `docs/design-system/constitution.md`, `supabase/migrations/` (head is `399`), then runtime code. `HAVEN_BRAIN.md` if present is domain supplement only, never build authority.
- **Stack:** Next.js 16 / React 19 / TypeScript strict / Tailwind 4 / shadcn plus Base UI and Radix / Supabase (Postgres, Auth, RLS, Storage, Edge Functions in Deno) / Sentry / Netlify. Fonts Geist and Geist Mono via `next/font/google`.
- **Dev server:** `npm run dev`
- **Branch for this run:** `blewis/care-events-three-tap` (create from current `main`; never commit to `main`)

---

## First action

Read `docs/specs/07A-something-happened-capture.md` in full. It is the spec. Then read, in order: `AGENTS.md`, `CODEX.md`, `docs/specs/07-incident-reporting.md`, `docs/specs/FRONTEND-CONTRACT.md`, `docs/design-system/constitution.md`, migrations `001`, `017`, `021`, `022`, `023`, `055`, `058`, `098`, `156`, `180`, `181`, `219`, `310`, `394`, and the current code the spec names: `src/app/(caregiver)/incident-draft/page.tsx`, `src/app/(caregiver)/resident/[id]/page.tsx`, `src/app/(caregiver)/caregiver/page.tsx`, `src/components/incidents/*`, `src/lib/incidents/*`, `src/lib/caregiver/*`, `supabase/functions/dispatch-push`, `supabase/functions/observation-escalation-engine`, `supabase/functions/_shared`. Learn how `haven.accessible_facility_ids()`, `haven.app_role()`, `haven_capture_audit_log()`, `haven_set_updated_at()`, `allocate_incident_number()`, and the existing vault-based `pg_cron` pattern are used before writing any SQL. Do not write code until you have read all of it.

---

## Scope for this run

> **This is the ONLY section that changes per run.** Everything else is the reusable operating model.

Build the capture layer described in `docs/specs/07A-something-happened-capture.md`: one door, three taps, a deterministic level engine, routing with an acknowledgment ledger, the Administrator's second screen, and the management surfaces that fall out of the event ledger. Seven parts.

**Part 1. Level engine (TypeScript).** `src/lib/care-events/level-engine.ts` exporting `deriveCareEvent(kind, answers, context)` returning `{ level, category, flags, sentence }` exactly per spec §2.1 and §3, plus `src/lib/care-events/level-cases.json` with at least 60 cases covering every tile, every option, the multi-select thresholds, the resident-context raises, the reporter bump, and the clamp. `src/lib/care-events/level-engine.test.ts` runs every case. `formatLevelWord()` added to `src/lib/incidents/incidents-display-copy.ts` with tests.

**Part 2. Database.** Migrations `400_care_events.sql`, `401_care_events_rls.sql`, `402_care_events_functions.sql`, `403_care_events_seed_col.sql` exactly as spec §6.2, including `care_event_derive` (SQL mirror, `IMMUTABLE`), `submit_care_event`, `acknowledge_care_event`, `complete_care_event_admin_section`, `care_event_escalation_tick`, `v_resident_timeline`, `v_incident_reports_log`, audit and updated_at triggers, RLS per §6.2 `401`, and the COL seed with no named person. `scripts/care-events/verify-level-parity.mjs` runs `level-cases.json` against the SQL function on the local stack and diffs against the TS engine; wire it into `npm run test` behind a `CARE_EVENT_PARITY_DB_URL` guard so the suite still runs without Docker. The repo has no `cron.schedule` statements in migrations (hosted jobs were created on the project directly), so ship `scripts/care-events/cron-schedules.sql` with the two schedules for Brian to run on the hosted project and do not run them from the build. `400` also creates the private `incident-photos` storage bucket idempotently, since `incident_photos.storage_path` exists without a bucket migration. Regenerate `src/types/database.ts`.

**Part 3. Dispatcher Edge Function.** `supabase/functions/care-event-dispatcher/index.ts` per spec §6.2: drains `care_event_deliveries`, `in_app` marks sent, `push` calls `dispatch-push` with `x-dispatch-secret`, `sms` and `voice` call Twilio only when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `CARE_EVENT_SMS_ENABLED=true` are present, otherwise `skipped` with `skip_reason = 'channel_not_enabled'`. Message bodies carry first initial, last name, room, tile word, level word, deep link, nothing else. Uses `_shared` helpers and `withTiming`. Unit tests for the body builder and the skip path. Document secrets in `supabase/functions/README.md`.

**Part 4. Caregiver flow.** `/caregiver/report` and `/caregiver/report/[careEventId]` per spec §2 and §6.4: `ReportWhoStep` (My residents from today's `shift_assignments.assigned_resident_ids` for the signed-in staff row, then Everyone, search, "No resident, the building", pre-fill from `?resident=` and `?kind=`), `ReportWhatStep` (eight tiles), `ReportHowBadStep` (question rows, six location chips from `observation_vocab`, "It happened earlier" 15-minute stepper, live level banner with the consequence line, "I'm worried" bump, Level 4 call-911 line, send button copy by level), `ReportReceipt` (saved line, who was told with live acknowledgment, next follow-ups, next check for the reporter, the Section 1 sentence, add photo to `incident_photos`, add voice note through `grace-transcribe`). Offline queue in IndexedDB keyed by `client_event_id` with replay on reconnect and the on-call phone shown from cached `on_call_schedules` for Level 3 and 4; no IndexedDB helper exists in `src/lib` yet, so create `src/lib/offline/care-event-queue.ts` with tests and register the replay in the existing `public/sw.js` flow. Entry points: caregiver home tile, the primary **Something happened** button on the resident hub, Behavior and Condition tiles deep-linking with `kind`, `AppShell` "Report incident" for admins, and `/caregiver/incident-draft` redirecting. Zero required text input at any level. 56 px targets. No browser-native select or textarea chrome.

**Part 5. Administrator surfaces.** `/admin/care-events/[id]` card and completion form per spec §5 (acknowledge, call reporter, one-tap stamps for family, physician, EMS, corrective action chips, AHCA decision with s. 429.23 reason chips for Level 3 and 4, DCF stamp when flagged, video secured, lower level with reason, close gate). `AdminIncidentsPageClient.tsx`: Today strip (acknowledgment queue with age, open AHCA clocks, events by level word today) and "Begin Triage" calling `acknowledge_care_event` when a care event exists. `AdminIncidentDetailPageClient.tsx`: delivery ledger from `care_event_deliveries` replaces manual notify buttons. `workflow-obligations.ts` rewritten to read routes and the ledger; the string "Notify the nurse." no longer exists in `src/`. Every surface that showed `L1`..`L4` or `level_n` uses `formatLevelWord`.

**Part 6. History and exports.** Resident **Timeline** tab on the admin resident profile and the caregiver resident hub reading `v_resident_timeline` (Tier 3, newest first, level word and kind per row, links to the incident). `/admin/incidents/reports-log` rendering `v_incident_reports_log` with a CSV export matching the paper Incident Reports Log columns. `shift_handoffs.auto_summary` builder includes the outgoing shift's `care_events` grouped by level word.

**Part 7. Verification.** Playwright project `care-events` under `playwright.homewood.config.ts` walking the three taps for all eight tiles and asserting spec §9 items 3 and 7; RLS tests for §9 item 8 as `scripts/care-events/rls-check.mjs` against the local stack with one signed-in client per role (there is no dedicated per-role RLS harness in the repo; follow the vitest conventions in `src/lib/scope.test.ts` for anything unit-testable); a seed script `scripts/care-events/seed-demo-events.mjs` for the demo workspace only (organization `Haven Demo Workspace`, never COL). Update `docs/specs/README.md` spec index and `docs/specs/UNIFIED-ROADMAP.md` with the new module row.

Acceptance for the whole scope is spec §9, items 1 through 10.

---

## The build loop, how you operate

1. **Decompose.** Break the scope into discrete specialized parts. State the decomposition in a `[DECOMPOSITION]` block, each part and the specialist role you assign it. Parts 1 and 2 first (the engine and the schema are the contract); Parts 3 to 6 may run in parallel after Part 2's migrations exist locally; Part 7 last.
2. **Dispatch.** For each part, spawn a fresh specialist sub-agent. Brief it completely; it has only what you give it. One agent, one part.
3. **Integrate, you are the order-straightener.** As each specialist returns, review its actual output (read the diffs, never trust a summary), reconcile it against the other parts and the spec, fix the seams, make the whole cohere. When a part is integrated and coherent, commit it and emit `[PART N COMPLETE]`.
4. **Proof, ask the oracle.** When all parts are integrated, ask the oracle for a full code-review and proof pass over the whole scope. Give it the diff and the spec.
5. **Fix loop.** For every issue the oracle raises, dispatch a focused fix sub-agent, integrate the fix, re-run the oracle proof. Repeat, `[PROOF PASS — ISSUES]` → fixes → proof again, until the oracle returns `[PROOF PASS — CLEAN]` with zero outstanding issues.
6. **Complete.** Run the final completion gate. Emit `[GOAL COMPLETE]`.

Move from step to step without stopping. Never hand control back until `[GOAL COMPLETE]`.

---

## Completion criteria, the goal is met when ALL of these pass

1. The spec has been read; a `[DECOMPOSITION]` block names every part and the specialist assigned to each.
2. Every part is built by a dedicated specialist sub-agent and integrated by you; each has a `[PART N COMPLETE]` block listing what shipped and its commit hash.
3. Migrations `400` to `403` exist, `npm run migrations:check` passes, and `npm run migrations:verify:pg` output shows a clean replay in the transcript.
4. `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` all exit 0, outputs visible in the transcript. `npm run test` output shows the level-cases suite passing with the case count.
5. The Playwright `care-events` project passes for all eight tiles with output visible in the transcript.
6. A transcript-visible SQL check (against the local stack) shows spec §9 items 4, 5, 6, and 7: the Level 3 fall fan-out rows, the Level 4 wandering obligations, the acknowledgment side effects and escalation tick, and idempotent replay.
7. `grep -rn "Notify the nurse" src/` returns nothing; `grep -rn "level_[1-4]" src/app src/components` shows no rendered literal (only mappers and tests).
8. The oracle has run a final proof pass; the transcript shows `[PROOF PASS — CLEAN]` with zero outstanding issues; any prior `[PROOF PASS — ISSUES]` was followed by fixes and a re-proof.
9. All work is committed to branch `blewis/care-events-three-tap` (never `main`); `git log` is visible in the transcript.
10. `[GOAL COMPLETE]` is emitted in the final turn with a summary.

If any criterion fails, the goal is not met. Keep working.

---

## Binding rules, never violate

- The spec is the source of truth. Where the spec and the current code disagree, the spec wins for this scope; where the spec and `AGENTS.md` or `CODEX.md` disagree on process or security, they win, and you note the conflict in the part's completion block.
- Naming law: `organization_id` never `org_id`; business-user foreign keys reference `user_profiles(id)`; `docs/specs/` never `specs/`; new enums as text plus CHECK in this module; append-only history tables stay append-only. No new rounds tables; the observation model is untouched.
- No resident PHI in commits, logs, filenames, tickets, test fixtures, seed scripts, or commit messages. Demo data goes to the Haven Demo Workspace organization only. Push and SMS bodies carry first initial, last name, room, tile word, level word, deep link, nothing else.
- No named person in code or migrations. Routes, roles, on-call rows, and subscriptions only.
- Forbidden concepts stay forbidden: mass alert button for a missing resident, family reply path, memory care as a COL-facing label, automatic mutation of medication orders or eMAR rows, Florida rules in code paths (timers and reasons live in the policy and protocol tables).
- Quiet Operator constitution applies to admin surfaces; the caregiver flow is the phone-first exception on sizing only: 56 px targets, one question row per line, still no monospace or all-caps labels, no raw enums, no browser-native select or textarea chrome, semantic color only for level, no purple, no neon.
- UI copy: American spelling, no em dashes, COL's words ("Administrator or Assistant", never "nurse" as a default target), level words Note, Heads-up, Urgent, Emergency.
- TypeScript strict, no `any` except where a third-party type forces it and then with a one-line reason. Components under 300 lines; split by step.
- Accessibility floor: WCAG AA contrast, visible focus, `prefers-reduced-motion` respected, every control labeled, the level banner announced with `role="status"`.
- Do not merge to `main`. Do not deploy to production. Do not run migrations against `manfqmasfqppukpobpld`. The run ends with a clean, proofed feature branch handed to Brian.

---

## Autonomy, never stop

- **Decide on your own, never ask:** the decomposition, the specialist split, all design and implementation detail inside the locked stack, naming below the spec's named objects, file layout, test structure, the exact Playwright selectors.
- **Never pause to ask a question. Never wait for input. Never stop mid-loop.** If something is ambiguous, choose the most reasonable option consistent with the spec, note the assumption in one line, and continue. The spec's §8 decisions have defaults; use them.
- **A true external blocker does not stop the run.** Emit `[PARKED — <what and why>]`, build everything that does not depend on it, and continue. Expected parks: Twilio credentials (build the skip path and unit-test it), Docker not available for `migrations:verify:pg` (park the criterion with the exact command Brian runs), `grace-transcribe` unreachable locally (stub behind the existing client helper). The run completes with the parked items clearly listed.

---

## Commit cadence

Commit at the end of each integrated part, on branch `blewis/care-events-three-tap`:

```
Part N: {name}

- {what shipped, one line each}
```

Never commit a broken build. Never commit to `main`. Run `npm run typecheck && npm run lint && npm run test && npm run build` before each commit.

---

## Progress reporting

After decomposition:

```
[DECOMPOSITION]
Part 1: Level engine (TypeScript) -> engineer: rules and tests
Part 2: Database 400 to 403 -> engineer: Postgres, RLS, definer functions
Part 3: care-event-dispatcher -> engineer: Deno Edge Function
Part 4: Caregiver flow -> engineer: Next.js client, offline queue
Part 5: Administrator surfaces -> engineer: Next.js admin
Part 6: History and exports -> engineer: views, timeline, CSV
Part 7: Verification -> engineer: Playwright, RLS tests, seed
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

Done means a resident aide with a resident on the floor can file a Level 1 in under twenty seconds without typing, a Level 3 reaches the Administrator's phone and shows up acknowledged on the aide's receipt, and the Administrator closes Sections 2 and 4 in under a minute on a phone. The admin surfaces must look like they were always part of Haven: same primitives, same density, same restraint. The caregiver flow must look like the rest of the caregiver surface, not like a separate app. If at any point the output starts to feel like a generic incident form with more fields, or like a dashboard that makes the answer take longer to reach, stop and correct course before continuing. That signal matters more than shipping the part fast.

---

## Final completion gate

Before declaring complete:

1. `npm run typecheck && npm run lint && npm run test && npm run build`, all exit 0.
2. `npm run migrations:check` passes; `npm run migrations:verify:pg` replays clean (or `[PARKED]` with the exact command).
3. Playwright `care-events` project passes for all eight tiles.
4. The SQL evidence block for spec §9 items 4 to 8 is printed in the transcript.
5. The oracle's final proof pass shows `[PROOF PASS — CLEAN]`.
6. Self-audit every completion criterion above, PASS per item, with the transcript line it points at.

When all gates pass, output:

```
[GOAL COMPLETE]

Something Happened capture built end-to-end on branch blewis/care-events-three-tap.
- Part 1: level engine and fixtures
- Part 2: migrations 400 to 403, definer functions, views, COL seed
- Part 3: care-event-dispatcher
- Part 4: /caregiver/report three-tap flow with offline queue
- Part 5: Administrator card, Today strip, delivery ledger
- Part 6: Timeline, Incident Reports Log export, handoff summary
- Part 7: Playwright, RLS tests, demo seed
Oracle proof: clean.
Parked: {list or none}
Review: git diff main...blewis/care-events-three-tap
Run: npm run dev
```

Then stop.
