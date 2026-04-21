# 03 Resident Profile Advanced

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: meaningful advanced care-planning slices are present in code

## What It Covers

The extension of resident profile into generated tasks, acuity-aware review alerts, assessment automation, and longitudinal care-plan governance.

## Primary Users

- Coordinators
- Nurses
- Clinical leaders

## Key Workflows

- Generate daily tasks from active care-plan items
- Trigger review alerts from acuity or assessment changes
- Schedule structured reassessments
- Move care planning from static documentation to operational follow-through

## Primary Surfaces

- `/admin/residents/[id]/care-plan`
- `/admin/residents/[id]/assessments`
- `/admin/residents/[id]/assessments/new`
- `/admin/assessments/overdue`
- `/admin/care-plans/reviews-due`

## Data, Controls, And Automation

- `care_plan_tasks`
- `care_plan_review_alerts`
- acuity and decline-oriented business rules
- automation hooks that later connect to rounding and operational tasking

## Deck Framing

- Position this as the shift from “charting care” to “operationalizing care.”
- Show how a plan becomes daily work.
