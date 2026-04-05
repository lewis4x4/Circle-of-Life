# Phase 1 — waiver log

**Authority:** Waivers require **owner**, **reason**, **expiry**, and **remediation issue** per `agents/registry.yaml` / [mission-statement.md](../mission-statement.md).

**Use:** Accepted gaps for Phase 1 milestone that are **not** implemented in this release.

---

## Approved waivers (2026-04-06)

| ID | Gap | Owner | Reason | Expiry | Remediation issue | Approved date |
|----|-----|-------|--------|--------|-------------------|---------------|
| W-RCA-01 | RCA workspace persists in **localStorage only**, not Postgres | Brian Lewis | Phase 1 milestone is daily ops + incident workflow; persisted RCA narrative deferred without blocking pilot | 2026-10-01 | Create tracking issue: persist `incident_rca` (or equivalent) to Postgres | 2026-04-06 |
| W-BILL-EF-01 | `16-billing.md` edge functions (cron invoice generation, AR aging automation) not deployed | Brian Lewis | Phase 1 acceptance checklist explicitly treats Edge Functions as non-blocking for UI sign-off; manual ops until scheduled jobs | 2026-10-01 | Backlog: deploy Edge Functions per spec when ops ready | 2026-04-06 |
| W-COLL-01 | Collection activities UI minimal or absent | Brian Lewis | Milestone scope is billing + payments paths; deepen collections UI when product prioritizes | 2026-10-01 | Backlog: collection_activities UX | 2026-04-06 |
| W-ADMIN-01 | Some admin pages list-heavy without create wizards | Brian Lewis | Milestone = run daily ops on seeded data; wizards added incrementally | 2026-10-01 | Per-module UX backlog | 2026-04-06 |

**Note:** Replace remediation **TBD** with real issue URLs when filed.

---

## Rejected / must-fix before closure

*(None — blockers for full Phase 1 product acceptance are tracked in [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md) and [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md), not in this waiver table.)*
