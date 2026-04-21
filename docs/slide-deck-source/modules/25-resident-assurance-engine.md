# 25 Resident Assurance Engine

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: rounding and observation workflows are shipped as an important operating layer

## What It Covers

The rounding and resident observation system that schedules checks, routes them to caregivers, records observations, and gives supervisors live visibility into missed or overdue assurance work.

## Primary Users

- Caregivers
- Nurses
- Supervisors and facility operators

## Key Workflows

- define observation plans and rules
- generate resident rounding tasks
- complete mobile checks on the floor
- monitor due, overdue, reassigned, excused, and missed work
- produce defensible completion reporting

## Primary Surfaces

- `/admin/rounding`
- `/admin/rounding/live`
- `/admin/rounding/plans`
- `/admin/rounding/plans/new`
- `/admin/rounding/plans/[id]`
- `/admin/rounding/reports`
- `/admin/rounding/insights`
- `/admin/rounding/safety`
- `/caregiver/rounds`
- `/caregiver/rounds/[residentId]`

## Data, Controls, And Automation

- observation plans, rules, tasks, and logs
- task generation, escalation, safety scoring, and AI-assisted support functions
- explicit auditability and late-entry visibility requirements

## Deck Framing

- This is a signature Haven story because it turns policy and care needs into live safety assurance.
- Show the supervisor board and caregiver mobile loop together.
