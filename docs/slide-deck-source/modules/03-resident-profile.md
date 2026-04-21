# 03 Resident Profile And Care Planning

- Spec maturity: `FULL + COL notes`
- Repo posture: core resident system of record is shipped

## What It Covers

The central resident record: demographics, clinical context, payers, contacts, assessments, care plans, documents, and bed assignment.

## Primary Users

- Facility admins
- Coordinators
- Nurses
- Family members in read-only portal views

## Key Workflows

- Create and manage resident profiles
- Maintain care plans and plan items
- Track assessments and resident documents
- Connect contacts, payers, physicians, and safety context to one resident identity

## Primary Surfaces

- `/admin/residents`
- `/admin/residents/new`
- `/admin/residents/[id]`
- `/admin/residents/[id]/care-plan`
- `/admin/residents/[id]/assessments`
- `/family/care-plan`

## Data, Controls, And Automation

- `residents`, `care_plans`, `care_plan_items`, `assessments`, resident media and contact tables
- Structured clinical and billing context on the resident record
- Assessment templates seeded for ADL, fall, pressure injury, and depression risk

## Deck Framing

- Treat this module as the resident digital chart and system of record.
- Show how many other modules anchor to the resident profile.
