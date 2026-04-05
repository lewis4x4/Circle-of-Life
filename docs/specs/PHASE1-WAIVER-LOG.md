# Phase 1 — waiver log

**Authority:** Waivers require **owner**, **reason**, **expiry**, and **remediation issue** per `agents/registry.yaml` / [mission-statement.md](../mission-statement.md).

**Use:** Accepted gaps for Phase 1 milestone that are **not** implemented in this release.

---

## Remediated (was waived — now implemented in repo)

| ID | Former gap | Proof / reference | Remediated |
|----|------------|-------------------|------------|
| **W-RCA-01** | RCA only in localStorage | Migration `070_incident_rca.sql`; `/admin/incidents/[id]/rca` loads/saves `incident_rca`; gate artifact `test-results/agent-gates/*phase1-rca-persistence*` | 2026-04-06 |
| **W-COLL-01** | No collections UX | `/admin/billing/collections`, `/admin/billing/collections/new`; `collection_activities` inserts; gate `*phase1-collections-ui*` | 2026-04-06 |
| **W-BILL-EF-01** | No deployed billing Edge jobs | `generate-monthly-invoices` Edge Function + `supabase/functions/README.md` (per-facility cron, idempotency via migration `071`); **AR aging** automation still backlog if spec requires full parity | 2026-04-06 |

---

## Active waivers

| ID | Gap | Owner | Reason | Expiry | Remediation issue | Approved date |
|----|-----|-------|--------|--------|-------------------|---------------|
| W-ADMIN-01 | Some admin pages list-heavy without create wizards | Brian Lewis | Milestone = run daily ops on seeded data; wizards added incrementally | 2026-10-01 | Per-module UX backlog | 2026-04-06 |

**Note:** Replace remediation **TBD** with real issue URLs when filed.

---

## Rejected / must-fix before closure

*(None — blockers for full Phase 1 product acceptance are tracked in [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md) and [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md), not in this waiver table.)*
