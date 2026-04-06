# Demo Seed Runbook

Purpose: provide management-demo data that is deterministic, repeatable, and fully reversible.

## Scope model

- Demo data is isolated to one deterministic workspace:
  - `organization_id = 11111111-1111-1111-1111-111111111111`
- Seed scripts never mutate non-demo organizations.
- Reset script removes all demo rows in dependency-safe order.

## Commands

```bash
npm run demo:auth-check
npm run demo:auth-smoke
npm run demo:seed
npm run demo:reset
npm run demo:reseed
```

## Required environment

- `SUPABASE_SERVICE_ROLE_KEY` (required)
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` (required)

Optional:

- `PHASE1_DEMO_PASSWORD` — overrides the default pilot password (`HavenDemo2026!`) used by `demo:auth-check`.
- `DEMO_ACTOR_USER_ID` — required only for auth-linked rows like incidents (`reported_by`) and clinical activity actor references.
- `DEMO_FAMILY_USER_ID` — required only when seeding family access links and family profile rows.

If optional IDs are missing, those auth-linked demo rows are skipped while core workspace/facility/resident/billing rows are still seeded.

## Auth diagnostics

- `demo:auth-check` is the canonical Track A auth probe.
- `demo:auth-smoke` is the canonical local app smoke for Phase 1 `PH1-A02` and `PH1-A03`.
- It reads `.env.local` when shell env vars are not already exported.
- It checks:
  - `auth/v1/settings`
  - password login for current pilot addresses (`@circleoflifealf.com`)
  - password login for legacy seed addresses (`.demo` / `.family.demo`)
- If `SUPABASE_SERVICE_ROLE_KEY` is present, it also lists matching auth users through the Admin API for comparison.
- `demo:auth-smoke` expects the app to already be running at `BASE_URL` (defaults to `http://127.0.0.1:3000`) and uses Playwright to verify:
  - logged-out `/admin/residents` redirects to `/login?next=%2Fadmin%2Fresidents`
  - invalid credentials show `Invalid login credentials`

## Included seed domains

- Foundation hierarchy: organization, entity, facility, units, rooms, beds
- Resident census records and bed occupancy
- Staff roster
- Billing baseline: rate schedule, resident payers, invoices, line items, payments
- Incidents + follow-up (only when `DEMO_ACTOR_USER_ID` is set)
- User profile/facility links/family links (only when optional user IDs are set)

## Reset behavior

- `demo:reset`:
  - clears cyclic bed occupancy pointer first
  - deletes demo rows from child tables up through organizations
  - deletes facility-scoped sequences (`incident_sequences`, `invoice_sequences`)
  - leaves non-demo data untouched

## Operator workflow

For every major demo checkpoint:

1. `npm run demo:reseed`
2. Run app + gates/demo scripts
3. Present

After demo:

1. `npm run demo:reset`
2. Verify no rows remain for demo organization id.
