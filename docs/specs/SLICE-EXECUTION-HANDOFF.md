# Slice execution handoff — 18-slice build plan

**Created:** 2026-04-21
**Purpose:** Self-contained prompt so a fresh Claude session (any IDE) can pick up the 18-slice Haven build without re-explanation.

**How to resume:** open this file first. Everything needed is below or linked.

---

## The deal

Brian ordered an 18-slice build (S0 → S17) to extend Haven with a unified **Operations Cadence Engine (Module 27)**, a **Financial Close & Fiduciary Pack (Module 28)**, and a **Risk & Survey Command (Module 29)** — absorbing the 9 COL admin-log schemas (daily / weekly / monthly / quarterly / yearly / audits / collections / employee file / mental-health support plans) into one event-driven workflow engine.

Full architectural reasoning: `docs/specs/27-operations-cadence-engine.md` (to be authored in S1), `28-financial-close-fiduciary.md` (S8), `29-risk-survey-command.md` (S10).

**Build rhythm (non-negotiable, per owner):**
1. Plan slice → build → self-review → fix errors → commit + push to `main` → apply migrations + deploy Edge Functions → next slice.
2. One atomic commit per completed slice.
3. `npm run segment:gates -- --segment "<id>"` must produce a JSON artifact in `test-results/agent-gates/` before calling a slice done. Add `--ui` for visual/routing changes.

---

## The 18 slices (execute in order)

| # | Slice | Primary surface | Migration range |
|---|---|---|---|
| **S0** | Track A closeout (docs + gate) | docs only | none |
| **S1** | OCE core schema + `/admin/operations` Today view | new hub | 194–200 |
| **S2** | Weekly + Monthly templates + Missed/Overdue | same hub | 201–204 |
| **S3** | Quarterly + Yearly + Calendar view | same hub | 205–207 |
| **S4** | Event bus v1: referral → admit → collections → 1823 gate | cross-module | 208–215 |
| **S5** | Asset register + vendor bookings + maintenance templates | new hub | 216–220 |
| **S6** | Escalation ladders + SMS/voice (Twilio) | infra | 221–224 |
| **S7** | Shift-level granularity + pager view + staffing adequacy | mobile-first | 225–228 |
| **S8** | Module 28: trust reconciliation + month-end close | `/admin/finance/close`, `/admin/finance/trust` | 229–235 |
| **S9** | Module 28: DSO projection + cost-to-serve + capex | `/admin/finance/forecast` | 236–239 |
| **S10** | Module 29: nightly risk score + owner alerts | `/admin/risk` + SMS | 240–244 |
| **S11** | Module 29: AHCA survey-bundle + legal packets | `/admin/risk/survey-bundle` | 245–248 |
| **S12** | Module 29: league table + board pack + insurance-readiness | `/admin/executive/league` | 249–253 |
| **S13** | Offline PWA + service-worker sync for daily rounds | frontend infra | — |
| **S14** | CSV backfill + paper-equivalent PDF export | tooling | — |
| **S15** | AI layer: miss prediction + voice check-off + pattern detection | additive | 254–257 |
| **S16** | Template authoring UI | `/admin/operations/templates` | 258–260 |
| **S17** | Cross-operator benchmark stub | opt-in | 261–262 |

Migration numbers are **targets, not reservations** — allocate sequentially from whatever `npm run migrations:check` reports at the start of the slice (repo was at 193 as of 2026-04-21).

---

## Current state (2026-04-21)

### S0 — in progress, NOT fully complete

**Agent-complete:**
- `docs/specs/S0-CLOSEOUT-MEMO.md` — crystallized remaining owner-action items
- `docs/specs/PHASE1-ENV-CONFIRMATION.md` — bumped to 193 migrations, 27 Edge Function folders
- `docs/specs/PHASE1-WAIVER-LOG.md` — A6 review entry 2026-04-21
- `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md` — progress footer for 2026-04-21
- `docs/specs/PHASE1-RLS-VALIDATION-RECORD.md` — RLS-02 scope note (multi-facility seed + confirmed roster)

