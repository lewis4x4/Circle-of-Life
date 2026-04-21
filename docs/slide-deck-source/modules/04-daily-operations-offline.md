# 04 Daily Operations Offline

- Spec maturity: `STUB`
- Repo posture: planned resilience layer, not a fully delivered offline product

## What It Covers

The offline and sync contract for high-reliability frontline workflows such as eMAR and caregiver documentation.

## Primary Users

- Caregivers
- Med-tech users
- Operators who need continuity during poor connectivity

## Key Workflows

- Queue write actions offline
- Sync back with idempotency keys
- Preserve documentation integrity through conflict-safe replay

## Primary Surfaces

- No standalone UX chapter yet; this is a platform behavior layer attached to caregiver and medication workflows.

## Data, Controls, And Automation

- background sync expectations
- idempotency keys for eMAR and other write-heavy flows
- safe caching rules rather than unrestricted offline writes

## Deck Framing

- Present this as resilience infrastructure.
- It matters in the story because frontline care cannot depend on perfect connectivity.
