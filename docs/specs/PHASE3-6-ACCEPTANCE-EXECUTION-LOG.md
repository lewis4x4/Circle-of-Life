# Phases 3–6 — acceptance execution log

**Use:** Record **PASS** / **FAIL** / **N/A** for each checklist when executing on the **target environment** (production Supabase project + deployed app) with **real auth**.

**Rule:** A repo agent cannot set PASS without owner (or delegated tester) execution on that environment.

**Checklists:**

- [PHASE3-ACCEPTANCE-CHECKLIST.md](./PHASE3-ACCEPTANCE-CHECKLIST.md)
- [PHASE35-ACCEPTANCE-CHECKLIST.md](./PHASE35-ACCEPTANCE-CHECKLIST.md)
- [PHASE4-ACCEPTANCE-CHECKLIST.md](./PHASE4-ACCEPTANCE-CHECKLIST.md)
- [PHASE5-ACCEPTANCE-CHECKLIST.md](./PHASE5-ACCEPTANCE-CHECKLIST.md)
- [PHASE6-ACCEPTANCE-CHECKLIST.md](./PHASE6-ACCEPTANCE-CHECKLIST.md)

**Prerequisites:** Remote migrations **`001`–`120`** aligned ([PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md)); Edge Functions deployed per [supabase/functions/README.md](../../supabase/functions/README.md); **`NEXT_PUBLIC_DEMO_MODE` unset** for honest UAT unless explicitly testing demo UI.

---

## Protocol

1. Complete **Track A** depth UAT ([PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md) §B–§E) before claiming org-wide acceptance — Phase 3–6 proof builds on a trusted pilot baseline.
2. Walk each phase checklist in order; for each row, capture route, role, facility, and evidence (screenshot or Supabase row id).
3. Mark **N/A** only when pilot data truly cannot trigger the row (document why).
4. Update the **Sign-off** table in each checklist file when the phase is complete.

---

## Execution summary

| Phase | Checklist | Result | Tester | Date | Notes |
|-------|-----------|--------|--------|------|-------|
| 3 | PHASE3-ACCEPTANCE-CHECKLIST.md | PENDING | | | |
| 3.5 | PHASE35-ACCEPTANCE-CHECKLIST.md | PENDING | | | |
| 4 | PHASE4-ACCEPTANCE-CHECKLIST.md | PENDING | | | |
| 5 | PHASE5-ACCEPTANCE-CHECKLIST.md | PENDING | | | |
| 6 | PHASE6-ACCEPTANCE-CHECKLIST.md | PENDING | | | |

---

## Automated / repo baseline (agent)

| Check | Command | Last run |
|-------|---------|----------|
| Migrations | `npm run migrations:check` | **PASS** 2026-04-10 |
| Lint | `npm run lint` | **PASS** 2026-04-10 |
| Build | `npm run build` | **PASS** 2026-04-10 |
| Segment gates | `npm run segment:gates -- --segment "phase-2-6-acceptance-closeout" --ui --no-chaos` | **PASS** — `test-results/agent-gates/2026-04-10T14-38-35-018Z-phase-2-6-acceptance-closeout.json` |

**Owner checklist UAT** (summary table above) remains **PENDING** until each phase checklist is walked on the pilot with evidence — this does not replace §B–§E in [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md).
