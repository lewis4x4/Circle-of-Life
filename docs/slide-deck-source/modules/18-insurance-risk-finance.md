# 18 Insurance And Risk Finance

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: insurance hub is shipped with renewal and claims depth

## What It Covers

Insurance policies, renewals, claims, loss runs, COI tracking, premium visibility, and risk-finance reporting.

## Primary Users

- Owners and org admins
- Insurance and finance stakeholders
- Brokers and risk managers

## Key Workflows

- maintain policy inventory
- track renewals and renewal packages
- review claims and loss runs
- manage COIs and workers' comp visibility

## Primary Surfaces

- `/admin/insurance`
- `/admin/insurance/policies`
- `/admin/insurance/policies/new`
- `/admin/insurance/policies/[id]`
- `/admin/insurance/renewals`
- `/admin/insurance/renewal-packages`
- `/admin/insurance/claims`
- `/admin/insurance/claims/[id]`
- `/admin/insurance/loss-runs`
- `/admin/insurance/coi`
- `/admin/insurance/workers-comp`

## Data, Controls, And Automation

- policy, claim, renewal, and COI models
- renewal narrative API with human-review framing
- cross-links from incidents and finance to insurance exposure

## Deck Framing

- This chapter proves Haven is designed for owner-level risk management, not just on-floor charting.
- Visualize claim lineage back to incidents and forward to executive dashboards.
