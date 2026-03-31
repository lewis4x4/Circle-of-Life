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
- `/admin/residents`
- `/admin/residents/[id]`
- `/admin/residents/[id]/care-plan`
- `/admin/assessments/overdue`
- `/admin/care-plans/reviews-due`
- `/admin/incidents`
- `/admin/incidents/[id]`
- `/admin/incidents/[id]/rca`
- `/admin/incidents/trends`
- `/admin/staff`
- `/admin/staff/[id]`
- `/admin/certifications`
- `/admin/schedules`
- `/admin/time-records`
- `/admin/staffing`
- `/admin/billing/rates`
- `/admin/residents/[id]/billing`
- `/admin/billing/invoices`
- `/admin/billing/invoices/[id]`
- `/admin/billing/invoices/generate`
- `/admin/billing/payments/new`
- `/admin/billing/ar-aging`
- `/admin/billing/revenue`
- `/admin/billing/org-ar-aging`

### Caregiver shell routes

- `/caregiver`
- `/caregiver/meds`
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

