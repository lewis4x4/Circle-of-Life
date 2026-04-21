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
| W-ADMIN-01 | Some admin pages list-heavy without create wizards | Brian Lewis | Milestone = run daily ops on seeded data; wizards added incrementally | 2026-10-01 | Completion remediation queue — Workflow Hardening / Phase 6 Completion Pass in `docs/specs/README.md`; **partial:** `/admin/residents/new`, `/admin/staff/new`, `/admin/schedules/new`, `/admin/certifications/new`, `/admin/staffing/new` (migration `072`), `/admin/time-records/new` (migration `073`), `/admin/billing/rates/new` (`rate_schedules` insert via existing RLS); other modules remain | 2026-04-06 |

**Note:** Replace remediation **TBD** with real issue URLs when filed.

**A6 review (2026-04-10):** **W-ADMIN-01** remains **valid** — list-first vs wizard coverage is still mixed across modules; expiry **2026-10-01** unchanged. No additional waivers opened; remediated table above unchanged.

**A6 review (2026-04-21, S0 closeout):** **W-ADMIN-01** remains **valid** and unchanged (expiry **2026-10-01**). No new waivers opened. Note for tracker continuity: post-2026-04-10 work delivered **73 additional migrations (121–193)** and **17 additional Edge Function folders**; none introduced new Phase 1 waivers. S0 closeout memo: [S0-CLOSEOUT-MEMO.md](./S0-CLOSEOUT-MEMO.md).

---

## Roadmap linkage

Active waivers are not free-floating backlog. They must map to the **Completion remediation tracks** in [README.md](./README.md):

1. Phase 1 acceptance closeout
2. Platform hardening
3. Workflow hardening
4. Phase 6 completion pass

`W-ADMIN-01` currently belongs to the **Workflow hardening** queue and the **Phase 6 completion pass** for list-first modules that still need operator-grade create/edit flows.

---

## Rejected / must-fix before closure

*(None — blockers for full Phase 1 product acceptance are tracked in [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md) and [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md), not in this waiver table.)*
