# Haven Frontend Contract (Phase 1 Canonical)

This document is the authoritative frontend implementation contract for Phase 1.
If any UI route/stack behavior in other docs conflicts with this file, this file wins.

---

## 1) Locked Stack

- Framework: Next.js App Router (repo standard)
- Language: TypeScript strict mode
- Styling: Tailwind CSS + shadcn/ui
- Icons: Lucide React
- Forms: React Hook Form + Zod
- Client UI state: Zustand
- Server state: TanStack Query
- Date handling: date-fns + date-fns-tz (`America/New_York` display)
- Deployment target: any platform that fully supports Next.js App Router runtime

The project must not introduce React Router + Vite in parallel with Next.js.

---

## 2) Canonical Route Namespace

### Admin shell routes

- `/admin`
- `/admin/search` (Phase 3.5 platform search index UI)
- `/admin/referrals` (Phase 4 Module 1 hub — `01-referral-inquiry.md`)
- `/admin/referrals/new`
- `/admin/referrals/[id]`
- `/admin/referrals/sources`
- `/admin/referrals/hl7-inbound` (Phase 6 Module 22 — `22-referral-crm.md`)
- `/admin/referrals/hl7-inbound/new`
- `/admin/reputation` (Phase 6 Module 23 — `23-reputation.md`)
- `/admin/reputation/accounts/new`
- `/admin/reputation/replies/new`
- `/admin/admissions` (Phase 4 Module 2 — `02-admissions-move-in.md`)
- `/admin/admissions/new`
- `/admin/admissions/[id]`
- `/admin/discharge` (Phase 4 Module 3 — `05-discharge-transition.md`)
- `/admin/discharge/new`
- `/admin/discharge/[id]`
- `/admin/quality` (Phase 5 — `10-quality-metrics.md`)
- `/admin/quality/measures/new`
- `/admin/executive` (Phase 3 Module 24 v1 — `24-executive-intelligence.md`)
- `/admin/executive/entity`
- `/admin/executive/entity/[id]`
- `/admin/executive/facility/[id]`
- `/admin/executive/alerts`
- `/admin/executive/reports`
- `/admin/executive/benchmarks`
- `/admin/executive/nlq` (Phase 5 — `24-executive-v2.md`)
- `/admin/executive/scenarios` (Phase 5 — `24-executive-v2.md`)
- `/admin/executive/settings`
- `/admin/residents`
- `/admin/residents/new`
- `/admin/residents/[id]`
- `/admin/residents/[id]/care-plan`
- `/admin/rounding`
- `/admin/rounding/live`
- `/admin/rounding/plans`
- `/admin/rounding/plans/new`
- `/admin/rounding/plans/[id]`
- `/admin/rounding/reports`
- `/admin/assessments/overdue`
- `/admin/care-plans/reviews-due`
- `/admin/incidents`
- `/admin/incidents/[id]`
- `/admin/incidents/[id]/rca`
- `/admin/incidents/trends`
- `/admin/staff`
- `/admin/staff/new`
- `/admin/staff/[id]`
- `/admin/certifications`
- `/admin/certifications/new`
- `/admin/training` (Phase 6 Module 12 — `12-training-competency.md`)
- `/admin/training/new`
- `/admin/dietary` (Phase 6 Module 14 — `14-dietary-nutrition.md`)
- `/admin/dietary/new`
- `/admin/transportation` (Phase 6 Module 15 — `15-transportation.md`)
- `/admin/transportation/vehicles/new`
- `/admin/transportation/inspections/new`
- `/admin/transportation/drivers/new`
- `/admin/schedules`
- `/admin/schedules/new`
- `/admin/time-records`
- `/admin/payroll` (Phase 6 — `13-payroll-integration.md`)
- `/admin/payroll/new`
- `/admin/staffing`
- `/admin/billing/rates`
- `/admin/residents/[id]/billing`
- `/admin/billing/invoices`
- `/admin/billing/invoices/[id]`
- `/admin/billing/invoices/generate`
- `/admin/billing/payments/new`
- `/admin/billing/collections`
- `/admin/billing/collections/new`
- `/admin/billing/ar-aging`
- `/admin/billing/revenue`
- `/admin/billing/org-ar-aging`
- `/admin/medications` (Phase 2 hub)
- `/admin/medications/verbal-orders`
- `/admin/medications/verbal-orders/new`
- `/admin/medications/errors`
- `/admin/medications/errors/new`
- `/admin/medications/controlled`
- `/admin/residents/[id]/medications`
- `/admin/infection-control` (Phase 2 hub)
- `/admin/infection-control/new`
- `/admin/infection-control/[id]`
- `/admin/infection-control/outbreaks/[id]`
- `/admin/infection-control/staff-illness`
- `/admin/residents/[id]/vitals`
- `/admin/residents/[id]/vitals/thresholds`
- `/admin/compliance` (Phase 2 hub)
- `/admin/compliance/deficiencies/new`
- `/admin/compliance/deficiencies/[id]`
- `/admin/compliance/policies`
- `/admin/compliance/policies/new`
- `/admin/compliance/policies/[id]/edit`
- `/admin/finance` (Phase 3 Module 17 hub)
- `/admin/finance/chart-of-accounts`
- `/admin/finance/journal-entries`
- `/admin/finance/journal-entries/new`
- `/admin/finance/journal-entries/[id]`
- `/admin/finance/ledger`
- `/admin/insurance` (Phase 3 Module 18 hub)
- `/admin/insurance/policies`
- `/admin/insurance/policies/new`
- `/admin/insurance/policies/[id]`
- `/admin/insurance/renewals`
- `/admin/insurance/claims`
- `/admin/insurance/claims/[id]`
- `/admin/insurance/loss-runs`
- `/admin/insurance/coi`
- `/admin/insurance/workers-comp`
- `/admin/vendors` (Phase 3 Module 19 hub)
- `/admin/vendors/directory`
- `/admin/vendors/[id]`
- `/admin/vendors/contracts`
- `/admin/vendors/contracts/[id]`
- `/admin/vendors/purchase-orders`
- `/admin/vendors/purchase-orders/new`
- `/admin/vendors/purchase-orders/[id]`
- `/admin/vendors/invoices`
- `/admin/vendors/invoices/[id]`
- `/admin/vendors/payments`
- `/admin/vendors/spend`
- `/admin/family-messages` (Phase 1 — family ↔ staff messaging)
- `/admin/family-portal` (Phase 5 Module 21 — `21-family-portal.md` — triage, conferences, consents)

