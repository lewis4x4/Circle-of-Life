# Autonomous loop — running log (Haven / Circle-of-Life)

**Purpose:** Session-to-session continuity: what was read, what is next on the roadmap, what shipped, and what gates passed. **Not** a substitute for `docs/specs/*` — those remain authoritative for product scope.

---

## RECORD — flagship raw query errors (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `flagship-raw-query-errors` |
| **Mission alignment** | **pass** — training walkthroughs no longer see PostgREST text on flagship hub loads. |
| **Change** | Billing, dietary, rounding, family notes, and executive load paths use `formatLiveDataLoadError`. |
| **Gate** | `test-results/agent-gates/2026-08-27T02-24-02-070Z-flagship-raw-query-errors.json` |

---

## RECORD — rounding live resident fallback (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `rounding-live-resident-fallback` |
| **Mission alignment** | **pass** — live rounding names a missing resident join instead of inventing a person. |
| **Change** | `formatLiveRoundingResidentDisplay` on cards, check-in label, and drawer task. |
| **Gate** | `test-results/agent-gates/2026-08-27T02-17-44-567Z-rounding-live-resident-fallback.json` |

---

## RECORD — executive benchmarks stub copy (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `executive-benchmarks-stub-copy` |
| **Mission alignment** | **pass** — operators see that external peer KPIs are not live, without calling the page a stub. |
| **Change** | Named gap copy for cross-operator opt-in; removed “stub” from UI and stored notes. |
| **Gate** | `test-results/agent-gates/2026-08-27T02-13-31-535Z-executive-benchmarks-stub-copy.json` |

---

## RECORD — standup Eastern dates (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `standup-eastern-dates` |
| **Mission alignment** | **pass** — evening walkthroughs keep standup “today” and the Monday week window on the COL Eastern calendar. |
| **Change** | Replaced `toIsoDate()` UTC slice with `todayFacilityDateIso` + Eastern Monday week bounds. |
| **Gate** | `test-results/agent-gates/2026-08-27T02-08-12-565Z-standup-eastern-dates.json` |

---

## RECORD — dietary diet-order hub cap (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `dietary-orders-cap-50` |
| **Mission alignment** | **pass** — dietary staff can tell when the hub roster is a newest-50 slice, not every order at the facility. |
| **Change** | Reused `DIET_ORDERS_HUB_LIMIT`; footnote when the fetch is full. CSV export stays its own 500-row query. |
| **Gate** | `test-results/agent-gates/2026-08-27T02-00-18-587Z-dietary-orders-cap-50.json` |

---

## RECORD — billing collections hub cap (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `billing-collections-cap-200` |
| **Mission alignment** | **pass** — collectors can tell when the activity log is a newest-200 slice, and failed loads no longer show PostgREST text. |
| **Change** | Named `COLLECTIONS_HUB_LIMIT`; footnote when full; `formatLiveDataLoadError` on fetch failure. |
| **Gate** | `test-results/agent-gates/2026-08-27T01-52-26-022Z-billing-collections-cap-200.json` |

---

## RECORD — billing invoice hub cap (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `billing-invoice-cap-200` |
| **Mission alignment** | **pass** — operators can tell when the invoice list and CSV are a newest-200 slice, not the full ledger. |
| **Change** | Named `INVOICE_HUB_LIMIT` and a footnote when the fetch is full. |
| **Gate** | `test-results/agent-gates/2026-08-27T01-45-22-798Z-billing-invoice-cap-200.json` |

---

## RECORD — billing settings copy (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `billing-settings-dead-end` |
| **Mission alignment** | **pass** — operators are told scheduling is not live and sent to working billing tools. |
| **Change** | Removed “Pilot placeholder” subtitle. |
| **Gate** | `test-results/agent-gates/2026-08-27T01-32-38-719Z-billing-settings-dead-end.json` |

---

## RECORD — family-messages short URL (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `family-messages-short-url` |
| **Mission alignment** | **pass** — staff bookmarks to `/family-messages` reach the notes hub instead of a 404. |
| **Change** | Added `family-messages` to the next.config mirrored-segment redirects. |
| **Gate** | `test-results/agent-gates/2026-08-27T01-26-55-895Z-family-messages-short-url.json` |

---

## RECORD — family portal create stubs (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `family-portal-create-stubs` |
| **Mission alignment** | **pass** — do not offer create flows that are not wired. |
| **Change** | Removed + Schedule conference / + Add consent. Stub routes redirect to the hub. |
| **Gate** | `test-results/agent-gates/2026-08-27T01-20-35-726Z-family-portal-create-stubs.json` |

---

## RECORD — executive role-gate copy (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `executive-role-gate-copy` |
| **Mission alignment** | **pass** — keep the org-admin overview gate; stop offering facility admins and managers a bounce that looks like a 403. |
| **Change** | Command nav: owner/org admin keep Executive summary; facility admin gets Standup; other roles lose the item. ExecutiveHubNav filters links by the same rule. |
| **Gate** | `test-results/agent-gates/2026-08-27T01-13-43-390Z-executive-role-gate-copy.json` |

---

## RECORD — flagship V2 landing honesty (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `flagship-v2-landing-honesty` |
| **Mission alignment** | **pass** — keep V2 as the current flagship landing and restore the operational board nav so trainers are not trapped on a KPI shell. |
| **Decision** | Do not kill-switch `NEXT_PUBLIC_UI_V2`. |
| **Change** | Executive hub nav on V2 executive / standup / reports / benchmarks; rounding hub nav under the V2 rounding title; residents list subtitle names the current roster. |
| **Gate** | `test-results/agent-gates/2026-08-27T01-05-11-368Z-flagship-v2-landing-honesty.json` |

