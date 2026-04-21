# 09 Infection Control

- Spec maturity: `FULL + COL notes`
- Repo posture: infection and vitals workflows are shipped

## What It Covers

Infection surveillance, outbreak tracking, resident vitals monitoring, thresholding, and staff illness management.

## Primary Users

- Nurses
- Facility clinical leaders
- Executive and compliance stakeholders monitoring outbreaks and health risk

## Key Workflows

- Track infections and illness episodes
- log and monitor resident vital signs
- define thresholds and evaluate alerts
- manage outbreak records and staff illness visibility

## Primary Surfaces

- `/admin/infection-control`
- `/admin/infection-control/new`
- `/admin/infection-control/[id]`
- `/admin/infection-control/outbreaks/[id]`
- `/admin/infection-control/staff-illness`
- `/admin/residents/[id]/vitals`
- `/admin/residents/[id]/vitals/thresholds`

## Data, Controls, And Automation

- infection, outbreak, vitals, immunization, and staff illness tables
- vitals and outbreak evaluation APIs
- tie-ins to alerting and executive intelligence

## Deck Framing

- Present this as the health surveillance layer of the platform.
- Use trend and threshold visuals instead of static form screenshots only.
