# COL Demo Feedback Roadmap

**Status:** EXECUTION ROADMAP  
**Source inputs:** [2026-04-14-circle-of-life-haven-demo.md](/Users/brianlewis/Downloads/2026-04-14-circle-of-life-haven-demo.md), [2026-04-14-circle-of-life-haven-demo-2.md](/Users/brianlewis/Downloads/2026-04-14-circle-of-life-haven-demo-2.md), [haven-platform.md](/Users/brianlewis/Downloads/haven-platform.md)  
**Scope:** Product hardening, workflow convergence, role experience, finance decisioning, planning intelligence, acquisition readiness, regulatory productization  
**Audience:** Brian Lewis, Circle of Life leadership, future LLM execution agents

---

## Why This Exists

The April 14, 2026 Circle of Life all-hands demo produced a clear set of product expectations that go beyond module completeness. This roadmap translates those expectations into a start-to-finish execution sequence using **larger slices**, not micro-segments.

This is the governing roadmap for demo-driven product work until it is superseded.

---

## Product Commitments From The Demo

These are not optional polish items. They are the promises implicit in the meeting.

1. Haven must save time.
2. Haven must eliminate silo work across tools and files.
3. Haven must answer high-value operational questions in under 10 seconds.
4. The role experience must be purpose-built by user type.
5. The platform must scale to additional facilities and legal entities quickly.
6. The platform must support strategic planning, not just daily operations.
7. The platform must become credible enough to support a future AHCA-facing and commercialization narrative.

---

## What The Meeting Actually Added To Scope

### Explicit asks

- QuickBooks direction must be resolved.
- Document vault and uploads must be fully usable.
- Waitlist / turned-away archive analysis must exist.
- Alabama acquisition readiness must be real, not theoretical.
- Family portal needs a warmer design language.
- Marketing -> referral -> admissions must become a full pipeline.
- Executive dashboards must become production-grade, not illustrative.
- Haven should eventually support a regulator-facing proof story.

### Implicit product expectations

- Grace must be trustworthy enough to be the answer layer for the system.
- Workflow automation must be visible and understandable.
- Data provenance must be explainable for operators and leaders.
- The product must distinguish between prototype/demo surfaces and real production defaults.

---

## Current Product Reality

### Already built in the repo

- Broad admin surface for residents, incidents, compliance, finance, billing, insurance, vendors, reputation, reports, transportation, training, knowledge, executive, referrals, admissions, discharge, family portal.
- Role-specific surfaces for caregiver, family, med-tech, nurse/admin assistant/coordinator/dietary dashboards.
- Grace knowledge assistant with deterministic safe-mode recovery and published Obsidian-backed control plane.
- KB upload, indexing, document admin, and local Obsidian draft bridge.
- Multi-facility / multi-entity data model and substantial finance/compliance infrastructure.

### Not yet truly complete for the demo promise

- No closed-loop tester feedback system for COL staff.
- No resolved QuickBooks strategy.
- No archive/waitlist planning workflow.
- No marketing ingestion layer for campaigns/social.
- No acquisition onboarding workflow.
- No regulator-facing evidence layer.
- Family experience still requires a dedicated warmth/pass.
- Executive reporting still needs “example -> production” tightening.
- Grace still needs top-query breadth expansion and stronger UX/provenance.

---

## Non-Negotiable Execution Rules

1. Do not add new moonshot feature breadth before trust is closed.
2. Do not ship wrong answers in Grace to gain breadth.
3. Do not treat route count or migration count as product readiness.
4. Do not optimize for future commercialization before COL daily usefulness is proven.
5. Every slice must end with operator-grade acceptance gates.
6. Every slice must produce visible user-facing improvement, not just backend completeness.

---

## Roadmap Structure

This roadmap is organized into **6 large slices**. Each slice is large enough to produce a meaningful product jump and small enough to execute without losing coherence.

Execution order is strict unless an owner decision explicitly reorders it.

---

## Slice 1 — Trust And Daily Usefulness

### Goal

Make Haven trustworthy enough for daily COL testing and immediate operator value.

### Why first

Everything else depends on this. If Grace is unreliable, uploads feel broken, and dashboards feel like prototypes, broader scope will make the product worse.