---

## RECORD — rounding escalate-further 404 (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `rounding-escalate-further-404` |
| **Mission alignment** | **pass** — operators can finish an open escalation without a dead path. |
| **Change** | Removed the **Escalate further** link to missing `/admin/rounding/escalations/[id]/review`. Start review / Resolve / Dismiss unchanged. |
| **Gate** | `test-results/agent-gates/2026-08-27T00-55-17-802Z-rounding-escalate-further-404.json` |

---

## RECORD — Track A A5 owner re-attestation (2026-08-26)

| Field | Value |
|-------|--------|
| **Segment** | `track-a-a5-closed` (docs only) |
| **Mission alignment** | **pass** — recovery posture (Pro, signed BAA, PITR) is owner-attested; hunts must not re-open A5 as unsigned. |
| **Owner** | Brian Lewis — BAA and PITR are taken care of. |
| **Already on file** | Pro + BAA 2026-05-11; PITR `pitr_7` 2026-08-19 (`pitr_enabled: true`). |
| **Doc sync** | Struck A5 from `AGENTS.md` Track A blockers; marked **Done** in `TRACK-A-CLOSEOUT-ROADMAP.md`; **PASS** in `PHASE1-ENV-CONFIRMATION.md`, `PHASE1-CLOSURE-RECORD.md`, `UNIFIED-ROADMAP.md`, specs README. |
| **Still open on Track A** | A3 §B–§E UAT depth (and A4/A6 as needed). Not A5. |

---

## RECORD — perf navigation remediation (2026-06-30)

| Field | Value |
|-------|--------|
| **Initiative** | [`2026-06-28-perf-navigation-remediation-handoff.md`](./reviews/2026-06-28-perf-navigation-remediation-handoff.md) |
| **Shipped segments** | **perf-nav-02** (pending nav + loading shells); **perf-nav-06/07** (RSC bootstrap hubs + resident detail); **perf-waterfall-10** (incident detail server loader + parallel queries); **perf-cache-08** (billing ledger, vendor/insurance, quality, **facilities**, **transportation** hubs → `useQuery` + segment `QueryClientLayout`); **perf-auth-09** partial (HavenAuth on new forms + finance client pages); **fix(ci)** AppShell lazy feedback/survey chrome (450 kB gzip cap). |
| **Mission alignment** | **pass** — Faster time-to-action on role-governed admin workflows; RLS/audit unchanged. |
| **Next slice** | **perf-auth-09** — finish `getUser()` grep cleanup under `src/app/(admin)`. Optional: nav latency script, extend `HavenNavLink` to in-page hub links. |
| **Gate artifacts** | `test-results/agent-gates/2026-06-29T03-*` (nav 06/07, waterfall-10), `2026-06-30T03-*` (auth-09, cache-08 vendor/insurance), `2026-06-30T04-13-*` (cache-08 quality), `2026-06-30T12-52-*` (cache-08 facilities + transportation). |

---

## RECORD — production schema drift repair (2026-06-28)

| Field | Value |
|-------|--------|
| **Segment** | `schema-drift-250-288-repair` |
| **Mission alignment** | `risk` — clinical resident profile and intake workflows were blocked by remote DDL drift; repair restores operator visibility; migration tracking process still needs `migrations:verify:remote` in ops cadence. |
| **Root cause** | Migrations **250–288** were recorded in `supabase_migrations.schema_migrations` on `manfqmasfqppukpobpld` but most DDL never executed (same class as migration **174** / `237_restore_dietary_command_deck.sql`). |
| **Symptom** | Clinical resident detail: “Live resident profile is unavailable right now.” Postgres `42703` — e.g. `residents.code_status_verified_at does not exist`. |
| **Repair** | Re-applied migration SQL via `npx supabase db query --linked -f supabase/migrations/NNN_*.sql` for **250–288** (257/259 repaired earlier). Benign skips: **274** (`exec_nlq_messages` exists), **282** (seed dup), **283** (enum exists). |
| **Prevention** | Added `npm run migrations:verify:remote` (`scripts/verify-remote-schema.mjs`) — probes 35 critical columns/tables. Added `src/lib/supabase/query-error.ts` + `src/lib/live-data-fallback.ts` for dev-visible load errors. |
| **Gates** | Run `npm run migrations:verify:remote` after any remote migration push; `migrations:verify:pg` alone does not catch remote drift. |

---

## Source-of-truth files (BOOT — read every session)

| # | Path | Role |
|---|------|------|
| 1 | `docs/specs/README.md` | Spec index, migration sequence, Track D/E pointers |
| 2 | `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md` | Phase 1 acceptance / owner gates |
| 3 | `docs/specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md` | Next Enhanced segment after D1–D84 |
| 4 | `CODEX.md` | Engineer command contract, gates, commit discipline |

**Also:** `AGENTS.md`, `docs/mission-statement.md`, `docs/specs/TRACK-D-PHASE6-PASS.md`, and **`git log -15`** for recent merges.

---

## FIND — next roadmap item (2026-04-10 session)

**Authoritative “next” line** in [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md):

> **Recommended next segment — D85+ (owner priority):** **Module 14** full Edge/cron cross-check **after clinical rules sign-off**; other §1 deferrals — one bounded slice at a time.

**Interpretation:**

