# Phase 1 — RLS validation record

**Purpose:** Prove **role-governed** access on the **target Supabase project** (not replaceable by repo review alone). See [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) § Backend review.

**Status (2026-04-05):** **NOT EXECUTED** — scenarios below are **PENDING** until tested with real JWTs / Supabase clients per role.

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
| RLS-01 | Caregiver queries `residents` / `daily_logs` | Only rows for **accessible facilities** | PENDING | | | |
| RLS-02 | Caregiver cannot read resident in **other** facility | 0 rows or RLS error | PENDING | | | |
| RLS-03 | Family user queries clinical/financial tables | Only **linked** resident(s) per `family_resident_links` | PENDING | | | |
| RLS-04 | Family cannot access **unlinked** resident | No row leakage | PENDING | | | |
| RLS-05 | Admin (`facility_admin`) scope | Org + selected facility rules per policies | PENDING | | | |
| RLS-06 | `invoices` / `payments` (billing) | No cross-org; facility/entity rules per migrations | PENDING | | | |
| RLS-07 | Write attempts (caregiver) to out-of-scope `INSERT`/`UPDATE` | Denied by RLS | PENDING | | | |

---

## Overall RLS validation verdict

| Verdict | Date | Signer |
|---------|------|--------|
| **PENDING** | 2026-04-05 | — |

When complete, set to **PASS** or **FAIL** (FAIL blocks Phase 1 full acceptance until remediated).

---

## Notes

- Helpers live in schema **`haven`** (`haven.organization_id()`, `haven.accessible_facility_ids()`, `haven.app_role()`) — see migrations `004_haven_rls_helpers.sql` and table-specific policies.
- Phase 1 scope tables: through **`16-billing`** migrations; later migrations add Phase 2/3 tables — include in matrix if those routes are in scope for “Phase 1 app” on the same project.
