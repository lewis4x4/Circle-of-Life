# 05 Discharge And Transition

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: discharge admin surfaces exist and are positioned as a coordinated workflow

## What It Covers

The structured transition workflow for discharging residents, documenting the reason, destination, and closure steps.

## Primary Users

- Facility admins
- Coordinators
- Billing and family-facing staff

## Key Workflows

- Open and manage a discharge case
- Record discharge reason and destination
- Coordinate downstream administrative and family tasks
- Preserve resident lifecycle continuity from admission through discharge

## Primary Surfaces

- `/admin/discharge`
- `/admin/discharge/new`
- `/admin/discharge/[id]`

## Data, Controls, And Automation

- discharge case modeling tied to residents
- status tracking for transition work
- explicit COL note around DCF discharge coordination

## Deck Framing

- Show Haven covering the full resident lifecycle, not just admission and daily care.
- Frame discharge as an operational handoff, compliance event, and family communication moment.
