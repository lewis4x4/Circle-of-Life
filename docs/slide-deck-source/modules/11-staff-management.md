# 11 Staff Management

- Spec maturity: `FULL + COL notes`
- Repo posture: workforce operations are shipped across multiple hubs

## What It Covers

The workforce backbone: staff records, certifications, schedules, shift assignments, time records, staffing ratio snapshots, and shift swaps.

## Primary Users

- Facility admins
- Managers
- Admin assistants
- Staff viewing their own schedules and assignments

## Key Workflows

- manage staff roster and credentials
- build schedules and assign shifts
- review time records and staffing ratios
- coordinate swap requests and operational coverage

## Primary Surfaces

- `/admin/staff`
- `/admin/staff/new`
- `/admin/staff/[id]`
- `/admin/certifications`
- `/admin/schedules`
- `/admin/schedules/[id]`
- `/admin/shift-swaps`
- `/admin/time-records`
- `/admin/staffing`
- `/caregiver/schedules`

## Data, Controls, And Automation

- staff master records, certifications, schedules, shift assignments, time records
- staffing ratio snapshots
- expiration and workforce follow-through hooks

## Deck Framing

- Present this as the system that converts licensed people and scheduled labor into safe coverage.
- Pair staffing screenshots with ratio and exception views.
