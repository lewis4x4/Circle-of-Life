# 17 Entity And Facility Finance

- Spec maturity: `PARTIAL + COL notes`
- Repo posture: core finance hub is shipped

## What It Covers

The accounting layer for chart of accounts, journal entries, ledger views, budgets, period close, and posting rules across multiple facilities and entities.

## Primary Users

- Owners
- Org admins
- Finance staff

## Key Workflows

- manage chart of accounts and GL settings
- post and review journal entries
- analyze ledger and trial balance
- configure posting rules and period close controls
- compare budget to operational performance

## Primary Surfaces

- `/admin/finance`
- `/admin/finance/chart-of-accounts`
- `/admin/finance/journal-entries`
- `/admin/finance/journal-entries/new`
- `/admin/finance/journal-entries/[id]`
- `/admin/finance/ledger`
- `/admin/finance/budget`
- `/admin/finance/posting-rules`
- `/admin/finance/period-close`
- `/admin/finance/trial-balance`

## Data, Controls, And Automation

- entity and facility finance models with GL structure
- budget and posting-rule depth
- finance hooks from billing, vendor, and insurance workflows

## Deck Framing

- Present Haven as true multi-entity operating software, not a facility-only care tool.
- Use a portfolio-to-entity-to-facility accounting story.
