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

## FIND — next roadmap item (2026-04-10)

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

---

## LOOP — restart

1. **BOOT:** Re-read the four files in the table above + `git log`.  
2. **FIND:** Confirm **D85+** still blocked on clinical rules; confirm **121** still next migration unless a new file landed.  
3. **PLAN** the next **bounded** segment (spec-first).  
4. **BUILD** → **REVIEW** → **FIX** → **COMMIT** → **RECORD** here.  

---

## Git reference (recent)

Run: `git log -15 --oneline` — see commit history for reports UX, doc syncs, Track D segments.
