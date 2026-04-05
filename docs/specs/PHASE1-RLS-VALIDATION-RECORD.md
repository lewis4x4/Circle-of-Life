# Phase 1 — RLS validation record

**Purpose:** Prove **role-governed** access on the **target Supabase project** (not replaceable by repo review alone). See [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) § Backend review.

**Procedure:** [PHASE1-RLS-MANUAL-PROCEDURE.md](./PHASE1-RLS-MANUAL-PROCEDURE.md)

**Status (2026-04-06):** **NOT EXECUTED** — scenarios **RLS-01–07** require **owner or delegated tester** with real JWT sessions. This agent session did **not** run live queries against production identities.

---

## Preconditions for testing

- [ ] Use **non-service-role** clients (anon key + user session) per role.
- [ ] Two facilities in same org where isolation must hold (or document single-facility pilot).
- [ ] Test users: `owner` or `org_admin` or `facility_admin`; `caregiver`/`nurse` with one facility; `family` linked to one resident only.
- [ ] Optional: Supabase **policy tests** or SQL executed as `SET request.jwt.claims` / `auth.uid()` in controlled harness (project-specific).

---

## Required scenarios (minimum)

| # | Scenario | Expected | Result | Tester | Date | Evidence |
|---|----------|----------|--------|--------|------|----------|
| RLS-01 | Caregiver queries `residents` / `daily_logs` | Only rows for **accessible facilities** | **PENDING** | | | |
| RLS-02 | Caregiver cannot read resident in **other** facility | 0 rows or RLS error | **PENDING** | | | |
| RLS-03 | Family user queries clinical/financial tables | Only **linked** resident(s) per `family_resident_links` | **PENDING** | | | |
| RLS-04 | Family cannot access **unlinked** resident | No row leakage | **PENDING** | | | |
| RLS-05 | Admin (`facility_admin`) scope | Org + selected facility rules per policies | **PENDING** | | | |
| RLS-06 | `invoices` / `payments` (billing) | No cross-org; facility/entity rules per migrations | **PENDING** | | | |
| RLS-07 | Write attempts (caregiver) to out-of-scope `INSERT`/`UPDATE` | Denied by RLS | **PENDING** | | | |

---

## Overall RLS validation verdict

| Verdict | Date | Signer |
|---------|------|--------|
| **PENDING** | 2026-04-06 | — |

When complete, set to **PASS** or **FAIL** (FAIL blocks Phase 1 full acceptance until remediated).

---

## Notes

- Helpers live in schema **`haven`** (`haven.organization_id()`, `haven.accessible_facility_ids()`, `haven.app_role()`) — see migrations `004_haven_rls_helpers.sql` and table-specific policies.
- **Remote migrations:** **040–041** deployed 2026-04-06 ([PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md)). Include **finance** tables in RLS tests if validating Module 17 on this project.
