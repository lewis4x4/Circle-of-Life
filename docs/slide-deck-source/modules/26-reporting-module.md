# 26 Reporting Module

- Spec maturity: `STUB`
- Repo posture: reporting surfaces are already substantial in code

## What It Covers

The reporting operating system: templates, saved views, run-time exports, schedules, packs, history, and admin governance.

## Primary Users

- Owners and org admins
- Facility admins and managers
- Any role that consumes standardized reporting

## Key Workflows

- browse report templates
- run and export a report
- save filtered variants
- schedule recurring reports
- assemble report packs
- inspect export history and governance metadata

## Primary Surfaces

- `/admin/reports`
- `/admin/reports/templates`
- `/admin/reports/templates/[slug]`
- `/admin/reports/run/[sourceType]/[id]`
- `/admin/reports/saved`
- `/admin/reports/scheduled`
- `/admin/reports/packs`
- `/admin/reports/history`
- `/admin/reports/admin`
- `/admin/executive/reports`

## Data, Controls, And Automation

- report templates, versions, saved views, schedules, and packs
- report scheduler and report generator functions
- governance rules around official and locked templates

## Deck Framing

- Present reporting as a product system, not as an export button.
- Use this chapter to connect operational data capture to decision-ready outputs.
