# Demo Seed Runbook

Purpose: provide management-demo data that is deterministic, repeatable, and fully reversible.

## Scope model

- Demo data is isolated to one deterministic workspace:
  - `organization_id = 11111111-1111-1111-1111-111111111111`
- Seed scripts never mutate non-demo organizations.
- Reset script removes all demo rows in dependency-safe order.

## Commands

```bash
npm run demo:seed
npm run demo:reset
npm run demo:reseed
```

## Required environment

- `SUPABASE_SERVICE_ROLE_KEY` (required)
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` (required)

Optional:

- `DEMO_ACTOR_USER_ID` — required only for auth-linked rows like incidents (`reported_by`) and clinical activity actor references.
- `DEMO_FAMILY_USER_ID` — required only when seeding family access links and family profile rows.

If optional IDs are missing, those auth-linked demo rows are skipped while core workspace/facility/resident/billing rows are still seeded.

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