- **D85+** is the **next named backlog segment** after **D84** (shipped).
- **Engineering alone cannot “complete” D85** until **COL clinical / pharmacy** signs off on automated dietary–medication texture rules (see same doc §1 table — partial work already shipped as D50–D53 read-only hints).
- **Parallel (non-code) priorities:** Track **A3** UAT depth in [TRACK-A-CLOSEOUT-ROADMAP.md](./specs/TRACK-A-CLOSEOUT-ROADMAP.md). **A5 is closed** (2026-08-26).
- **Strategic sequence (AGENTS.md):** After Track A closeout and owner direction — **Module 25: Resident Assurance Engine** (`docs/specs/25-resident-assurance-engine.md`).

**Repo migration number:** **`317`** is the next free migration file after **`316`** (`316_admin_command_center_manager_access.sql`). Treat UNIFIED-ROADMAP §1 and the migrations folder as canonical if an older doc still says `121` / `207` / `308`.

---

## PLAN template (use before D85+ or Module 25 code)

1. **Mission gate:** `pass` | `risk` | `fail` — one sentence (see `docs/mission-statement.md`).
2. **Spec:** Which `docs/specs/*.md` section (COL Alignment if present).
3. **DDL:** Migration number = README “next free”; RLS + audit triggers per `00-foundation.md`.
4. **API / Edge:** Auth-first, secrets in env only; no PHI in logs.
5. **UI:** Admin shell + dark mode; accent aligns with design tokens (orange family used for warnings / QEP-style emphasis in hubs — see `UI-DESIGN-DECISIONS.md`).

---

## BUILD conventions (this repo)

- **Migrations:** Next file = **`317_*.sql`**.
- **RLS:** `haven.organization_id()`, `haven.has_facility_access()`, etc., before new table policies.
- **TypeScript:** Avoid `as any`; prefer typed Supabase `Database` helpers.
- **Fallbacks:** Non-blocking UX for empty data; no silent clinical automation without sign-off.

---

## REVIEW — six build gates (segment runner)

From `npm run segment:gates` (see `CODEX.md`): hygiene, security scan, ESLint, migrations check, production build, optional Docker migration replay; with `--ui`: Playwright + axe on configured routes.

**Self-audit checklist (13 items):**

1. Mission alignment stated  
2. Spec / COL notes read  
3. Migration sequence updated in README if DDL added  
4. RLS enabled on new tables  
5. Audit trigger on mutable clinical/financial tables  
6. No secrets in repo  
7. `npm run build` green  
8. `npm run migrations:check` PASS  
9. `npm run migrations:verify:pg` when migrations touched  
10. `npm run segment:gates` PASS + JSON artifact under `test-results/agent-gates/`  
11. Conventional commit message  
12. Remote migration parity plan (owner) if DDL  
13. Handoff / this file updated  

---

## RECORD — round 2026-06-14 (loop: Track F finished end-to-end — LOOP EXIT)

| Field | Value |
|-------|--------|
| **BOOT** | `TRACK-F-BUILD-HANDOFF.md`, `UNIFIED-ROADMAP.md` §2, specs `35-office-suite.md` / `36-employee-workspace.md`, `git log`/`git status`. |
| **FIND** | Remaining unbuilt Track F segments: F3-8, F4-4, F5-1, F5-2 (built this loop); F4-1 eFax still owner-blocked. |
| **BUILD** | F3-8 workspace search (`f9a66472`); F4-4 survey binder, migration `303` (`14d6efad`); F5-1 Drive import, migration `304` (`eb10ca21`); F5-2 cutover, migration `305` (`4b4ffe85`). One atomic commit + recorded hash per segment, each `--ui` gated PASS. |
| **Mission alignment** | **pass** — completes the in-platform office/workspace suite + Drive→Haven migration path so COL retires Google Drive (F0-5 2026-07-01) onto one role-governed, audited data layer. |
| **Gate artifacts** | `2026-06-14T02-32-31…F3-8`, `…02-38-34…F4-4`, `…02-47-01…F5-1`, `…02-52-20…F5-2` under `test-results/agent-gates/`. |
| **LOOP EXIT** | **All agent-buildable Track F segments complete.** Only **F4-1 (eFax)** remains — **blocked on owner eFax-vendor selection** (`TRACK-F-BUILD-HANDOFF.md` → Owner inputs outstanding). Per STOP condition "all remaining segments blocked on owner decisions," loop halts and reports. |
| **Owner inputs needed** | (1) eFax vendor pick to unblock F4-1. (2) Google Drive OAuth client/scope to enable F5-1 live binary byte-transfer. (3) `supabase db push` through `305` on the target project. |
| **Deferred** | Module 25 (Resident Assurance Engine) per owner priority. |

---

## RECORD — round 2026-04-10 (doc parity)

