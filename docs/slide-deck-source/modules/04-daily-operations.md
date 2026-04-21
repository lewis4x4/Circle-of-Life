# 04 Daily Operations And Logging

- Spec maturity: `FULL + COL notes`
- Repo posture: core caregiver-facing workflows are shipped

## What It Covers

The frontline execution layer for shift documentation, ADLs, behavior tracking, condition changes, handoff, activities, and basic medication administration records.

## Primary Users

- Caregivers
- Med-tech users
- Nurses reviewing shift activity
- Facility operators watching documentation completeness

## Key Workflows

- Document daily logs and ADLs by resident and shift
- Record behavior and condition changes
- Complete shift handoff
- Track activities and attendance
- Run basic eMAR workflows that later expand in Module 06

## Primary Surfaces

- `/caregiver`
- `/caregiver/tasks`
- `/caregiver/resident/[id]`
- `/caregiver/resident/[id]/log`
- `/caregiver/resident/[id]/adl`
- `/caregiver/resident/[id]/behavior`
- `/caregiver/resident/[id]/condition-change`
- `/caregiver/handoff`

## Data, Controls, And Automation

- `daily_logs`, `adl_logs`, `behavioral_logs`, `condition_changes`, `shift_handoffs`
- `resident_medications` and `emar_records` at the daily-ops layer
- activity scheduling and attendance tracking

## Deck Framing

- Show this module as the heart of floor execution.
- Use phone-first visuals and “due now / just happened / needs handoff” storytelling.
