# Autonomous loop — running log (Haven / Circle-of-Life)

**Purpose:** Session-to-session continuity: what was read, what is next on the roadmap, what shipped, and what gates passed. **Not** a substitute for `docs/specs/*` — those remain authoritative for product scope.

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
- **Parallel (non-code) priorities:** Track **A3–A6** in [TRACK-A-CLOSEOUT-ROADMAP.md](./specs/TRACK-A-CLOSEOUT-ROADMAP.md) (owner UAT, Pro/BAA/PITR).
- **Strategic sequence (AGENTS.md):** After Track A closeout and owner direction — **Module 25: Resident Assurance Engine** (`docs/specs/25-resident-assurance-engine.md`).

**Repo migration number:** **`121`** is the next free migration file after **`120`** (`120_col_multi_facility_demo_seed.sql`). *(If you see “225” elsewhere, treat it as non-canonical; this repo uses sequential `NNN_*.sql` under `supabase/migrations/`.)*

---

## PLAN template (use before D85+ or Module 25 code)

1. **Mission gate:** `pass` | `risk` | `fail` — one sentence (see `docs/mission-statement.md`).
2. **Spec:** Which `docs/specs/*.md` section (COL Alignment if present).
3. **DDL:** Migration number = README “next free”; RLS + audit triggers per `00-foundation.md`.
4. **API / Edge:** Auth-first, secrets in env only; no PHI in logs.
5. **UI:** Admin shell + dark mode; accent aligns with design tokens (orange family used for warnings / QEP-style emphasis in hubs — see `UI-DESIGN-DECISIONS.md`).

---

## BUILD conventions (this repo)

- **Migrations:** Next file = **`121_*.sql`** until README is updated again.
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

## RECORD — loop exit (optional)

| Field | Value |
|-------|--------|
| **date** | **2026-04-10** |
| **reason** | **D85+** still **clinical / pharmacy** gated. This loop synced **AGENTS.md** with migration **`120`**; no Module 14 Edge automation without COL sign-off. |
| **next_human_action** | Remote **`001`–`120`** parity; COL clinical sign-off for **D85+**; Track A UAT / Pro–BAA–PITR per owner schedule. |

---

## LOOP — restart (must not “just stop”)

**Failure mode (2026-04-10):** After COMMIT/PUSH/RECORD, the run **ended** instead of continuing the loop. **LOOP is not optional documentation** — it means either start another full **BOOT → FIND → … → RECORD** cycle in the **same session**, or **explicitly stop with a recorded reason** (see below).

### When to continue vs stop

| Situation | Action |
|-----------|--------|
| **FIND** returns an **agent-executable** bounded segment (spec exists, no owner waiver needed) | **Immediately** LOOP: go to **BOOT** again and ship that segment (one commit per segment per `CODEX.md`). |
| **FIND** returns **D85+** or similar **blocked** on owner/clinical sign-off | Do **not** ship the blocked automation. **LOOP** by selecting the **next unblocked** item: e.g. doc/parity, tooling, spec clarification, Track A prep scripts, or a **prep** slice that does not violate the blocker — or **STOP** only after recording **why** in this file under **RECORD — loop exit**. |
| **No work** left that fits repo rules | **STOP** with **RECORD — loop exit**: `reason`, `next_human_action`, `date`. |

### LOOP checklist (same session)

After **RECORD** for round *N*:

1. **BOOT** again (same four files + `git log -15`).  
2. **FIND** again — is there a **different** next item that is shippable today?  
3. If yes → **PLAN → BUILD → REVIEW → FIX → COMMIT → RECORD** (round *N+1*).  
4. If no → **RECORD — loop exit** (one short paragraph), then stop.  

**Stopping without a loop exit note is considered an incomplete run.**

---

## Git reference (recent)

Run: `git log -15 --oneline` — see commit history for reports UX, doc syncs, Track D segments.
