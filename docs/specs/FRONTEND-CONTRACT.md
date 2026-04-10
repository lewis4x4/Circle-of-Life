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

Hub files under the route group `(admin)` live at `src/app/(admin)/<segment>/...`, which would otherwise produce URLs **without** the `/admin` prefix (for example `/staff`). **`next.config.ts`** `redirects` sends **`/<segment>`** and **`/<segment>/*`** to **`/admin/<segment>`** for every hub that has a matching `admin/<segment>` tree (Track D **D54** Module 14 dietary, **D55** all other listed hubs — see the `segments` list in `next.config.ts`). Hubs that exist only under `admin/...` (no duplicate `(admin)/<segment>` root) are unchanged.

- `/admin`
- `/admin/search` (Phase 3.5 platform search index UI)
- `/admin/referrals` (Phase 4 Module 1 hub — `01-referral-inquiry.md`; Phase 6 **pipeline status filter + CSV** — `22-referral-crm.md` **D70**; **pipeline search** — **D72**)
- `/admin/referrals/new`
- `/admin/referrals/[id]`
- `/admin/referrals/sources`
- `/admin/referrals/hl7-inbound` (Phase 6 Module 22 — `22-referral-crm.md`; **Copy raw** — D65; **status filter** — D67; **CSV respects filter** — D68; **search** — D71)
- `/admin/referrals/hl7-inbound/new`
- `/admin/reputation` (Phase 6 Module 23 — `23-reputation.md`; hub **replies CSV** optional status scope — D75)
- `/admin/reputation/integrations` (Google OAuth + Google/Yelp review import — `23-reputation.md` Track D D44–D47; `POST /api/reputation/sync/google`, `POST /api/reputation/sync/yelp`, `POST /api/cron/reputation/google-reviews`)
- `/admin/reputation` hub draft actions — `POST /api/reputation/replies/[id]/post-google` (Track D D48); `POST /api/reputation/replies/[id]/post-yelp` (Track D D49)
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
- `/admin/training/completions/new` (log `staff_training_completions` — Track D D39)
- `/admin/training/inservice/new` (in-service session + attendees — Track D D42)
- `/admin/dietary` (Phase 6 Module 14 — `14-dietary-nutrition.md`; **`/dietary` redirects here** — Track D D54–D55; hub **status filter** + **CSV status scope** — D77)
- `/admin/dietary/new`
- `/admin/dietary/clinical-review` (read-only diet order + resident medications — Track D13; advisory med–diet hints — Track D50–D53)
- `/admin/transportation` (Phase 6 Module 15 — `15-transportation.md`; hub **status filter** + **CSV status scope** — D76)
- `/admin/transportation/calendar` (week or month grid + daily agenda for `resident_transport_requests`; **Download `.ics`** for loaded window — Track D14–D57; optional **`?date=YYYY-MM-DD`** & **`?view=week|month`** — D66)
- `/admin/transportation/mileage-approvals` (`mileage_logs` approval queue — Track D15)
- `/admin/transportation/settings` (org mileage reimbursement rate — `owner` / `org_admin`)
- `/admin/transportation/requests/new`
- `/admin/transportation/requests/[id]` (**Google + Outlook** compose links + **Download .ics** + **View on transportation calendar** — Track D D61–D66)
- `/admin/transportation/vehicles/new`
- `/admin/transportation/inspections/new`
- `/admin/transportation/drivers/new`
- `/admin/schedules`
- `/admin/schedules/new`
- `/admin/time-records` (bulk approve pending punches with clock-out — Track D60; CSV — D31)
- `/admin/payroll` (Phase 6 — `13-payroll-integration.md`; **batch status filter + CSV** — D73; **hub search** — D74)
- `/admin/payroll/new`
- `/admin/payroll/[id]` (import mileage + **approved time records** into lines — Track D17 + D58; **full + flat + vendor handoff + hours split CSV** — D18 + D59 + D64 + D69)
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

### Onboarding portal routes

- `/onboarding` (separate onboarding command center portal; not mounted inside Admin shell)
- `/onboarding/departments`
- `/onboarding/questions`
- `/onboarding/questions-import.template.json` (static JSON template for optional question-pack imports)

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

