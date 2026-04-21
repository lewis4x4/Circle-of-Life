# 06 Medication Management

- Spec maturity: `FULL + COL notes`
- Repo posture: advanced medication workflows are present in code

## What It Covers

The expanded medication layer: eMAR operations, medication errors, PRN reassessment, controlled substance accountability, verbal orders, reconciliation, and pharmacy-oriented workflows.

## Primary Users

- Med-tech users
- Nurses
- Facility operators managing med compliance

## Key Workflows

- Run medication pass and review due meds
- capture PRN follow-up and medication exceptions
- document medication errors and verbal orders
- perform controlled substance counts and resolve variances

## Primary Surfaces

- `/med-tech`
- `/med-tech/controlled-count`
- `/admin/medications`
- `/admin/medications/verbal-orders`
- `/admin/medications/errors`
- `/admin/medications/controlled`
- `/admin/residents/[id]/medications`
- `/caregiver/prn-followup`

## Data, Controls, And Automation

- controlled-substance lifecycle tables
- medication interaction and reconciliation layers
- schedule-generation and missed-dose automation via Edge Functions
- explicit note that Baya training exists in the COL operating context

## Deck Framing

- Make this chapter feel high-stakes and highly controlled.
- Emphasize auditability, witness/co-sign workflows, and medication safety.