| Field | Value |
|-------|--------|
| **Scope** | Documentation only — align README + PHASE1-ENV + Track D backlog footer with **`001`–`120`** and next **`121`**. |
| **Mission alignment** | **pass** — accurate ops docs support regulatory readiness and migration parity. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T02-20-28-303Z-autonomous-doc-sync-2026-04-10.json` |
| **Gitleaks** | Historical false positives on `a8f6235` report executors (`{ key, value }` / `d1_30`-style names) — **`.gitleaksignore`** fingerprints + variable renames in `executors/index.ts`. |
| **Deferred** | **D85+** code until clinical sign-off; Module 25 until Track A / owner priority. |
| **Loop exit (incomplete)** | First run stopped after one cycle without **RECORD — loop exit**; **D85+** was FIND but not buildable without sign-off — should have LOOP’d to a second bounded slice or written explicit exit. **Fixed in doc:** LOOP section now requires explicit exit or another cycle. |
| **Follow-up (2026-04-10)** | Report summary rows renamed **`key` → `metricKey`** to avoid gitleaks `generic-api-key` false positives on `{ key: "…", value: … }`; `.gitleaksignore` extended for historical commits. |

---

## RECORD — round 2026-04-10 (loop: migration 120 + README parity)

| Field | Value |
|-------|--------|
| **BOOT** | README, TRACK-A, TRACK-D backlog, CODEX, `git log` / `git status`. |
| **FIND** | **D85+** still clinical-gated. **Unblocked:** untracked **`120_col_multi_facility_demo_seed.sql`** — README already claimed **`001`–`120`** but file was not on `main`. |
| **BUILD** | Add migration **`120`**; fix README §closeout step 2 (**`001`–`120`**, apply **`120`** remote); extend **`.gitleaksignore`** for commit **`17b5984`** (`metricKey` false positives). |
| **Mission alignment** | **pass** — multi-facility demo data supports pilot testing across COL sites under existing RLS. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T02-30-35-126Z-loop-migration-120-col-multi-facility-seed.json` |
| **Deferred** | **D85+** automation; owner: `supabase db push` through **`120`** on target project. |

---

## RECORD — round 2026-04-09 (loop: PH1-P02 execution log parity)

| Field | Value |
|-------|--------|
| **BOOT** | README, TRACK-A, TRACK-D backlog, CODEX, `Autonomous.md`, `git status` / `git log`. |
| **FIND** | **D85+** still clinical-gated. **Unblocked:** [PHASE1-EXECUTION-LOG.md](./specs/PHASE1-EXECUTION-LOG.md) PH1-P02 notes still said **001–119** / apply **`119`** while [PHASE1-ENV-CONFIRMATION.md](./specs/PHASE1-ENV-CONFIRMATION.md) is **001–120**. |
| **BUILD** | Align PH1-P02 row to **001–120** and migration **`120`**. |
| **Mission alignment** | **pass** — execution log matches env confirmation so ops/UAT evidence stays consistent. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T03-10-54-543Z-loop-ph1-p02-exec-log-120-parity.json` |
| **Deferred** | **D85+** until clinical sign-off; remote parity still owner action after **`120`**. |

---

## RECORD — round 2026-04-10 (loop: Phase 1 docs migration sequence 120)

| Field | Value |
|-------|--------|
| **BOOT** | README, TRACK-D backlog, `Autonomous.md`, `git log` / `git status`. |
| **FIND** | **D85+** still clinical-gated. **Unblocked:** Phase 1 sign-off docs still said repo **001–111** while [README.md](./specs/README.md) / [PHASE1-ENV-CONFIRMATION.md](./specs/PHASE1-ENV-CONFIRMATION.md) are **001–120**. |
| **BUILD** | [PHASE1-CLOSURE-RECORD.md](./specs/PHASE1-CLOSURE-RECORD.md), [PHASE1-ACCEPTANCE-CHECKLIST.md](./specs/PHASE1-ACCEPTANCE-CHECKLIST.md), [PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md](./specs/PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md), [PHASE1-RLS-VALIDATION-RECORD.md](./specs/PHASE1-RLS-VALIDATION-RECORD.md) — **001–120** wording. |
| **Mission alignment** | **pass** — acceptance and RLS records match canonical migration list for auditability. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T11-33-53-828Z-loop-phase1-docs-migration-120-parity.json` |
| **Deferred** | **D85+**; owner remote parity through **`120`**. |

---

## RECORD — round 2026-04-10 (loop: FIND — no new parity delta)

| Field | Value |
|-------|--------|
| **BOOT** | [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md), prior `Autonomous.md` RECORD rows, `git status` clean @**836a0a5**. |
| **FIND** | **D85+** still clinical-gated. Grep `**/*.md` for repo migration range drift (**`001–11[0-9]`**): no stale range strings outside historical **RECORD** tables in this file; Phase 1 + README already reconciled to **001–120** in commits **bf47eee** / **836a0a5**. |
| **BUILD** | *(none)* |
| **Mission alignment** | **pass** — avoids shipping speculative Module 14 automation without COL clinical/pharmacy sign-off. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-09-27-320Z-loop-autonomous-find-no-delta-2026-04-10.json` |
| **Deferred** | **D85+**; Track A owner UAT / Pro–BAA–PITR per [TRACK-A-CLOSEOUT-ROADMAP.md](./specs/TRACK-A-CLOSEOUT-ROADMAP.md). |

---

## RECORD — round 2026-04-10 (loop: TRACK-D PASS next-DDL hint)

| Field | Value |
|-------|--------|
| **BOOT** | [README.md](./specs/README.md), [TRACK-D-PHASE6-PASS.md](./specs/TRACK-D-PHASE6-PASS.md), `git status` clean @**e25167b**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** [TRACK-D-PHASE6-PASS.md](./specs/TRACK-D-PHASE6-PASS.md) footer said new DDL **`120+`** while next free file is **`121`**; [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md) rules still said **`119+`**. |
| **BUILD** | Both: **`121+`** (after **`120`**) + README pointer where applicable. |
| **Mission alignment** | **pass** — spec/runbook pointers stay aligned with repo migration sequence. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-11-13-093Z-loop-track-d-pass-next-ddl-121-hint.json` |
| **Deferred** | **D85+** Edge/cron automation pending clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: AGENTS.md Track D migration 120)

