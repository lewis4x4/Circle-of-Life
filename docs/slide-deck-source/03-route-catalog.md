# Route Catalog

## Inventory Snapshot

This catalog is based on the route tree in `src/app` as of 2026-04-20.

- About 359 `page.tsx` surfaces exist in the repo.
- About 320 routes remain after collapsing obvious aliases and mirrored paths.
- The admin shell dominates the product surface, but the caregiver, med-tech, dietary, family, and onboarding shells are all real parts of the product.

## Canonical Public And Auth Routes

- `/`
- `/login`

## Canonical Admin Domains

- Command and dashboards: `/admin`, `/admin/assistant-dashboard`, `/admin/coordinator-dashboard`, `/admin/nurse-dashboard`
- Referral and intake: `/admin/referrals/*`, `/admin/admissions/*`, `/admin/discharge/*`
- Resident care: `/admin/residents/*`, `/admin/assessments/overdue`, `/admin/care-plans/reviews-due`
- Incidents and risk: `/admin/incidents/*`, `/admin/infection-control/*`, `/admin/compliance/*`
- Workforce: `/admin/staff/*`, `/admin/certifications/*`, `/admin/training/*`, `/admin/schedules/*`, `/admin/shift-swaps`, `/admin/time-records`, `/admin/payroll/*`, `/admin/staffing`
- Facility operations: `/admin/dietary/*`, `/admin/transportation/*`, `/admin/facilities/*`
- Revenue and finance: `/admin/billing/*`, `/admin/finance/*`, `/admin/insurance/*`, `/admin/vendors/*`
- Command intelligence: `/admin/executive/*`, `/admin/reports/*`, `/admin/search`, `/admin/knowledge/*`
- Engagement: `/admin/family-messages`, `/admin/family-portal`, `/admin/reputation/*`

## Caregiver Shell Routes

- `/caregiver`
- `/caregiver/clock`
- `/caregiver/meds`
- `/caregiver/rounds`
- `/caregiver/rounds/[residentId]`
- `/caregiver/tasks`
- `/caregiver/followups`
- `/caregiver/handoff`
- `/caregiver/prn-followup`
- `/caregiver/incident-draft`
- `/caregiver/resident/[id]`
- `/caregiver/resident/[id]/log`
- `/caregiver/resident/[id]/adl`
- `/caregiver/resident/[id]/behavior`
- `/caregiver/resident/[id]/condition-change`
- `/caregiver/policies`
- `/caregiver/schedules`

## Med-Tech And Dietary Routes

- `/med-tech`
- `/med-tech/controlled-count`
- `/dietary`

## Family And Onboarding Routes

- `/family`
- `/family/care-plan`
- `/family/messages`
- `/family/calendar`
- `/family/billing`
- `/family/invoices`
- `/family/payments`
- `/onboarding`
- `/onboarding/departments`
- `/onboarding/questions`

## API Route Families

- `/api/admin/*`
- `/api/care-plans/*`
- `/api/controlled-substance/*`
- `/api/cron/reputation/*`
- `/api/incidents/*`
- `/api/infection-control/*`
- `/api/insurance/*`
- `/api/knowledge/*`
- `/api/med-tech/*`
- `/api/reputation/*`
- `/api/rounding/*`

## What To Do With This Catalog In The Deck

- Use it as an appendix or backup slide set.
- Use the admin domain list to show the size of the platform.
- Use the caregiver, family, med-tech, and dietary lists to prove that Haven is not only a back-office admin product.
- Use API and Edge Function families to explain where automation and integrations sit.
