# Haven Slide Deck Source

This folder is a deck-production source pack for Claude Design or any other presentation workflow.

It is organized to answer three different needs:

1. `00-product-overview.md` explains the product story, the current maturity of the app, and a recommended slide arc.
2. `01-role-shells-and-navigation.md`, `02-platform-services-and-integrations.md`, and `03-route-catalog.md` explain the cross-cutting platform, shells, and route inventory.
3. `modules/` contains one markdown file per active spec/module so each domain can become its own chapter or slide cluster.

## How To Use This Pack

- Start with `00-product-overview.md`.
- Use `01-role-shells-and-navigation.md` to design the shell-level information architecture slides.
- Use `02-platform-services-and-integrations.md` to explain architecture, security, auditability, APIs, and automation.
- Use `03-route-catalog.md` when you need page-level coverage or a route appendix.
- Pull any file from `modules/` when you want a deep dive on one domain.

## Important Framing For The Deck

- Haven is both a shipped application and a still-hardening platform.
- Some modules are fully built and routed in code but still have acceptance or operational work remaining before live PHI production use.
- Some modules have partial or stub specs, but meaningful slices already exist in the repo.
- The deck should clearly separate:
  - Product vision
  - Shipped experience
  - Operational readiness / safeguards
  - Deferred or roadmap capabilities

## Suggested Folder Reading Order

- [00-product-overview.md](./00-product-overview.md)
- [01-role-shells-and-navigation.md](./01-role-shells-and-navigation.md)
- [02-platform-services-and-integrations.md](./02-platform-services-and-integrations.md)
- [03-route-catalog.md](./03-route-catalog.md)

## Module Files

- [00-foundation.md](./modules/00-foundation.md)
- [00-foundation-regulatory.md](./modules/00-foundation-regulatory.md)
- [01-referral-inquiry.md](./modules/01-referral-inquiry.md)
- [02-admissions-move-in.md](./modules/02-admissions-move-in.md)
- [03-resident-profile.md](./modules/03-resident-profile.md)
- [03-resident-profile-advanced.md](./modules/03-resident-profile-advanced.md)
- [04-daily-operations.md](./modules/04-daily-operations.md)
- [04-daily-operations-offline.md](./modules/04-daily-operations-offline.md)
- [05-discharge-transition.md](./modules/05-discharge-transition.md)
- [06-medication-management.md](./modules/06-medication-management.md)
- [07-incident-reporting.md](./modules/07-incident-reporting.md)
- [08-compliance-engine.md](./modules/08-compliance-engine.md)
- [09-infection-control.md](./modules/09-infection-control.md)
- [10-quality-metrics.md](./modules/10-quality-metrics.md)
- [11-staff-management.md](./modules/11-staff-management.md)
- [12-training-competency.md](./modules/12-training-competency.md)
- [13-payroll-integration.md](./modules/13-payroll-integration.md)
- [14-dietary-nutrition.md](./modules/14-dietary-nutrition.md)
- [15-transportation.md](./modules/15-transportation.md)
- [16-billing.md](./modules/16-billing.md)
- [17-entity-facility-finance.md](./modules/17-entity-facility-finance.md)
- [18-insurance-risk-finance.md](./modules/18-insurance-risk-finance.md)
- [19-vendor-contract-management.md](./modules/19-vendor-contract-management.md)
- [21-family-portal.md](./modules/21-family-portal.md)
- [22-referral-crm.md](./modules/22-referral-crm.md)
- [23-reputation.md](./modules/23-reputation.md)
- [24-executive-intelligence.md](./modules/24-executive-intelligence.md)
- [24-executive-v2.md](./modules/24-executive-v2.md)
- [25-resident-assurance-engine.md](./modules/25-resident-assurance-engine.md)
- [26-reporting-module.md](./modules/26-reporting-module.md)

## Modules Not Broken Out Here

- Module 20 and Module 27 do not currently have active first-class implementation specs in the repo, so they are not represented as standalone files in this deck source pack.
