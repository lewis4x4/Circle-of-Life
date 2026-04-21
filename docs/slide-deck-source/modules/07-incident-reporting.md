# 07 Incident Reporting

- Spec maturity: `FULL + COL notes`
- Repo posture: incident command workflows are shipped

## What It Covers

Incident capture, investigation, workflow obligations, root-cause review, and follow-up management for falls, med events, behavior events, environmental issues, and reportable events.

## Primary Users

- Caregivers creating drafts
- Nurses and managers investigating incidents
- Facility and organization leadership reviewing risk posture

## Key Workflows

- Create incident drafts quickly from the floor
- escalate into full incident records
- record required notifications and obligations
- investigate, assign follow-ups, and document root cause

## Primary Surfaces

- `/caregiver/incident-draft`
- `/admin/incidents`
- `/admin/incidents/new`
- `/admin/incidents/[id]`
- `/admin/incidents/[id]/rca`
- `/admin/incidents/followups`
- `/admin/incidents/obligations`
- `/admin/incidents/trends`

## Data, Controls, And Automation

- incident tables, photos, follow-ups, and numbering sequences
- obligation tracking for nurse, administrator, owner, physician, family, AHCA, and insurance notifications
- tie-ins to compliance, insurance, and rounding modules

## Deck Framing

- Present this as the product’s risk nerve center.
- Show the flow from frontline capture to investigation to executive visibility.