### Caregiver shell routes

- `/caregiver`
- `/caregiver/meds`
- `/caregiver/rounds`
- `/caregiver/rounds/[residentId]`
- `/caregiver/tasks`
- `/caregiver/incident-draft`
- `/caregiver/followups`
- `/caregiver/resident/[id]`
- `/caregiver/resident/[id]/log`
- `/caregiver/resident/[id]/adl`
- `/caregiver/resident/[id]/behavior`
- `/caregiver/resident/[id]/condition-change`
- `/caregiver/handoff`
- `/caregiver/prn-followup`
- `/caregiver/controlled-count` (Phase 2 controlled substance reconciliation)

### Family shell routes

- `/family`
- `/family/care-plan`
- `/family/messages`
- `/family/calendar`
- `/family/billing`
- `/family/invoices`
- `/family/payments`

Phase 1 does not include online payment entry for family users.

---

## 3) Facility Scoping Rules (Non-Negotiable)

- Facility scope is selected via the header facility selector in Admin shell.
- Data scoping is done via `selectedFacilityId` in query keys and API params, not URL path segments.
- Owner/org_admin may select `All Facilities`.
- Cross-facility pages use aggregate mode with explicit labeling.

This replaces `"/facilities/:id/*"` as a UI routing pattern. Keep `facility_id` in API payloads and query params.

---

## 4) Billing Scope Lock (Phase 1)

- Admin billing: full Phase 1 scope per `16-billing.md`.
- Family billing: read-only in Phase 1 (`invoices`, `payment history` views).
- Family online payment (`/family/pay`) is deferred to later phase.

---

## 5) UI Quality Bar for "World-Class" Phase 1

- Every new page ships with loading, empty, and error states.
- Keyboard and screen-reader pass for Admin shell critical flows.
- Mobile tap targets minimum 44x44 for caregiver flows.
- Route-level design review coverage updated in `.agents/design-review-runner.mjs`.
- Segment gate with `--ui` must pass for UI segments.

---

## 6) Implementation Sequence Lock

1. One-week Admin UI scaffold sprint (route shells + shared patterns).
2. Resume backend modules in order: `07 -> 11 -> 16`.
3. As each backend module lands, replace mock/adaptor data for matching Admin routes.

