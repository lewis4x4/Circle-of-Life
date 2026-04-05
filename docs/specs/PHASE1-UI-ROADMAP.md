# Haven Visual Design Architecture — Phase 1 UI Roadmap

> **Role Boundary:** This document outlines the strict **Visual Design / UI layer** deliverables for the Phase 1 Haven rollout. It does *not* cover Backend Data schemas, RLS rules, or Supabase edge functions. This is the roadmap for the Next.js frontend presentation layers.

> **Canonical reference:** frontend stack/routing/scope conflicts are resolved by `docs/specs/FRONTEND-CONTRACT.md`.

---

## Sector 0: Structural Foundation (COMPLETED)
The absolute bedrock of the "Soft Precision" visual identity.

- [x] **Global CSS Tokens:** Mapped `Midnight Slate` palette, CVD-optimized severity colors, and organic 12px card radii.
- [x] **Framework Primitives:** Initialized shadcn/ui components (Buttons, Inputs, Cards, Tables, Avatars).
- [x] **Root Entryway (`/`)**: Cinematic marketing splash page.
- [x] **Authentication (`/login`)**: High-density Zod-validated Supabase routing portal.
- [x] **Layout Grouping**: 
  - `(admin)`: Desktop-first dashboard shell with facility selector.
  - `(caregiver)`: Mobile-first OLED True Black shell.
  - `(family)`: Hospitality-inspired warm-stone background shell.

---

## Sector 1: The Command Center (Admin Shell)
*The Bloomberg terminal for Facility Operators. High data density, perfect alignment.*

- [x] **Facility Control Dashboard (`/admin`)**: 
  - Dynamic Metrics Grid (Occupancy, Ratios, Acuity Alerts).
  - Front-Line Census Table (Dense data, severity badging, simulated avatars).
  - Live Shift Activity Feed (Chronological CSS-driven timeline).
- [x] **Resident Master List (`/admin/residents`)**: Scaffolded premium data table with shared filtering/loading/error/empty states.
- [x] **Staffing Roster & Schedules (`/admin/staff`)**: Scaffolded roster table with role/status/certification filters and risk badging.
- [x] **Incident Command (`/admin/incidents`)**: Scaffolded command queue with severity/status/category filters and standardized list states.
- [x] **Billing Core (`/admin/billing`)**: Scaffolded ledger-focused billing list with payer/status filters and shared list patterns.
- [x] **Collections (`/admin/billing/collections`)**: Facility-scoped collections activity ledger + log flow (`collection_activities`).

---

## Sector 2: The Floor (Caregiver Shell)
*Built exclusively for mobile devices. Forced dark mode. "Zero-glare" UI designed to be used in dimly lit resident rooms at 3 AM.*

- [x] **Caregiver Dashboard (`/caregiver`)**: Premium mobile-first shift brief with high-contrast critical alerts stack and quick actions.
- [x] **Task & ADL Queue (`/caregiver/tasks`)**: Swipe-ready completion queue with priority filtering and overdue-first mobile cards.
- [x] **eMAR Interface (`/caregiver/meds`)**: Mobile eMAR queue scaffold with large tap targets and Given/Refused status actions.
- [x] **Mobile Incident Reporter (`/caregiver/incident-draft`)**: Guided draft scaffold with step flow, category selection, and photo/compliance-ready states.
- [x] **Resident Quick-Profile (`/caregiver/resident/:id`)**: Mobile resident profile scaffold with risk banners, quick actions, and quick-add note CTA.

---

## Sector 3: The Hospitality Layer (Family Shell)
*The anti-clinical interface. Bright, airy, and reassuring.*

- [x] **Family Feed (`/family`)**: Hospitality-style chronological feed scaffold with care, meal, and activity updates.
- [x] **Care Summary (`/family/care-plan`)**: Readable care summary scaffold with sectioned parameters and printable view CTA.
- [x] **Financials (`/family/billing`)**: Read-only billing summary scaffold with invoice list and payment history entry points.
- [x] **Secure Comms (`/family/messages`)**: Secure messaging scaffold with conversation stream and composed message input.

---

## Next Immediate Execution Step
Sector 1 admin routes include billing collections and executive command center (`/admin/executive/*`) per Phase 3 Module 24 Core.

**Next prioritized UX gap (Phase 1 waiver W-ADMIN-01):** replace list-only admin flows with guided create/edit wizards **incrementally** (pick one module per segment). Alternatively continue **spec-driven** work from `docs/specs/README.md` (Phase 2/3 Enhanced slices) when the owner prioritizes them.

---

## Execution Lock (Set 2026-03-30)

Implementation sequence is temporarily locked to the following order:

1. Complete a **one-week Admin UI scaffold sprint** (Sector 1 route scaffolds and shared patterns).
2. Then return to backend/module specs in build order from `docs/specs/README.md`: **07 -> 11 -> 16**.

Execution lock status: **complete** (Admin scaffold sprint completed; backend modules 07, 11, and 16 implemented with segment gate artifacts).

Scope guardrails for the UI scaffold sprint:

- Prioritize route architecture, reusable layout/state patterns, and navigation wiring.
- Use mock/adaptor data where needed; defer full backend coupling until the corresponding spec module starts.
- Do not create new schema migrations during this sprint unless explicitly approved.
