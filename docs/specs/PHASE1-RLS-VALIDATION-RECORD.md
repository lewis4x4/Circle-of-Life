# Phase 1 — RLS validation record

**Purpose:** Prove **role-governed** access on the **target Supabase project** (not replaceable by repo review alone). See [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) § Backend review.

**Procedure:** [PHASE1-RLS-MANUAL-PROCEDURE.md](./PHASE1-RLS-MANUAL-PROCEDURE.md)

**Status (2026-04-09):** **PASS (owner sign-off, single-facility pilot)** — Brian Lewis attests that **RLS-01** and **RLS-03**–**RLS-07** were exercised on the **target** project with **anon key + real JWTs** per [PHASE1-RLS-MANUAL-PROCEDURE.md](./PHASE1-RLS-MANUAL-PROCEDURE.md). **RLS-02** remains **N/A** until a second in-org facility exists on target (explicit pilot scope acceptance).

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

- [x] Use **non-service-role** clients (anon key + user session) per role — **owner attestation (2026-04-09)**.
- [x] Single-facility pilot scope selected for current target; document cross-facility scenarios that cannot yet be executed.
- [x] Test users: `owner` or `org_admin` or `facility_admin`; `caregiver`/`nurse` with one facility; `family` linked to one resident only. **2026-04-09:** Owner verified email/password sign-in for Oakridge demo users (see [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)); **2026-04-06** JWT failure note is **superseded** for current target.
- [ ] Optional: Supabase **policy tests** or SQL executed as `SET request.jwt.claims` / `auth.uid()` in controlled harness (project-specific).
- [x] Seed ids / probes — satisfied for single-facility pilot per owner execution (see scenario table).
- [x] Results recorded in this document — **2026-04-09** sign-off.

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
| RLS-01 | Caregiver queries `residents` / `daily_logs` | Only rows for **accessible facilities** | **PASS** | Brian Lewis (owner) | 2026-04-09 | Owner attestation: live JWT probes on target; no cross-facility leakage observed for Oakridge caregiver scope |
| RLS-02 | Caregiver cannot read resident in **other** facility | 0 rows or RLS error | **RE-EXECUTE PENDING (2026-04-21)** | — | — | Deferral no longer applies: migration `120` seeded multi-facility demo data (facilities `002–005`), and all 5 real COL facilities are now confirmed via insurance policy NSC101045. Owner/tester: re-run RLS-02 per [PHASE1-RLS-MANUAL-PROCEDURE.md](./PHASE1-RLS-MANUAL-PROCEDURE.md). |
| RLS-03 | Family user queries clinical/financial tables | Only **linked** resident(s) per `family_resident_links` | **PASS** | Brian Lewis (owner) | 2026-04-09 | Owner attestation: family session scoped to linked resident data only |
| RLS-04 | Family cannot access **unlinked** resident | No row leakage | **PASS** | Brian Lewis (owner) | 2026-04-09 | Owner attestation: unlinked resident id probe returned no row / denial |
| RLS-05 | Admin (`facility_admin`) scope | Org + selected facility rules per policies | **PASS** | Brian Lewis (owner) | 2026-04-09 | Owner attestation: `facility_admin` + table/UI probes within expected org/facility scope |
| RLS-06 | `invoices` / `payments` (billing) | No cross-org; facility/entity rules per migrations | **PASS** | Brian Lewis (owner) | 2026-04-09 | Owner attestation: billing reads consistent with role scope |
| RLS-07 | Write attempts (caregiver) to out-of-scope `INSERT`/`UPDATE` | Denied by RLS | **PASS** | Brian Lewis (owner) | 2026-04-09 | Owner attestation: out-of-scope write not committed / denied |

---

## Pass / fail rule

- Mark a row **PASS** when the tester exercised the scenario with a live JWT session and captured evidence — **or** when the **owner** signs off on pilot-scope attestation per procedure (single-facility **RLS-02** deferral documented).
- Mark a row **FAIL** if any out-of-scope row is visible or if an out-of-scope write succeeds.
- Leave **RLS-02** as deferred only while the target remains single-facility. **N/A** is not **PASS**; overall **PASS** requires signer acceptance of that deferral (recorded above).
- Overall **PASS** requires all applicable rows **PASS** or **N/A (accepted)**.

---

## Overall RLS validation verdict

| Verdict | Date | Signer |
|---------|------|--------|
| **FAIL** | 2026-04-06 | Agent (live probe) — superseded: no JWTs that day |
| **PASS (single-facility pilot)** | 2026-04-09 | Brian Lewis (owner) |

**2026-04-09:** Owner sign-off for **Oakridge single-facility** target. **RLS-02** (cross-facility read blocked) **deferred** until a second facility exists on target; re-run when multi-facility data is available.

---

## Notes

- Helpers live in schema **`haven`** (`haven.organization_id()`, `haven.accessible_facility_ids()`, `haven.app_role()`) — see migrations `004_haven_rls_helpers.sql` and table-specific policies.
- **Remote migrations:** repo **001–120** (reconciled **2026-04-10**; [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md)). Include **finance** tables when re-validating after major billing migrations.
- **Canonical auth check:** `npm run demo:auth-check` — if pilot login fails, pause RLS re-validation until [PHASE1-AUTH-DEBUG-HANDOFF.md](./PHASE1-AUTH-DEBUG-HANDOFF.md) is closed again.
- **Scope:** **Single-facility** pilot PASS recorded **2026-04-09**. **Re-execute RLS-02** when a second in-org facility is on target.
- Mission alignment should return **fail** if any role can see out-of-scope clinical or billing data after this sign-off; treat regressions as incidents.
