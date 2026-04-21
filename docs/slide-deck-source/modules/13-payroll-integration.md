# 13 Payroll Integration

- Spec maturity: `STUB / blocked on vendor context`
- Repo posture: payroll batch workflows exist, but full vendor integration remains unresolved

## What It Covers

The payroll export and reconciliation layer that turns approved labor and mileage into handoff-ready payroll batches.

## Primary Users

- Back-office finance and operations staff
- Facility admins finalizing labor data

## Key Workflows

- create payroll batches
- import approved time records and mileage
- review export lines
- produce CSV handoff files for downstream payroll systems

## Primary Surfaces

- `/admin/payroll`
- `/admin/payroll/new`
- `/admin/payroll/[id]`

## Data, Controls, And Automation

- payroll export lines tied to labor and mileage inputs
- batch filtering, search, and multiple CSV export formats
- vendor-specific downstream integration still depends on confirmed payroll target

## Deck Framing

- Be explicit that Haven already organizes payroll-ready data, even though full payroll-system integration is still a staged area.
