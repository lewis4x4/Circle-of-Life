# Homewood Pilot Reset Readiness Review — 2026-05-03

## Verdict
PASS — Homewood Lodge ALF is ready for first real-data pilot entry, subject to operational/compliance confirmation that Supabase BAA/backups/PITR are active before PHI entry.

## Remote target verified
- Supabase host: `manfqmasfqppukpobpld.supabase.co`
- Active organization: `Circle of Life Assisted Living Communities`
- Demo organization `Haven Demo Workspace` is soft-deleted/inactive.

## Active facilities preserved
- Grande Cypress ALF
- Homewood Lodge ALF
- Oakridge ALF
- Plantation ALF
- Rising Oaks ALF

## Homewood pilot facility
- Name: Homewood Lodge ALF
- ID: `00000000-0000-0000-0002-000000000003`
- Status: active
- Existing Homewood access assignments: 8

## Cleared operational/demo data
Verified zero rows across 105 operational/demo tables, including:
- residents, staff, census, beds, rooms, units
- medications/eMAR/med passes
- care plans, daily logs, ADLs, incidents
- family resident links/messages
- time records, staffing snapshots, payroll exports
- invoices, invoice line items, payments
- journal entries, vendor/AP, purchase orders
- reports/runs/snapshots, search/demo indexes
- Grace/chat demo messages, task/risk/demo records

## Preserved intentionally
- user profiles and facility access assignments
- roles/permissions
- real COL facility/entity shells
- facility configuration/reference rows
- assessment/onboarding/compliance/report templates
- knowledge-base documents/chunks/reference docs
- audit history

## App validation
- `npm run check:env-example` PASS
- `npm run migrations:check` PASS — 215 migrations, sequence 001..215
- `npm run check:admin-shell` PASS
- `npm run check:memory-care` PASS
- `npm run build` PASS — Next.js production build completed

## Notes
- The old demo org/facility was soft-deleted, not hard-deleted, because immutable audit history still references it.
- I did not independently verify Supabase Pro/BAA/PITR from the Supabase dashboard in this review.