**Not yet produced (do on resume):**
- Gate artifact `s0-track-a-closeout.json` — `npm run segment:gates -- --segment "s0-track-a-closeout" --no-chaos --no-a11y`
  The gate was started but interrupted. Lint will FAIL (pre-existing 60 `no-explicit-any` errors across 56 committed files — documented in S0 memo as a finding, not S0's job to fix). Migration / secrets / env checks should PASS. Capture the JSON artifact; the honest FAIL on lint is part of the evidence.

**Owner-blocked (not agent work):**
- PH1-P06 / A5: Pro plan + BAA + PITR attestation on Supabase dashboard
- PH1-OA01 / A3: §B–§E depth UAT per `PHASE1-ACCEPTANCE-CHECKLIST.md`
- RLS-02: re-execute with multi-facility seed

### Uncommitted WIP — NOT S0

Files under `src/lib/resident-assurance/`, `src/app/(admin)/admin/rounding/escalations/`, `src/app/(admin)/admin/rounding/integrity/`, `src/app/api/rounding/escalations/`, `src/app/api/rounding/integrity-flags/`, and modifications to eight other files are **prior-session Module 25 WIP**. Do not commit them under any slice's umbrella. If those files must be committed, it needs its own commit from whoever owns that work.

---

## Non-negotiable rules (from `CLAUDE.md` / `AGENTS.md`)

1. **RLS first** — every new table gets RLS enabled + policies before data enters.
2. **Audit everything** — `haven_capture_audit_log` trigger on every clinical/financial table; `audit_log` has no UPDATE or DELETE policies.
3. **Soft deletes only** — `deleted_at timestamptz NULL`, queries filter `WHERE deleted_at IS NULL`.
4. **Money in cents** — `integer`, never `numeric` / `float` / `money`.
5. **UTC timestamptz** — frontend converts to America/New_York.
6. **UUID PKs** — `uuid DEFAULT gen_random_uuid()`.
7. **Denormalized `organization_id` + `facility_id`** — RLS filters org first, then `facility_id IN (SELECT haven.accessible_facility_ids())`.
8. **No secrets in code** — `.env.local` only.
9. **One slice = one atomic commit** — gate artifact required before marking done.
10. **Read COL Alignment Notes** in each spec before implementing.
11. **Never auto-create vendors** from legacy admin-log names without owner confirmation (memory: `vendor_creation_policy.md`). Current example: Chad Croft — preserve text, do not create vendor row.
12. **Resolve named individuals to roles** — Michelle Norris = COO; templates never hardcode users (memory: `col_executives.md`).

---

## Key COL facts (already in memory; restating for safety)

- **5 facilities, 258 beds**, all FL AHCA Ch. 429, America/New_York:
  - Oakridge ALF (Pine House, Inc.) — 52 beds — 94% — PILOT
  - Rising Oaks ALF (Smith & Sorensen LLC) — 52 beds — 94%
  - Homewood Lodge ALF (Sorensen, Smith & Bay, LLLC) — 36 beds — 94%
  - The Plantation on Summers — 64 beds — 98% — near-full, no admission headroom
  - Grande Cypress ALF — 54 beds — 80% — outlier, newest, census maturation gap
- **Insurance:** Policy NSC101045, National Fire & Marine Insurance Company (drives Module 29 insurance-readiness)
- **Form 1823** = legal ALF admission gate; enforced at DB level in S4
- **Medicaid MCOs:** FCC, Sunshine Health, Humana, WellCare, UHC
- **Baya** = external medication training partner
- **Michelle Norris** = COO; templates route `assignee_role='coo'` not her user id
- **Chad Croft** = unknown-to-owner vendor in legacy yearly log; flag as `vendor_match_pending`, do NOT auto-create

---

## Stack + tooling reminders

- Next.js App Router — **breaking changes** from training data; read `node_modules/next/dist/docs/` before writing Next-specific code.
- TypeScript strict, Tailwind, shadcn/ui, React Hook Form, Zustand, TanStack Query.
- Supabase project ref: `manfqmasfqppukpobpld` — MCP tools return 403 for this project in this account, so use the **Supabase CLI locally** (`supabase db push`, `supabase functions deploy <name>`). Link it first if needed.
- Package manager: **npm** for this repo (scripts in `package.json`). Personal CORE pref is bun, but this repo uses npm — follow the repo.
- Timezone handling: `date-fns-tz` with `America/New_York`.
- Gate runner: `node scripts/agent-gates/run-segment-gates.mjs --help` for flags. Use `SKIP_GITLEAKS=1` locally if gitleaks isn't installed.

---

## Pickup prompt (paste into a fresh Claude Code session in VSCode)

```
Open docs/specs/SLICE-EXECUTION-HANDOFF.md and follow it.

Resume the 18-slice build. Finish S0 by running the segment gate
(`npm run segment:gates -- --segment "s0-track-a-closeout" --no-chaos
--no-a11y`), commit the gate artifact to main, then start S1 —
Module 27 OCE core schema + /admin/operations Today view. Rhythm:
plan → build → review → fix → commit and push to main → apply
migrations and deploy Edge Functions → next slice. Do not commit
the pre-existing WIP files under src/lib/resident-assurance/ or
the rounding escalations / integrity directories — those belong
to a different workstream.

Respect every rule in AGENTS.md and CLAUDE.md. Write the Module 27
spec first (docs/specs/27-operations-cadence-engine.md) before
any migration. Seed templates from the 9 admin logs per the
architecture in this handoff. Use role-based assignment (Michelle
= COO, never hardcode users). Do not auto-create vendor records
for legacy names (Chad Croft stays pending).
```

---

## Why Brian is doing this elsewhere

Tool-call roundtrip overhead in this interface adds up over an 18-slice build (each slice involves dozens of tool calls — reads, writes, bash, gate runs, commits, migration applies). Claude Code inline in VSCode does the same work with tighter feedback loops. This handoff doc exists so that switch costs nothing.

---

## References (all paths relative to repo root)

- Mission & rules: `AGENTS.md`, `CLAUDE.md`
- Spec index: `docs/specs/README.md`
- Track A closeout: `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md`
- Phase 1 closure: `docs/specs/PHASE1-CLOSURE-RECORD.md`
- Engineer contract: `CODEX.md`
- Autonomous loop log: `docs/Autonomous.md`
- Gate runbook: `docs/agent-gates-runbook.md`
- Frontend contract: `docs/specs/FRONTEND-CONTRACT.md`
- S0 memo: `docs/specs/S0-CLOSEOUT-MEMO.md`