### Includes

- Grace top-query trust and response correctness
- Grace speed/state/provenance UX
- document upload/indexing reliability and visible status
- feedback capture for COL staff testing
- “example/demo” cleanup in executive/admin surfaces
- operator-visible workflow status for key actions
- role landing-page simplification for owner, facility admin, caregiver, med-tech, family

### Must-answer product questions

- What are the top 25 questions that must never fail?
- What statuses must every async workflow expose?
- What is the approved feedback-capture path for staff during pilot?

### Acceptance gates

- Grace answers the top 25 prompts with correct domain/scope/format.
- Uploads never appear to hang silently.
- Every major async action has visible queued/success/failure states.
- COL staff can submit structured feedback inside the product.
- Executive/admin pages no longer present demo/example content as production truth.

### Explicitly out of scope

- QuickBooks implementation
- acquisition onboarding
- AHCA packaging
- commercialization work

---

## Slice 2 — Workflow Convergence

### Goal

Turn the major business lanes into end-to-end operational systems instead of disconnected modules.

### Includes

- referral -> admissions -> resident onboarding automation
- incident -> follow-up -> notification -> compliance visibility chain
- document upload -> Obsidian draft -> doctrine review workflow
- staff tasking and downstream notifications for admission/discharge changes
- command center workflow visibility improvements

### Must-answer product questions

- What exact downstream tasks should every admission create?
- What exact downstream tasks should every incident create?
- Which workflow steps are mandatory versus advisory?

### Acceptance gates

- A new admission automatically creates the right downstream actions for the right roles.
- An incident produces visible follow-up work and escalation visibility.
- Operators can see what a workflow did and why.
- KB documents no longer die as standalone uploads; they enter a review path.

### Explicitly out of scope

- social campaign ingest
- regulator-facing bundles

---

## Slice 3 — Experience By Role

### Goal

Make the system feel intentionally designed for each audience instead of exposing one giant operator surface.

### Includes

- owner experience
- facility admin experience
- caregiver experience
- med-tech experience
- family experience redesign
- task-prioritized role dashboards
- tablet/mobile validation for floor workflows

### Must-answer product questions

- What are the top 5 actions each role takes daily?
- What information must each role see first?
- What should family users never see, even if it exists internally?

### Acceptance gates

- Each role has a clear first screen with the right priorities.
- Floor staff can complete core tasks comfortably on tablet/mobile.
- The family portal no longer feels like a repurposed admin tool.
- Owner/admin views remain powerful without leaking complexity to other roles.

### Explicitly out of scope

- multi-state rollout
- commercialization packaging

---

## Slice 4 — Finance, Planning, And Decision Systems

### Goal

Resolve the strategic decision layers Milton raised: billing truth, planning intelligence, and growth forecasting.

### Includes

- QuickBooks strategy decision and implementation path
- per-facility billing workflow normalization or intentional divergence support
- archive / turned-away / waitlist analysis
- counts by month/year for demand signals
- conversion and capacity planning model
- executive planning dashboards tied to demand and revenue impact

### Must-answer product questions

- Is Haven the source of truth for billing or is QuickBooks?
- How do different facilities currently bill and where must that difference remain?
- What waitlist/archive inputs matter for build-vs-no-build decisions?

### Acceptance gates

- Billing source-of-truth is documented and reflected in the product.
- Leadership can answer the archive-list question in Haven.
- Demand and conversion trends are visible by month and year.
- Planning intelligence can support build/acquisition decisions with real data.

### Explicitly out of scope

- full external BI replacement
- regulator-facing evidence packaging

---

## Slice 5 — Expansion And Regulatory Readiness

### Goal

Make Haven operationally ready for new-facility absorption and credible regulator-facing evidence.

### Includes

- facility/entity onboarding templates
- acquisition-ready provisioning workflow
- Alabama / future-jurisdiction extension points in operations UX
- survey/evidence/readiness packaging
- facility credibility surfaces using survey history / deficiency / audit / readiness data
- AHCA one-pager data model and export path

### Must-answer product questions

- What is the fastest safe way to stand up a newly acquired facility?
- What would COL show AHCA or another regulator as evidence of operational control?
- What facility facts, histories, and readiness indicators must be packaged together?

