# COL unified operations SaaS — roadmap context (read-only)

**Purpose:** Give agents **broad orientation** to the product direction. **Do not treat this file as an implementation spec.** You will receive **phase-one deliverables and per-module depth** separately. The canonical, full roadmap (including operator-specific context) is maintained by the owner at:

`/Users/brianlewis/Downloads/COL_SaaS_Moonshot_Roadmap.md`

Do **not** copy insured contacts, broker details, or premium figures from that document into the repo.

---

## What this product is

A **multi-facility assisted living (ALF)** operations platform for **owner-operators** running **separate legal entities** (LLCs) under one organization—initial beachhead **Florida ALF / AHCA**, designed to scale beyond one operator. **Product name: Haven.**

**Core gap the roadmap addresses:** No existing system unifies clinical ops, financial ops, regulatory compliance, insurance/risk, workforce, family engagement, and expansion planning in one **multi-tenant, multi-entity** stack built for ALFs (not SNF retrofits or IL property software).

---

## Technical direction (from roadmap; confirm at build time)

| Area | Direction |
|------|-----------|
| Data | **Supabase (PostgreSQL)** with **RLS** by facility/entity |
| Auth | Supabase Auth + **custom RBAC** (owner vs admin vs floor staff vs family vs external roles) |
| Web | **React / TypeScript** + **Tailwind** (this repo currently uses **Next.js**) |
| Mobile | React Native **or** PWA for floor workflows |
| AI | Primarily **Claude** + specialized models (vision/voice) for docs, compliance, NL queries |
| Deploy / edge | **Netlify** (web) + **Cloudflare Workers** (edge/gateway) — validate when shipping |
| Files | **Supabase Storage** and/or **R2** |

---

## Multi-entity model (conceptual)

`organizations` → `entities` (legal LLCs) → `facilities` → units/beds, staff assignments, residents (care plans, meds, logs, incidents, billing, etc.), plus entity-level financials, insurance, compliance.

**RLS expectation:** floor staff see **only** their facility; owners see **all**; family/brokers see **least privilege** slices.

---

## 24 modules by domain (names only)

| Domain | Modules |
|--------|---------|
| **A — Resident lifecycle** | 1 Referral & inquiry, 2 Admissions & move-in, 3 Resident profile & care planning, 4 Daily ops & logging, 5 Discharge & transition |
| **B — Clinical & compliance** | 6 Medication management, 7 Incident & risk, 8 State survey & regulatory, 9 Infection control & health monitoring, 10 Quality metrics & outcomes |
| **C — Workforce & operations** | 11 Staff & scheduling, 12 Training & competency, 13 Maintenance & environment, 14 Dietary & nutrition, 15 Transportation & appointments |
| **D — Financial & business** | 16 Resident billing & collections, 17 Entity & facility finance, 18 Insurance & risk finance, 19 Vendor & contracts, 20 Expansion & acquisition |
| **E — Family & community** | 21 Family portal, 22 Referral source CRM, 23 Reputation & online presence |
| **F — Intelligence** | 24 Executive intelligence layer |

---

## Phased delivery (high level)

1. **Phase 1 (weeks 1–12):** Foundation—multi-tenant schema, auth/RBAC, org/entity/facility hierarchy; resident core; daily logging core (eMAR/ADL/mobile); incident core; staff core; billing core. **Milestone:** pilot facility daily ops on platform.
2. **Phase 2 (13–20):** Deeper clinical + survey + infection.
3. **Phase 3 (21–28):** Multi-entity finance, insurance module, vendors, exec command center v1.
4. **Phase 4 (29–36):** Family portal, referral, admissions, discharge—full resident lifecycle.
5. **Phase 5 (37–48):** Quality, LMS, dietary, maintenance, transport, CRM, reputation, expansion modeling, advanced exec/AI.

**~30-day standalone wedge** in the roadmap: mobile incident reporting + multi-facility census dashboard + basic family comms—**still subject to your phase handoffs**, not auto-built from this summary.

---

## Strategic moat (why the roadmap matters)

Multi-entity architecture, insurance + clinical loop, AI-native workflows, **Florida ALF specificity**, operator-grounded design—competitive story is in the full doc.

---

## Implementation status in this repo (not the external roadmap file)

*Last refreshed: 2026-04-06.*

| Area | Status |
|------|--------|
| **Phase 1 core specs (00, 03, 04, 07, 11, 16)** | Implemented with migrations, RLS, and admin/caregiver/family routes per `docs/specs/README.md`. |
| **RCA persistence** | `incident_rca` (migration `070`); RCA UI reads/writes Postgres — closes waiver **W-RCA-01** (see `docs/specs/PHASE1-WAIVER-LOG.md`). |
| **Collections** | `collection_activities` admin list + log flow — closes **W-COLL-01**. |
| **Billing automation** | Shared `src/lib/billing/generate-monthly-invoices.ts`, unique index `071`, Edge Function `generate-monthly-invoices` + cron docs — **W-BILL-EF-01** addressed for monthly generation; AR aging automation remains a follow-up where the spec calls for it. |
| **Phase 3 Module 24 (Executive)** | Core command-center UI is live under `/admin/executive/*`; see `docs/specs/README.md` Phase 3 table for Enhanced backlog. |
| **Admin create flows (W-ADMIN-01)** | **`/admin/residents/new`**, **`/admin/staff/new`**, **`/admin/schedules/new`**, **`/admin/certifications/new`**, **`/admin/staffing/new`**, **`/admin/time-records/new`**, **`/admin/billing/rates/new`**; other admin modules may still be list-first where waived. |

For migration counts and environment alignment, use `PHASE1-ENV-CONFIRMATION.md` and Supabase CLI on the target project.

---

## How coding agents should use this

1. **Align** feature work with the **mission** in `docs/mission-statement.md` / `AGENTS.md` / `agents/registry.yaml`.
2. **Prefer** the **phase/module specs the owner hands you** over this overview.
3. **Do not** invent scope for modules not yet specified in the current phase.
