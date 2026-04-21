# 08 Compliance Engine

- Spec maturity: `FULL + COL notes`
- Repo posture: major compliance surfaces are shipped

## What It Covers

The operator-facing compliance system for deficiencies, policy management, emergency preparedness, survey readiness, and compliance scoring.

## Primary Users

- Facility admins
- Organization leadership
- Compliance and quality teams

## Key Workflows

- Track survey deficiencies and plans of correction
- manage policies and acknowledgments
- surface compliance gaps and rule violations
- support emergency preparedness and audit export workflows

## Primary Surfaces

- `/admin/compliance`
- `/admin/compliance/deficiencies/new`
- `/admin/compliance/deficiencies/[id]`
- `/admin/compliance/deficiencies/analysis`
- `/admin/compliance/policies`
- `/admin/compliance/policies/new`
- `/admin/compliance/rules`
- `/admin/compliance/scan`
- `/admin/compliance/emergency-preparedness`

## Data, Controls, And Automation

- deficiency, policy, survey, and scoring models
- Florida AHCA-oriented compliance framing
- rule-driven risk surfacing and dashboard rollups

## Deck Framing

- Show this as proactive compliance operations rather than passive document storage.
- Connect it to incidents, infection, staffing, and executive risk views.