### Acceptance gates

- A new facility can be onboarded with a repeatable product workflow.
- Regulatory evidence can be assembled from real system data.
- Readiness views align compliance, docs, incidents, and audits in one story.

### Explicitly out of scope

- broad commercialization
- full external regulator integration

---

## Slice 6 — Commercialization Layer

### Goal

Package Haven as a repeatable product only after COL operational fit is proven.

### Includes

- reference-customer story
- what is COL-specific vs generally productizable
- clean-sweep / zero-citation proof narrative
- operator-market positioning
- white-label/product packaging decisions
- commercialization readiness review

### Must-answer product questions

- What in Haven is bespoke to COL and should remain so?
- What can be generalized without harming COL?
- What proof points actually support external sale?

### Acceptance gates

- COL-specific and productized layers are explicitly separated.
- Commercialization story is backed by actual operational wins.
- Product narrative is coherent for large operators without breaking the COL use case.

### Explicitly out of scope

- active enterprise sales motions
- bespoke Brookdale delivery work

---

## Cross-Slice Workstreams

These run through every slice and should never be orphaned.

- Grace eval expansion
- provenance and trust UX
- workflow auditability
- role-based access verification
- upload/indexing reliability
- doctrine and Obsidian governance
- performance and latency monitoring
- COL tester feedback capture and triage

---

## Ordered Execution Sequence

1. Slice 1 — Trust And Daily Usefulness
2. Slice 2 — Workflow Convergence
3. Slice 3 — Experience By Role
4. Slice 4 — Finance, Planning, And Decision Systems
5. Slice 5 — Expansion And Regulatory Readiness
6. Slice 6 — Commercialization Layer

---

## Entry Criteria And Exit Gates

### To start Slice 1

- Current demo feedback is documented.
- Grace safe mode and upload reliability are being actively hardened.

### To exit Slice 1

- The product is trustworthy enough for real staff testing.
- The top trust breakers are gone.

### To exit Slice 2

- Core admissions/incidents/document workflows are operationally closed-loop.

### To exit Slice 3

- Each role experience is intentionally shaped.

### To exit Slice 4

- Billing truth and planning intelligence are decided and working.

### To exit Slice 5

- Acquisition and regulator-readiness are productized.

### To exit Slice 6

- External positioning is supported by actual COL outcomes.

---

## Slice 1 Starting Workstreams

Start here. These are the first execution lanes.

### Workstream 1: Grace Trust

- Expand top-query evals from the current narrow set to the full critical prompt pack.
- Add stronger provenance and visible scope/time-window display.
- Eliminate remaining wrong-module substitutions and unclear clarifications.

### Workstream 2: Async Reliability

- Finish hardening uploads, indexing, and background tasks.
- Make queued/processing/failed/success states consistent across admin surfaces.

### Workstream 3: Feedback Loop

- Add structured COL testing feedback capture in-product.
- Include route, role, facility, severity, and free-form notes.

### Workstream 4: Executive Cleanup

- Remove illustrative/demo ambiguity.
- Lock owner-facing KPIs, reports, and alert surfaces to real defaults.

### Workstream 5: Role Landing Simplification

- Give owner, facility admin, caregiver, med-tech, and family users a cleaner entry point with top priorities.

---

## LLM Execution Guidance

Future language models executing this roadmap should follow these rules:

1. Do not start a later slice while earlier-slice trust blockers remain open.
2. Prefer larger coherent slice work over tiny unrelated fixes.
3. Treat “prototype” language in the meeting as a requirement to productionize, not as permission to defer.
4. When uncertain, optimize for operator trust and workflow clarity before visual novelty.
5. Use COL’s actual workflows and language, not generic senior-living assumptions.
6. Preserve the distinction between:
   - runtime KB
   - curated Obsidian control plane
   - promoted doctrine
   - strategic narrative

---

## Initial Deliverable For The Next Build Pass

The next implementation pass should be **Slice 1 only**.

Recommended first deliverable:

- expand Grace trust coverage
- add structured pilot feedback capture
- finish async status reliability
- clean up executive/admin “demo mode” ambiguity

That is the right place to start from this roadmap.
