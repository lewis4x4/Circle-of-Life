# Phase 1 — RLS manual validation procedure

**Purpose:** Execute [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md) scenarios **RLS-01–07** on the **target** Supabase project using **real JWTs** (anon key + user session). **Do not** use the service role key for these read tests.

**Why automated repo review is insufficient:** Policies depend on `auth.uid()`, `haven.app_role()`, and `haven.accessible_facility_ids()`; only a logged-in client proves enforcement.

---

## Setup

1. Three test accounts (or equivalent): **caregiver** scoped to facility A; **second caregiver or admin** for facility B (same org if testing cross-facility); **family** linked to one resident only.
2. Supabase client in browser devtools or small script: `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)` + `signInWithPassword`.
3. Optional: SQL Editor runs as **postgres** bypass RLS — use only to inspect data, not to assert policy behavior.

---

## Scenarios (map to RLS-01–07)

### RLS-01 — Caregiver reads `residents` / `daily_logs`

- Sign in as caregiver (facility A).
- `select('id').from('residents').limit(20)` — expect only residents whose facility is in accessible set.
- `from('daily_logs').select('id').limit(20)` — same.

### RLS-02 — Cross-facility read blocked

- Obtain a `resident.id` that belongs to **facility B** (not in caregiver A’s access).
- As caregiver A: `.from('residents').select('*').eq('id', otherFacilityResidentId).maybeSingle()` — expect **empty** or error, not a row.

### RLS-03 / RLS-04 — Family scope

- Sign in as family user linked to resident R1.
- Query `residents`, `daily_logs`, `invoices` (as permitted by app) — only R1 (and linked data).
- Attempt to read another resident’s id by direct `eq('id', …)` — **no row**.

### RLS-05 — `facility_admin` (or admin) scope

- Sign in as `facility_admin`; confirm lists respect selected facility / org per product rules.

### RLS-06 — Billing `invoices` / `payments`

- As roles above, confirm no rows outside `organization_id` / entity rules (see migrations `027`–`029`).

### RLS-07 — Out-of-scope write denied

- As caregiver A: attempt `insert` into `daily_logs` with `resident_id` from facility B — expect **RLS violation** or 0 rows affected.

---

## Recording results

Fill **Result**, **Tester**, **Date**, and **Evidence** (screenshot, query log, or short video) in [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md).

Set **Overall RLS validation verdict** to **PASS** only when all applicable scenarios pass for the **remote** database state (note: remote must include migrations through **039** minimum for Phase 1 tables; apply **040–041** if testing finance RLS).
