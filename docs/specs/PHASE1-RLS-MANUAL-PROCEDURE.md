# Phase 1 — RLS manual validation procedure

**Purpose:** Execute [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md) scenarios **RLS-01–07** on the **target** Supabase project using **real JWTs** (anon key + user session). **Do not** use the service role key for these read tests.

**Why automated repo review is insufficient:** Policies depend on `auth.uid()`, `haven.app_role()`, and `haven.accessible_facility_ids()`; only a logged-in client proves enforcement.

---

## Setup

1. Three test accounts (or equivalent): **caregiver** scoped to facility A; **second caregiver or admin** for facility B (same org if testing cross-facility); **family** linked to one resident only.
2. Supabase client in browser devtools or small script: `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)` + `signInWithPassword`.
3. Optional: SQL Editor runs as **postgres** bypass RLS — use only to inspect data, not to assert policy behavior.
4. Pre-identify ids you will probe:
   - one resident in caregiver/family scope
   - one invoice or payment tied to that resident
   - one out-of-scope resident if a second facility exists

### Minimal browser/script harness

Use any equivalent client, but keep it **anon key + real session**:

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

await supabase.auth.signInWithPassword({ email, password });
```

### Single-facility pilot variant

If the target environment currently has only one facility in the pilot scope:

- Execute all same-facility scenarios (`RLS-01`, `RLS-03`, `RLS-04`, `RLS-05`, `RLS-06`, `RLS-07`) with real JWT sessions.
- Mark `RLS-02` as **N/A until second facility exists on target** and record that limitation in [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md).
- Do **not** convert **Overall RLS validation verdict** to **PASS** unless the signer explicitly accepts single-facility scope as sufficient for the current pilot or completes cross-facility validation later.

---

## Scenarios (map to RLS-01–07)

### RLS-01 — Caregiver reads `residents` / `daily_logs`

- Sign in as caregiver (facility A).
- Run:
  - `supabase.from("residents").select("id, facility_id").limit(20)`
  - `supabase.from("daily_logs").select("id, resident_id").limit(20)`
- Expect only residents whose facility is in the caregiver accessible set.
- Record returned ids in the validation record.

### RLS-02 — Cross-facility read blocked

- Obtain a `resident.id` that belongs to **facility B** (not in caregiver A’s access).
- As caregiver A run:
  - `supabase.from("residents").select("id, facility_id").eq("id", otherFacilityResidentId).maybeSingle()`
- Expect **empty** or error, not a row.
- If no second facility exists in the target pilot, record **N/A until second facility exists on target** instead of fabricating the scenario.

### RLS-03 / RLS-04 — Family scope

- Sign in as family user linked to resident R1.
- Run:
  - `supabase.from("residents").select("id").limit(20)`
  - `supabase.from("daily_logs").select("id, resident_id").limit(20)`
  - `supabase.from("invoices").select("id, resident_id").limit(20)`
- Expect only R1 and directly linked data.
- Attempt direct probe:
  - `supabase.from("residents").select("id").eq("id", unlinkedResidentId).maybeSingle()`
- Expect **no row**.

### RLS-05 — `facility_admin` (or admin) scope

- Sign in as `facility_admin`; confirm lists respect selected facility / org per product rules.
- Prefer one direct table probe plus one UI check:
  - `supabase.from("residents").select("id, facility_id").limit(20)`
  - open `/admin/residents` and confirm list matches expected facility scope
- Record which role was used.

### RLS-06 — Billing `invoices` / `payments`

- As roles above, confirm no rows outside `organization_id` / entity rules (see migrations `027`–`029`).
- Run:
  - `supabase.from("invoices").select("id, resident_id, organization_id").limit(20)`
  - `supabase.from("payments").select("id, resident_id, organization_id").limit(20)`
- For family, expect only linked resident billing.
- For caregiver, expect no cross-facility leakage.
- For admin, expect org-allowed scope only.

### RLS-07 — Out-of-scope write denied

- As caregiver A attempt:
  - `supabase.from("daily_logs").insert({ resident_id: otherFacilityResidentId, /* minimal required fields */ })`
- If insert is blocked by constraints before RLS, note that in evidence and retry with a payload that satisfies non-RLS requirements.
- Expected outcome: **RLS violation** or **no write committed**.

---

## Recording results

Fill **Result**, **Tester**, **Date**, and **Evidence** (screenshot, query log, or short video) in [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md).

For every executed row, record:

- role used
- exact id(s) probed
- whether result was row / empty / error
- evidence filename or copied console output

Set **Overall RLS validation verdict** to **PASS** only when all applicable scenarios pass for the **remote** database state (remote is currently aligned through **092**). If using single-facility pilot scope, explicitly note whether cross-facility validation remains deferred.

## Stop conditions

- Stop immediately and mark **FAIL** if any out-of-scope resident, daily log, invoice, or payment is visible.
- Stop immediately and mark **FAIL** if an out-of-scope write succeeds.
- If auth/session behavior is ambiguous, do not guess; capture evidence and leave the scenario unresolved until reproduced cleanly.
