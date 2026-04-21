# Haven Product Overview

## One-Sentence Positioning

Haven is a unified operating system for assisted living, home health, and community-based care operators, designed to run clinical workflows, compliance, workforce, family engagement, finance, and executive oversight on one secure, role-governed data layer.

## Who The Product Is For

- Multi-site operators such as Circle of Life, which runs 5 Florida ALF facilities under separate entities.
- Executive leaders who need portfolio visibility.
- Facility operators who need daily control of residents, incidents, staffing, and admissions.
- Floor staff who need fast mobile workflows.
- Families who need a controlled window into care updates, communication, and billing.

## Core Product Thesis

- Put clinical, financial, and operational workflows on one shared system instead of spreading work across disconnected tools.
- Enforce row-level security, auditability, and facility scoping from the foundation up.
- Use AI and automation only as support layers, never as substitutes for clinical judgment, licensure rules, or audit trails.
- Make each role land in a purpose-built shell instead of a generic dashboard.

## What Exists In The Repo Today

- A large Next.js App Router application with roughly 320 canonical page surfaces and 359 `page.tsx` files when aliases are included.
- Distinct role shells for admin, caregiver, med-tech, dietary, family, and onboarding.
- Deep admin coverage across residents, billing, staffing, incidents, compliance, finance, insurance, vendors, executive reporting, transportation, training, referrals, reputation, and rounding.
- Supabase-backed data model with RLS, audit triggers, API route handlers, and Edge Functions.
- A spec library that describes both shipped modules and future/partial modules.

## How To Frame Product Maturity In The Deck

- `Shipped in repo`: routes, data models, and workflows already exist in code.
- `Hardening / acceptance`: engineering may be complete, but environment, UAT, or operational controls still matter before live PHI production use.
- `Partial / stub`: a domain is real in the product narrative, but the current implementation is incomplete or intentionally staged.

## Recommended Deck Narrative

1. Why Haven exists: the operating problem in senior care.
2. Who it serves: owner to caregiver to family.
3. Platform principles: RLS, audit log, soft deletes, UTC, money in cents, multi-entity support.
4. Role shells: each persona lands in a different operating surface.
5. Resident journey: referral to admission to daily care to discharge.
6. Daily care loop: resident profile, care plans, eMAR, ADLs, incidents, rounding.
7. Facility operations loop: staffing, training, dietary, transportation, billing.
8. Risk and compliance loop: incidents, infection, compliance, insurance.
9. Business operations loop: finance, vendors, reporting, executive intelligence.
10. Family engagement and public reputation.
11. Automation and AI layers: reporting, alerts, scheduling, scoring, inbound integrations.
12. Current maturity and roadmap: what is live, what is hardening, what is next.

## Suggested Slide Groups

- Group 1: Market problem and Haven thesis
- Group 2: Platform architecture and governance
- Group 3: Role-based shells and day-in-the-life flows
- Group 4: Clinical operations modules
- Group 5: Workforce and facility operations modules
- Group 6: Financial and executive modules
- Group 7: Integrations, automation, and AI
- Group 8: Readiness, rollout, and roadmap

## Design Guidance For Claude Design

- Treat the deck as a guided product tour, not a compliance document.
- Show role transitions and workflow handoffs, not isolated screenshots only.
- Separate foundational trust layers from user-facing workflows.
- Use portfolio-to-facility-to-resident zoom levels as a recurring visual pattern.
- Mark each module as one of: `Foundation`, `Operational`, `Analytic`, `Engagement`, or `Roadmap`.

## What To Emphasize Repeatedly

- Haven is multi-tenant and facility-scoped by design.
- Admin pages are not the whole product; the caregiver, med-tech, dietary, family, and onboarding surfaces matter.
- The app already spans both frontline execution and executive oversight.
- Safety, documentation integrity, and traceability are part of the product architecture, not afterthoughts.