| Field | Value |
|-------|--------|
| **BOOT** | `AGENTS.md` Step 4 vs [README.md](./specs/README.md) migration **120**, `git status` clean @**aa2a7dd**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** Step 4 shipped list ended at **D84** without **migration `120`** multi-facility demo seed. |
| **BUILD** | [AGENTS.md](../AGENTS.md) — one clause before **D85+** plan pointer. |
| **Mission alignment** | **pass** — agent entrypoint reflects repo DDL used for multi-site pilot prep. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-13-10-640Z-loop-agents-track-d-migration-120.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: CODEX + CLAUDE → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | [CODEX.md](../CODEX.md), [CLAUDE.md](../CLAUDE.md), `git status` clean @**cb37a58**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** engineer entrypoints did not link **`docs/Autonomous.md`** (loop continuity). |
| **BUILD** | [CODEX.md](../CODEX.md) **References** + [CLAUDE.md](../CLAUDE.md) **Key references** — one line each. |
| **Mission alignment** | **pass** — discoverable loop log supports disciplined closeout without scope creep. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-14-54-527Z-loop-codex-claude-autonomous-ref.json` |
| **Deferred** | **D85+** Edge/cron automation. |

---

## RECORD — round 2026-04-10 (loop: AGENTS.md resource table → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | [AGENTS.md](../AGENTS.md) “Where Everything Lives”, `git status` clean @**54e3811**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** resource table had **CODEX** + gates but not **`docs/Autonomous.md`** (already in **CODEX** / **CLAUDE** from prior commit). |
| **BUILD** | [AGENTS.md](../AGENTS.md) — one table row after **`CODEX.md`**. |
| **Mission alignment** | **pass** — single index for agents matches engineer entrypoints. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-17-12-644Z-loop-agents-table-autonomous-ref.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: agent-gates runbook → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | [agent-gates-runbook.md](./agent-gates-runbook.md), `git status` clean @**e333c80**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** gates runbook had no pointer to **`docs/Autonomous.md`** (BOOT / FIND / RECORD). |
| **BUILD** | One paragraph after intro in [agent-gates-runbook.md](./agent-gates-runbook.md). |
| **Mission alignment** | **pass** — gate operators can find loop continuity from the same doc they use for `--segment`. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-18-45-206Z-loop-agent-gates-runbook-autonomous-ref.json` |
| **Deferred** | **D85+** Edge/cron automation. |

---

## RECORD — round 2026-04-10 (loop: AGENTS table → agent-gates runbook)

| Field | Value |
|-------|--------|
| **BOOT** | [AGENTS.md](../AGENTS.md) resource table vs [agent-gates-runbook.md](./agent-gates-runbook.md), `git status` clean @**88101b3**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** **AGENTS** listed gate runner + artifacts but not the **runbook** path (operators already have runbook → **Autonomous** from **88101b3**). |
| **BUILD** | [AGENTS.md](../AGENTS.md) — one row before **Gate report schema**. |
| **Mission alignment** | **pass** — index matches **Cursor rule** / **CODEX** gate references. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-21-05-094Z-loop-agents-table-gates-runbook.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: AdminShell Haven brand → marketing home)

| Field | Value |
|-------|--------|
| **BOOT** | [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md), `git log`, HEAD **`078e2fe`**. |
| **FIND** | **D85+** clinical-gated. **Already shipped:** [AdminShell.tsx](../src/components/layout/AdminShell.tsx) — Haven logo + wordmark link to **`/`** (marketing home); commit **`078e2fe`**. |
| **BUILD** | *(none — RECORD bridges product work into this log)* |
| **Mission alignment** | **pass** — staff can return to the public Haven home from the admin shell without changing clinical scope. |
| **Gate artifact** | Product: `test-results/agent-gates/2026-04-10T12-23-34-140Z-fix-admin-haven-brand-home.json` — this RECORD: `test-results/agent-gates/2026-04-10T12-31-04-140Z-loop-autonomous-record-haven-brand-home-078e2fe.json` |
| **Deferred** | **D85+** Edge/cron med–texture automation until clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: FRONTEND-CONTRACT admin brand → /)

| Field | Value |
|-------|--------|
| **BOOT** | [FRONTEND-CONTRACT.md](./specs/FRONTEND-CONTRACT.md), `git status` clean @**061ecf2**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** canonical contract did not yet state **AdminShell** header brand → **`/`** (**078e2fe**). |
| **BUILD** | [FRONTEND-CONTRACT.md](./specs/FRONTEND-CONTRACT.md) §2 **Admin chrome** bullet. |
| **Mission alignment** | **pass** — spec matches shipped UX; no clinical automation. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-32-57-815Z-loop-frontend-contract-admin-brand-home.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: FIND — no new segment)

| Field | Value |
|-------|--------|
| **BOOT** | [README.md](./specs/README.md), [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md), `git status` clean @**e2f2eed**. |
| **FIND** | **D85+** clinical-gated. **Grep** `docs/specs/**/*.md` for **`001–11[0-8]`** / **`119+`** migration drift: **none**. Prior rounds already shipped **FRONTEND-CONTRACT** admin chrome + **Autonomous** RECORDs through **`e2f2eed`**. |
| **BUILD** | *(none)* |
| **Mission alignment** | **pass** — no speculative Module 14 automation or scope expansion. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-35-09-809Z-loop-autonomous-find-no-delta-e2f2eed.json` |
| **Deferred** | **D85+**; owner remote **`001`–`120`** parity. |

---

## RECORD — round 2026-04-10 (loop: Cursor segment-gates rule → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | [`.cursor/rules/segment-gates-cursor.mdc`](../.cursor/rules/segment-gates-cursor.mdc), `git status` clean @**e5417eb**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** Cursor **always-apply** gate rule had no **`docs/Autonomous.md`** pointer (BOOT / FIND / RECORD). |
| **BUILD** | One bullet at end of [segment-gates-cursor.mdc](../.cursor/rules/segment-gates-cursor.mdc). |
| **Mission alignment** | **pass** — agents reading Cursor rules first still reach loop continuity. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-40-38-094Z-loop-cursor-rule-autonomous-ref.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: segment-handoff template → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | [segment-handoff.md](../agents/templates/segment-handoff.md), `git status` clean @**2b73021**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** segment handoff template had no **`docs/Autonomous.md`** cross-link. |
| **BUILD** | [segment-handoff.md](../agents/templates/segment-handoff.md) — **See also** line under title. |
| **Mission alignment** | **pass** — handoffs align with loop continuity discipline. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-44-06-696Z-loop-segment-handoff-autonomous-ref.json` |
| **Deferred** | **D85+** Edge/cron automation. |

