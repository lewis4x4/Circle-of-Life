# 02 Admissions And Move-In

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: admin admissions workspace is present and tied to downstream onboarding

## What It Covers

The structured move-in workflow that takes a person from pending admission through clearance, bed reservation, and move-in readiness.

## Primary Users

- Admissions staff
- Facility admins
- Coordinators and nurses involved in readiness checks

## Key Workflows

- Open an admission case for a resident
- Link back to referral attribution when available
- Reserve a bed and quote accommodation terms
- Drive downstream onboarding work across care plan, meds, billing, and family coordination

## Primary Surfaces

- `/admin/admissions`
- `/admin/admissions/new`
- `/admin/admissions/[id]`
- `/admin/admissions/onboarding`
- `/admin/admissions/blocked`
- `/admin/admissions/move-in-ready`

## Data, Controls, And Automation

- `admission_cases`
- `admission_case_rate_terms`
- Readiness status model tied to resident, bed, and billing context
- Explicit COL requirements such as Form 1823 and DCF coordination belong in this story

## Deck Framing

- Show admissions as a command center, not a simple form.
- Emphasize handoffs: referral -> admissions -> resident record -> downstream onboarding.
