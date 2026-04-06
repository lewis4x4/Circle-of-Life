# Phase 1 — RLS validation record

**Purpose:** Prove **role-governed** access on the **target Supabase project** (not replaceable by repo review alone). See [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) § Backend review.

**Procedure:** [PHASE1-RLS-MANUAL-PROCEDURE.md](./PHASE1-RLS-MANUAL-PROCEDURE.md)

**Status (2026-04-06):** **PREPARED, NOT EXECUTED** — this agent updated the validation packet for a **single-facility pilot** and current remote migration state, but scenarios **RLS-01–07** still require **owner or delegated tester** with real JWT sessions. This session did **not** run live queries against production identities.

---

## Live JWT execution packet

Use this record as the **authoritative results sheet** for live RLS testing on the target Supabase project.

### Required tester set

| Role/session | Purpose |
|--------------|---------|
| `caregiver` or `nurse` | Validate facility-scoped clinical access and denied out-of-scope writes |
| `family` | Validate resident-link restrictions |
| `facility_admin` or `org_admin` | Validate broader admin read scope without cross-org leakage |

### Evidence required for every executed scenario

- user email or tester alias
- role used
- facility context / resident id referenced
- query or UI action performed
- result shape: returned rows, empty set, or explicit RLS error
- screenshot, copied console output, or short video reference

### Execution order

1. Confirm preconditions below
2. Run `RLS-01`
3. Run `RLS-03` and `RLS-04`
4. Run `RLS-05`
5. Run `RLS-06`
6. Run `RLS-07`
7. Run `RLS-02` if a second facility exists on target; otherwise keep it marked deferred
8. Set overall verdict only after all applicable rows contain evidence

---

## Preconditions for testing

- [ ] Use **non-service-role** clients (anon key + user session) per role.
- [x] Single-facility pilot scope selected for current target; document cross-facility scenarios that cannot yet be executed.
- [ ] Test users: `owner` or `org_admin` or `facility_admin`; `caregiver`/`nurse` with one facility; `family` linked to one resident only. Live sign-in attempts on 2026-04-06 failed before JWT issuance first for `.demo` addresses, then again after normalization to `jessica@circleoflifealf.com`, `maria.garcia@circleoflifealf.com`, and `robert.sullivan@circleoflifealf.com`, all with `unexpected_failure` / `Database error querying schema`.
- [ ] Optional: Supabase **policy tests** or SQL executed as `SET request.jwt.claims` / `auth.uid()` in controlled harness (project-specific).
- [ ] Identify concrete seed ids before starting: one in-scope resident, one family-linked resident, one invoice/payment tied to the same resident, and one out-of-scope resident if a second facility exists.
- [ ] Confirm tester will record evidence inline in this document or in a named artifact bundle.

---

## Execution attempt — 2026-04-06

Live RLS execution was attempted against `https://manfqmasfqppukpobpld.supabase.co` using the anon key from `.env.local` and the Oakridge demo password `HavenDemo2026!`.

| Role target | Email used | Live result | Evidence |
|-------------|------------|-------------|----------|
| `facility_admin` | `jessica@circleoflifealf.com` | **FAIL before session creation** | `auth/v1/token?grant_type=password` returned `unexpected_failure` / `Database error querying schema` after auth seed repair migrations `093` and `094` |
| `caregiver` | `maria.garcia@circleoflifealf.com` | **FAIL before session creation** | Supabase Auth API returned `unexpected_failure` / `Database error querying schema`; local `/login` UI showed the same error |
| `family` | `robert.sullivan@circleoflifealf.com` | **FAIL before session creation** | `auth/v1/token?grant_type=password` returned `unexpected_failure` / `Database error querying schema` after normalized email remediation |

Because no real JWT session could be established for the required roles, scenarios `RLS-01` through `RLS-07` could not be executed on the target project during this run. Repo remediation status: migrations `093_backfill_oakridge_demo_auth_users.sql`, `094_normalize_oakridge_demo_emails.sql`, and `095_restore_default_auth_instance.sql` are all applied remotely, but auth still returns `Database error querying schema`.

---

## Required scenarios (minimum)

| # | Scenario | Expected | Result | Tester | Date | Evidence |
|---|----------|----------|--------|--------|------|----------|
| RLS-01 | Caregiver queries `residents` / `daily_logs` | Only rows for **accessible facilities** | **PENDING** | | | Record resident ids returned and confirm same facility only |
| RLS-02 | Caregiver cannot read resident in **other** facility | 0 rows or RLS error | **N/A until second facility exists on target** | | | Single-facility pilot chosen for current run; execute when second in-org facility is available |
| RLS-03 | Family user queries clinical/financial tables | Only **linked** resident(s) per `family_resident_links` | **PENDING** | | | Capture linked resident id and one allowed query result |
| RLS-04 | Family cannot access **unlinked** resident | No row leakage | **PENDING** | | | Capture direct-id probe result showing empty set or denial |
| RLS-05 | Admin (`facility_admin`) scope | Org + selected facility rules per policies | **PENDING** | | | Note role used and whether facility switcher or direct query respects scope |
| RLS-06 | `invoices` / `payments` (billing) | No cross-org; facility/entity rules per migrations | **PENDING** | | | Capture one allowed record and one denied or empty probe where possible |
| RLS-07 | Write attempts (caregiver) to out-of-scope `INSERT`/`UPDATE` | Denied by RLS | **PENDING** | | | Capture exact error or 0-row write result |

---

## Pass / fail rule

- Mark a row **PASS** only when the tester exercised the scenario with a live JWT session and captured evidence.
- Mark a row **FAIL** if any out-of-scope row is visible or if an out-of-scope write succeeds.
- Leave **RLS-02** as deferred only while the target remains single-facility. Do not silently treat it as passed.
- Do not set the overall verdict to **PASS** while an executed scenario lacks evidence.

---

## Overall RLS validation verdict

| Verdict | Date | Signer |
|---------|------|--------|
| **FAIL** | 2026-04-06 | Agent (live probe) |

Current failure reason: target Supabase Auth did not issue user JWTs for the seeded admin/caregiver/family identities, so live RLS enforcement could not be exercised. This blocks Phase 1 full acceptance until remediated.

---

## Notes

- Helpers live in schema **`haven`** (`haven.organization_id()`, `haven.accessible_facility_ids()`, `haven.app_role()`) — see migrations `004_haven_rls_helpers.sql` and table-specific policies.
- **Remote migrations:** **001–092** aligned on 2026-04-06 ([PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md)). Include **finance** tables in RLS tests if validating Module 17 on this project.
- **Current scope choice:** docs-only preparation + **single-facility** pilot. The owner/delegated tester still must sign in with non-service-role sessions and record evidence before this document can move from **PENDING** to **PASS**.
- Mission alignment on completion should remain `risk` or `fail` if any role can see out-of-scope clinical or billing data.