---

## RECORD — round 2026-04-10 (loop: engineer-of-record playbook → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | [engineer-of-record.md](../agents/playbooks/engineer-of-record.md), `git status` clean @**a915a90**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** engineer playbook had no **`docs/Autonomous.md`** pointer. |
| **BUILD** | [engineer-of-record.md](../agents/playbooks/engineer-of-record.md) — **See also** section. |
| **Mission alignment** | **pass** — EOR workflow matches loop continuity docs. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-47-32-707Z-loop-engineer-playbook-autonomous-ref.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## RECORD — round 2026-04-10 (loop: QA playbook → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | [qa-agent.md](../agents/playbooks/qa-agent.md), `git status` clean @**94d7870**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** QA playbook (gate signals) had no **`docs/Autonomous.md`** pointer. |
| **BUILD** | [qa-agent.md](../agents/playbooks/qa-agent.md) — **See also** section. |
| **Mission alignment** | **pass** — QA role aligns with segment gate + loop continuity. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-49-09-441Z-loop-qa-playbook-autonomous-ref.json` |
| **Deferred** | **D85+** Edge/cron automation. |

---

## RECORD — round 2026-04-10 (loop round 2: remaining playbooks → Autonomous.md)

| Field | Value |
|-------|--------|
| **BOOT** | After **4288b30** (LOOP contract commit): `git log`, grep `agents/playbooks/**/*.md` for **`Autonomous`**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** six playbooks still had no **`docs/Autonomous.md`** **See also** (migration, release, security, chaos, performance, CDO). |
| **BUILD** | **See also** added to: `migration-integrity-agent.md`, `release-gate-agent.md`, `security-rls-agent.md`, `testing-simulation-agent.md`, `performance-agent.md`, `chief-design-officer-agent.md`. |
| **Mission alignment** | **pass** — registry playbooks align with session loop discipline. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-55-48-565Z-loop-remaining-playbooks-autonomous-ref.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## LOOP — restart (must not “just stop”)

### What counts as a “loop” (non-negotiable)

One **BOOT → FIND → … → RECORD** pass is **one round**, not a finished loop.

- **Finished loop (same session):** After **RECORD** for round *N*, you **must** run **BOOT** again and **FIND** again before stopping. That second pass is **round *N+1***. Only after **FIND** in round *N+1* may you either ship more work, or write **RECORD — loop exit** if nothing shippable remains.
- **Incomplete run:** Ending the session right after a single **RECORD** without a **second BOOT + FIND**, and without updating **RECORD — loop exit**, is **not** a loop—it is a stopped mid-loop.

**Failure mode (2026-04-10):** Agents treated “RECORD” as session end. **RECORD ends a round, not the loop.**

### When to continue vs stop

| Situation | Action |
|-----------|--------|
| **FIND** returns an **agent-executable** bounded segment (spec exists, no owner waiver needed) | **PLAN → BUILD → REVIEW → FIX → COMMIT → RECORD** (one commit per segment per `CODEX.md`), then **BOOT** again (next round). |
| **FIND** returns **D85+** or similar **blocked** on owner/clinical sign-off | Do **not** ship that automation. **FIND** again for a **different** unblocked slice (doc/parity, tooling, spec clarification, prep). |
| **Second FIND** (after prior **RECORD**) finds **nothing** shippable | **RECORD — loop exit** (`date`, `reason`, `next_human_action`), then stop. |

### LOOP checklist (same session) — run every time

| # | Do this |
|---|--------|
| 1 | **BOOT** (source-of-truth table + `git log`) |
| 2 | **FIND** |
| 3 | If work exists → **PLAN → BUILD → REVIEW → FIX → COMMIT → RECORD** |
| 4 | **BOOT again** — *required*; do not stop here |
| 5 | **FIND again** |
| 6 | If work exists → go to step 3 for the new segment. If **no** work → **RECORD — loop exit** and stop |

**Stopping after step 3 without step 4–6 is an incomplete run** unless you immediately continue in the same chat with BOOT step 4.

---

## RECORD — round 2026-04-10 (loop round 3: BOOT → FIND — no further segment)

| Field | Value |
|-------|--------|
| **BOOT** | Same source-of-truth table + `git log`; confirm **`4288b30`** + pending round 2 commit. |
| **FIND** | **D85+** clinical-gated. **`agents/playbooks/*.md`:** all **8** files reference **`docs/Autonomous.md`**. **`docs/specs`:** no **`001–11x`** / **`119+`** migration drift. No additional bounded segment without repeating work. |
| **BUILD** | *(none)* |
| **Mission alignment** | **pass** — second BOOT/FIND after round 2 **RECORD** satisfied; third pass clears exit. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T12-57-03-076Z-loop-autonomous-multi-round-session.json` (session gate after round 2–3 doc edits) |

---

## RECORD — session 2026-04-09 (loop round 1: `agents/registry.yaml` + `agents/README.md`)

| Field | Value |
|-------|--------|
| **BOOT** | [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md), [README.md](./specs/README.md), `git log` @**fa544ad**. |
| **FIND** | **D85+** clinical-gated. **Unblocked:** [registry.yaml](../agents/registry.yaml) and [agents/README.md](../agents/README.md) had no pointer to **`docs/Autonomous.md`**. |
| **BUILD** | Comment in **`registry.yaml`**; first bullet in **`agents/README.md`**. |
| **Mission alignment** | **pass** — registry entrypoints match documented loop discipline. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T13-19-19-170Z-loop-agents-registry-readme-autonomous.json` |
| **Deferred** | **D85+** until clinical sign-off. |

---

## RECORD — session 2026-04-09 (loop round 2: BOOT → FIND — exit)

| Field | Value |
|-------|--------|
| **BOOT** | `grep -r Autonomous agents/` (playbooks complete from **fa544ad**); **`docs/specs`** migration drift grep. |
| **FIND** | **D85+** gated; no further **`agents/*`** file needs an **Autonomous** link; **`docs/specs`** has no stale **`001–11x`** / **`119+`** DDL hints. **No** additional bounded segment without repeating prior work. |
| **BUILD** | *(none)* |
| **Mission alignment** | **pass** — second pass satisfies **LOOP** checklist steps 4–6. |
| **Gate artifact** | `test-results/agent-gates/2026-04-10T13-19-19-170Z-loop-agents-registry-readme-autonomous.json` (session gate covers doc edits for rounds 1–2) |

---

## RECORD — loop exit (optional)

| Field | Value |
|-------|--------|
| **date** | **2026-04-09** |
| **reason** | **D85+** still **clinical / pharmacy** gated. **2026-04-10 (earlier):** LOOP contract **4288b30**; remaining playbook **See also** links (**fa544ad**); third BOOT/FIND — no further playbook/migration drift. **This session (2026-04-09):** **`agents/registry.yaml`** + **`agents/README.md`** → **`docs/Autonomous.md`**; second BOOT/FIND — no further unblocked slice (migration grep clean). |
| **next_human_action** | Remote **`001`–`120`** parity; COL clinical sign-off for **D85+**; Track A UAT / Pro–BAA–PITR per owner schedule. |

---

## Git reference (recent)

Run: `git log -15 --oneline` — see commit history for reports UX, doc syncs, Track D segments.

---

## RECORD — segment 2026-08-13 (admin navigation performance hardening)

| Field | Value |
|-------|--------|
| **BOOT** | `AGENTS.md`, `CODEX.md`, Next.js 16 instant-navigation / prefetching / streaming / loading / authentication and upgrade guides, live Supabase migration parity, and authenticated production-build navigation timing. |
| **FIND** | Admin transitions had no destination-local feedback boundary, repeated client/server auth resolution, several blocking server pages, and a Command Center fan-out of roughly 34 PostgREST requests. The prior performance probe measured `page.goto(..., networkidle)` instead of the operator's click-to-feedback and click-to-content experience. |
| **BUILD** | Added destination-local admin loading feedback and palette prefetch; streamed Command Center, Finance, Residents, Staff, and Schedules behind immediate shells; consolidated browser auth and request-scoped server auth; changed proxy authorization to cached ES256 claim verification; made role-home navigation direct; replaced Command Center fan-out with the governed, RLS-preserving `admin_command_center_projection` RPC (migrations `313` and `315`); enabled privacy-scrubbed sampled Sentry tracing; rebuilt the navigation timing probe for cold/warm click metrics. |
| **Evidence** | Enforced local production timing across Residents, Staff, Schedules, and Finance: shell p95 **3.3 ms**, cold content p95 **1762.3 ms**, warm content p95 **422.1 ms**, zero budget failures. Authenticated live RPC returned one valid projection payload; the projection SQL was deployed before its final repository renumbering to migrations `313` and `315`. Focused tests **5/5**, TypeScript, lint, Next.js **16.2.11** build (**408/408** pages), zero-vulnerability npm audit, gitleaks, stress, design review, and axe passed. The optional Docker replay hit the existing Supabase stub `auth` schema permission limitation; live apply + authenticated transaction/RPC verification covered the projection definitions now tracked as migrations `313` and `315`. |
| **Mission alignment** | **pass** — reduces operator wait and preserves role, facility, RLS, audit, and PHI boundaries; AI remains outside clinical judgment and this change adds no clinical automation. |
| **Gate artifact** | `test-results/agent-gates/2026-08-14T01-58-10-515Z-NAV-PERF-2026-08-13.json` |
| **Deferred** | Track A owner depth UAT and Pro/BAA/PITR remain human gates. |

---

## RECORD — schema-drift-310-316-repair (2026-08-19)

| Field | Value |
|-------|--------|
| **Segment** | `schema-drift-310-316-repair` |
| **Mission alignment** | `pass` — restores Command Center manager access and migration tracking so operators see the same RLS-governed projection the repo already shipped; no clinical automation. |
| **Probe** | Remote `schema_migrations` had `308`/`309`/`314` named as Command Center files while live `admin_command_center_projection` was still the pre-manager guard (`owner, org_admin, facility_admin` only). `310`–`313`/`315`–`316` were local-only. Snack columns, discovery RPCs, and team-space helper policies were already live. |
| **Repair** | Applied `315` then `316` then `308` (anon revoke after `CREATE OR REPLACE`). Recorded `310`–`313`/`315`–`316` and renamed `308`/`309`/`314` to match local stems via `scripts/repair-remote-schema-migrations-310-316.sql`. |
| **Verify** | Live guard includes `manager`; `anon` cannot execute the projection. Extended `migrations:verify:remote` probes for snack_logs + Command Center + discovery RPC — **49/49 PASS**. |
| **Gate artifact** | `test-results/agent-gates/2026-08-19T19-42-45-834Z-schema-drift-310-316-repair.json` |
| **Next** | PITR (Track A A5), then Homewood import/UAT. Next free DDL: **`317`**. |

---

## RECORD — Track A A5 PITR re-probe (2026-08-19)

| Field | Value |
|-------|--------|
| **Segment** | `track-a-a5-pitr-reprobe` |
| **Mission alignment** | `risk` — daily physical backups are current; point-in-time restore is still off, so PHI production remains blocked. |
| **Evidence** | `npx supabase backups list --project-ref manfqmasfqppukpobpld -o json` → `pitr_enabled: false`, `walg_enabled: true`, latest completed backup `2026-08-19T12:37:20.957Z`. |
| **Follow-up** | **Closed 2026-08-19.** Workflow [Enable Supabase PITR](https://github.com/lewis4x4/Circle-of-Life/actions/runs/32296769927) applied `ci_small` then `pitr_7`. CLI re-probe: `pitr_enabled: true`. PH1-OA04 / PH1-P06 **PASS**. |
| **Docs** | [PHASE1-ENV-CONFIRMATION.md](./specs/PHASE1-ENV-CONFIRMATION.md), [PHASE1-EXECUTION-LOG.md](./specs/PHASE1-EXECUTION-LOG.md) PH1-OA04, [COL-GO-LIVE-READINESS-CHECKLIST.md](./specs/COL-GO-LIVE-READINESS-CHECKLIST.md). |

---

## RECORD — homewood-roster-auth (2026-08-19)

| Field | Value |
|-------|--------|
| **Segment** | `homewood-roster-auth` |
| **Mission alignment** | `risk` — Homewood roster and staff invites are live, but preflight stays NO-GO until care plans exist and the four email-less admin rows can be invited. No clinical automation. |
| **Residents** | Dry-run 32 DRY-OK. Write 1: 31 UPDATED + 1 PARTIAL (payer `effective_date`). Import now sets `resident_payers.effective_date` from admit date. Write 2: **32 UPDATED**. Live cohort 33 active residents (one extra historical row). |
| **Staff** | Provision no longer aborts the whole run on missing email. **16 INVITED** (redirect `https://circleoflifealf.netlify.app/login`); **4 SKIP-NO-EMAIL** (duplicate administrator / assistant_administrator rows). `staff.user_id` linked 16; `user_facility_access` granted. |
| **Audit** | `npm run homewood:audit` — CRITICAL categories with rows = **1** (`residents_no_active_care_plan`, 33). HIGH = 4 unlinked staff. No care-plan import source in repo; do not invent plans. |
| **Preflight** | Not GO. Remaining blockers: care plans, four staff emails, invite acceptance / password set, then `homewood:verify-auth`. |
| **Next** | Dispatch PITR workflow; Phase 1 auth smoke; care-plan load when source exists. |
| **Gate artifact** | `test-results/agent-gates/2026-08-19T19-56-15-550Z-homewood-roster-auth.json` |

---

## RECORD — track-a-a5-pitr-enabled (2026-08-19)

| Field | Value |
|-------|--------|
| **Segment** | `track-a-a5-pitr-enabled` |
| **Mission alignment** | `pass` — point-in-time recovery is on for the Haven production database before further PHI reliance. |
| **Evidence** | Action run `32296769927` success; `pitr PATCH attempt 1 -> 200`; `npx supabase backups list --project-ref manfqmasfqppukpobpld -o json` → `pitr_enabled: true`, compute `ci_small`. |
| **Docs** | PH1-P06 / PH1-OA04 PASS; PHASE1-ENV-CONFIRMATION; COL-GO-LIVE-READINESS-CHECKLIST. |

---

## RECORD — phase1-auth-smoke-partial (2026-08-19)

| Field | Value |
|-------|--------|
| **Segment** | `phase1-auth-smoke-partial` |
| **Mission alignment** | `risk` — two of four pilot roles authenticated on production; facility_admin and family timed out at login so PH1-A04 is not closed. |
| **Evidence** | `BASE_URL=https://circleoflifealf.netlify.app npm run demo:auth-smoke:real` at 2026-08-19T20:00:08Z. Owner + caregiver `login_ok` / `shell_route_ok` / `cross_shell_ok`. Jessica + Linda `waitForURL` 15s timeout. |
| **Docs** | [PHASE1-EXECUTION-LOG.md](./specs/PHASE1-EXECUTION-LOG.md) PH1-A04 / PH1-P04 / PH1-OA02 / PH1-OA03 set PARTIAL. |

---

## RECORD — docs-index-317 (2026-08-19)

| Field | Value |
|-------|--------|
| **Segment** | `docs-index-317` |
| **Mission alignment** | `pass` — index-only; no schema or clinical behavior change. |
| **BUILD** | README / UNIFIED-ROADMAP / PHASE1-ENV-CONFIRMATION now say next free DDL **`317`**, remote tracking through **`316`**, Track F **built except F4-1**, 37 Edge Function folders. |
