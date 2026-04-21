# 00 Foundation Regulatory Addendum

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: additive governance layer that supports later compliance and scheduling logic

## What It Covers

The jurisdiction-aware extension of the foundation layer: facility license attributes, regulatory identity, ratio rule set linkage, and scheduling classifications that downstream modules can rely on.

## Primary Users

- Organization leadership
- Compliance and operations teams
- Modules that depend on regulatory timing or staffing rules

## Key Workflows

- Store facility-level regulatory identity
- Attach ratio rule sets to facilities
- Prepare the platform for county, state, and license-type rule differences

## Primary Surfaces

- `/admin/facilities`
- `/admin/facilities/[facilityId]`

## Data, Controls, And Automation

- Additive fields on `facilities`
- Ratio rule set model for future staffing and compliance enforcement
- Florida-first design aligned to Circle of Life

## Deck Framing

- Present this as the layer that makes Haven regulation-aware instead of merely workflow-aware.
- Explain that it enables downstream timing, survey, and staffing intelligence.
