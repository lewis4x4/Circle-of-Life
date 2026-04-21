# 00 Foundation

- Spec maturity: `FULL + COL notes`
- Repo posture: foundational and already underpinning the full app

## What It Covers

The multi-tenant base layer for Haven: organizations, entities, facilities, units, rooms, beds, auth roles, RLS helper functions, audit logging, and the seed data that makes every other module possible.

## Primary Users

- Platform administrators
- Organization and facility administrators
- Every downstream module that depends on facility, user, and resident scoping

## Key Workflows

- Define organization -> entity -> facility hierarchy
- Assign user profiles and facility access
- Enforce role-based access through app roles
- Capture immutable audit history across sensitive domains

## Primary Surfaces

- `/login`
- `/admin/facilities`
- `/admin/facilities/[facilityId]`
- `/admin/settings/users`

## Data, Controls, And Automation

- RLS helpers such as organization and accessible-facility resolution
- Immutable audit log model
- Soft deletes, UTC timestamps, UUID primary keys, and money-in-cents conventions
- COL seed data for organization and facilities

## Deck Framing

- Show this as the trust fabric of the whole product.
- Visualize the hierarchy from organization down to bed.
- Emphasize that RLS and auditability are built into the product architecture, not layered on later.
