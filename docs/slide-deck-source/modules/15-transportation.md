# 15 Transportation

- Spec maturity: `PARTIAL`
- Repo posture: transportation hub, calendar, approvals, and request detail flows are shipped

## What It Covers

Resident transportation requests, drivers, vehicles, inspections, mileage, calendar views, and appointment coordination.

## Primary Users

- Admin assistants
- Facility operators
- Drivers and scheduling staff

## Key Workflows

- create and manage transportation requests
- view trips on calendar layouts
- approve mileage
- maintain vehicle, driver, and inspection records
- export or hand off events to calendar tools

## Primary Surfaces

- `/admin/transportation`
- `/admin/transportation/requests/new`
- `/admin/transportation/requests/[id]`
- `/admin/transportation/calendar`
- `/admin/transportation/mileage-approvals`
- `/admin/transportation/settings`
- `/admin/transportation/vehicles/new`
- `/admin/transportation/drivers/new`
- `/admin/transportation/inspections/new`

## Data, Controls, And Automation

- transport requests, mileage, driver, vehicle, and inspection models
- org mileage reimbursement settings
- calendar export, `.ics`, and external compose links for coordination

## Deck Framing

- Frame this as operational orchestration, not just trip logging.
- Show the calendar and request detail views as proof of workflow depth.
