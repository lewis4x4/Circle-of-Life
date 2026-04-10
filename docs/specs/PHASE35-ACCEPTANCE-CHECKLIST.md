# Phase 3.5 acceptance checklist (platform hardening `050`–`069`)

**Authority:** [README.md](./README.md) § Phase 3.5 — additive migrations **`050`–`069`** (foundation remediation, search, push, PWA/offline, regulatory columns, AI invocation framework, RLS tightenings).

**How to use:** Each row ties **migration applied on target** + **feature behavior verified** in the app or API. Record PASS/FAIL/N/A, tester, date, notes.

**Pilot:** Oakridge ALF; some rows are **org-wide** or **infrastructure** (no facility picker).

---

## Mission alignment

| Verdict | Record when |
|---------|----------------|
| **pass** | Applicable rows PASS; N/A documented where pilot lacks trigger data |
| **risk** | PASS with ops-only follow-ups (e.g. cron not registered in prod yet) — cite [TRACK-C-WORKFLOW-HARDENING.md](./TRACK-C-WORKFLOW-HARDENING.md) |
| **fail** | Migration missing on target or security chokepoint broken (e.g. `068` PHI rejection) |

---

## Row map (migration + proof)

| # | Migration / theme | Pass? | What to verify |
|---|---------------------|-------|------------------|
| 1 | **050** — Foundation / regulatory columns | | Columns present per `00-foundation-regulatory.md`; UI or SQL proof |
| 2 | **051** — Platform search (if applicable segment) | | Search route / RPC returns scoped results |
| 3 | **052** — Push / notifications plumbing | | VAPID + dispatch path documented; optional: test push in non-prod |
| 4 | **053** — PWA / offline contract | | Service worker / offline behavior per `pwa-caching-contract.md` where implemented |
| 5 | **054**–**059** — (per README 3.5-B–E segments) | | Match each applied migration to spec row in README |
| 6 | **060**–**064** — Integration / audit / daily ops remediation | | `063` queue + HL7 path aligned with Module 22 |
| 7 | **065** — Finance intercompany | | `intercompany_markers` on `journal_lines`; journal UI or query |
| 8 | **066** — Insurance OSHA / allocation | | Premium allocation / OSHA fields visible in insurance UI or export |
| 9 | **067** — Vendor match / storage / scorecard | | Bucket `vendor-documents` if used; match rules or scorecard signals |
| 10 | **068** — `ai_invocations` + **PHI gate** | | **REJECT** path when `phi_class=phi` and BAA flag unset (see spec) |
| 11 | **069** — `shift_swap_requests` RLS tighten | | Non-privileged staff cannot see others' pending swaps incorrectly — [PHASE1-ACCEPTANCE-REPORT.md](../PHASE1-ACCEPTANCE-REPORT.md) Gap R-3 |
| 12 | **Meta** | | Owner sign-off when 1–11 complete or waived |

**README cross-reference:** Full segment names and DDL pointers live in [README.md](./README.md) § *Phase 3.5* (tables 3.5-A through 3.5-G). Adjust row titles to match your deployed subset if not all migrations apply to a given fork.

---

## Deferred / Enhanced

- Full **offline clinical capture** depth — `04-daily-operations-offline.md` may remain STUB; acceptance is **what shipped** in migrations `050`–`053`, not a future full offline suite.

---

## Sign-off

| Field | Value |
|-------|--------|
| **Result** | PENDING |
| **Date** | |
| **Tester** | |
