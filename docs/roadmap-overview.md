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

## 25 modules by domain (names only)

| Domain | Modules |
|--------|---------|
| **A — Resident lifecycle** | 1 Referral & inquiry, 2 Admissions & move-in, 3 Resident profile & care planning, 4 Daily ops & logging, 5 Discharge & transition |
| **B — Clinical & compliance** | 6 Medication management, 7 Incident & risk, 8 State survey & regulatory, 9 Infection control & health monitoring, 10 Quality metrics & outcomes |
| **C — Workforce & operations** | 11 Staff & scheduling, 12 Training & competency, 13 Maintenance & environment, 14 Dietary & nutrition, 15 Transportation & appointments |
| **D — Financial & business** | 16 Resident billing & collections, 17 Entity & facility finance, 18 Insurance & risk finance, 19 Vendor & contracts, 20 Expansion & acquisition |
| **E — Family & community** | 21 Family portal, 22 Referral source CRM, 23 Reputation & online presence |
| **F — Intelligence** | 24 Executive intelligence layer, 25 Resident assurance engine |

---

## Phased delivery (high level)

1. **Phase 1 (weeks 1–12):** Foundation—multi-tenant schema, auth/RBAC, org/entity/facility hierarchy; resident core; daily logging core (eMAR/ADL/mobile); incident core; staff core; billing core. **Milestone:** pilot facility daily ops on platform.
2. **Phase 2 (13–20):** Deeper clinical + survey + infection.
3. **Phase 3 (21–28):** Multi-entity finance, insurance module, vendors, exec command center v1.
4. **Phase 4 (29–36):** Family portal, referral, admissions, discharge—full resident lifecycle.
5. **Phase 5 (37–48):** Quality, LMS, dietary, maintenance, transport, CRM, reputation, expansion modeling, advanced exec/AI.
6. **Phase 7+ moonshot expansion:** resident assurance / rounding, regulatory intelligence, digital twin, ambient intelligence, and AI operating systems after completion-first tracks are closed.

**~30-day standalone wedge** in the roadmap: mobile incident reporting + multi-facility census dashboard + basic family comms—**still subject to your phase handoffs**, not auto-built from this summary.

---

## Strategic moat (why the roadmap matters)

Multi-entity architecture, insurance + clinical loop, AI-native workflows, **Florida ALF specificity**, operator-grounded design—competitive story is in the full doc.

---

## Implementation status in this repo (not the external roadmap file)

*Last refreshed: 2026-04-10.* Track D D1–D84 shipped; migration parity 001–120 confirmed.

| Module | Spec File | Spec Status | Build Status |
|--------|-----------|-------------|--------------|
| 00 — Foundation | `00-foundation.md` | FULL | Core shipped |
| 00 — Foundation Regulatory | `00-foundation-regulatory.md` | PARTIAL | Core shipped |
| 01 — Referral & Inquiry | `01-referral-inquiry.md` | PARTIAL + COL notes | Core shipped — Phase 4 migrations `075`–`076` + Track D referral pipeline (D65–D72) |
| 02 — Admissions | `02-admissions-move-in.md` | PARTIAL + COL notes | Core shipped — Phase 4 migrations `077`–`078`; UI routes live |
| 03 — Resident Profile | `03-resident-profile.md` | FULL | Core shipped |
| 03 — Resident Profile Advanced | `03-resident-profile-advanced.md` | PARTIAL | Core shipped |
| 04 — Daily Operations | `04-daily-operations.md` | FULL | Core shipped |
| 04 — Daily Operations Offline | `04-daily-operations-offline.md` | STUB | Pending — PWA offline beyond `054` deferred |
| 05 — Discharge & Transition | `05-discharge-transition.md` | PARTIAL + COL notes | Core shipped — Phase 4 migrations `079`–`080`; UI routes live |
| 06 — Medication Management | `06-medication-management.md` | FULL | Core shipped |
| 07 — Incident Reporting | `07-incident-reporting.md` | FULL + COL notes | Core shipped |
| 08 — Compliance Engine | `08-compliance-engine.md` | FULL + COL notes | Core shipped |
| 09 — Infection Control | `09-infection-control.md` | FULL + COL notes | Core shipped |
| 10 — Quality Metrics | `10-quality-metrics.md` | PARTIAL + COL notes | Core shipped — Phase 5 migrations `081`–`082`; UI routes live |
| 11 — Staff Management | `11-staff-management.md` | FULL + COL notes | Core shipped + Track D (D29–D37, D60, D79–D84): roster/certs/schedules/shifts/time-records CSVs, filters, bulk approve, shift swap approve/deny |
| 12 — Training & Competency | `12-training-competency.md` | PARTIAL (promoted from STUB) | Core shipped — migrations `086`–`087`, `115`–`118`; Track D (D2, D20–D21, D38–D43): catalog, completions, inservice, PDF upload, CSVs |
| 13 — Payroll Integration | `13-payroll-integration.md` | STUB | Core shipped (CSV handoff) — migration `088`; Track D (D17–D18, D26, D58–D59, D64, D69, D73–D74): batch mgmt, time import, mileage import, vendor handoff CSV, hours split CSV. Vendor API blocked — COL payroll vendor unknown |
| 14 — Dietary & Nutrition | `14-dietary-nutrition.md` | PARTIAL (promoted from STUB) | Core shipped — migration `089`; Track D (D3, D13, D23, D50–D55, D77): clinical review, IDDSI med–diet hints, CSVs, filters, redirects |
| 15 — Transportation | `15-transportation.md` | PARTIAL (promoted from STUB) | Core shipped — migration `090`, `112`–`114`; Track D (D1, D10, D14–D15, D24–D25, D56–D57, D61–D63, D66, D76, D78): calendar (week+month), .ics, mileage approvals, Google/Outlook links, CSVs, filters |
| 16 — Billing & Collections | `16-billing.md` | FULL + COL notes | Core shipped |
| 17 — Entity Finance | `17-entity-facility-finance.md` | PARTIAL + COL notes | Core shipped |
| 18 — Insurance & Risk | `18-insurance-risk-finance.md` | PARTIAL + COL notes | Core shipped |
| 19 — Vendor Management | `19-vendor-contract-management.md` | PARTIAL + COL notes | Core shipped — migration `046`; 12 admin routes live |
| 21 — Family Portal | `21-family-portal.md` | PARTIAL + COL notes | Core shipped — Phase 5 migrations `083`–`084`; UI routes live |
| 22 — Referral CRM | `22-referral-crm.md` | PARTIAL + COL notes | Core shipped — migration `091`; Track D (D4, D12, D16, D22, D27, D65–D72): HL7 Edge processor, pipeline filters/search, Copy raw, CSVs |
| 23 — Reputation | `23-reputation.md` | PARTIAL + COL notes | Core shipped — migration `092`, `119`; Track D (D4, D19, D28, D44–D49, D75): Google OAuth, manual+cron import, Yelp Fusion, reply posting (Google+Yelp), CSVs |
| 24 — Executive Intelligence | `24-executive-intelligence.md` | FULL + COL notes | Core shipped |
| 24 — Executive Intelligence v2 | `24-executive-v2.md` | STUB | Pending — NLQ/scenarios deferred |
| 25 — Resident Assurance Engine | `25-resident-assurance-engine.md` | PARTIAL + COL notes | In progress — migrations `098`–`109` in repo; full roadmap per owner priority |
| 26 — Reporting Module | `26-reporting-module.md` | STUB | Pending — skeleton only |

**Spec status key:**
- `FULL` — Complete: DDL, RLS, API contracts, UI screens, business rules, edge functions
- `PARTIAL` — Incomplete: core schema present, some sections missing
- `STUB` — Skeleton only: table definitions but minimal workflow or UI design
- `+ COL notes` — COL-specific alignment notes appended (April 8, 2026 pass)
- `(promoted from STUB)` — Enriched with COL wiki operational context on April 8, 2026

**Build status key:**
- `Core shipped` — Migration applied, primary UI live, gates passed (Track D enhancements noted where applicable)
- `In progress` — Active build or hardening
- `Pending` — Spec needs more work or COL data before build starts
- `Blocked` — Cannot proceed without specific external input (noted in cell)

**COL Wiki & Roadmap Gap Analysis** (`docs/haven-gap-analysis.docx`) — produced April 8, 2026. Contains:
- Full spec status audit across all 30 modules
- Wiki domain coverage assessment (8 domains)
- 21 prioritized items to collect from COL (5 CRITICAL, 9 HIGH, 7 MEDIUM)
- 10 spec misalignments to correct before Oakridge pilot

### Completion-first sequencing

Current position: **closeout + acceptance before expanding scope.** Track D (D1–D84) has completed the Phase 6 completion pass for modules 11, 12, 13, 14, 15, 22, 23. Do not start new modules until:

1. **Phase 1 acceptance closeout** — A1+A2 done (2026-04-09); A3 real-auth UAT depth, A4 env/seed, A5 Pro/BAA/PITR, A6 waiver review remain. See `TRACK-A-CLOSEOUT-ROADMAP.md`.
2. **Phases 3–6 formal acceptance** — 47 UAT rows across 5 phase checklists, all PENDING owner walkthrough. See `PHASE3-6-ACCEPTANCE-EXECUTION-LOG.md`.
3. **COL document collection** — 21 items identified in `docs/haven-gap-analysis.docx`. 5 CRITICAL items must be collected before compliance engine and admission modules can be fully activated.
4. **Track D Enhanced backlog (D85+)** — optional staged improvements per `TRACK-D-ENHANCED-BACKLOG-PLAN.md`, one bounded slice at a time, owner priority.
5. **Then** resume: Resident Assurance Engine (25), then remaining strategic/moonshot modules (Track E, migration `121+`).

Use these delivery states consistently: **Spec written → Core shipped → Operationally hardened → Acceptance complete.**

---

## How coding agents should use this

1. **Align** feature work with the **mission** in `docs/mission-statement.md` / `AGENTS.md` / `agents/registry.yaml`.
2. **Prefer** the **phase/module specs the owner hands you** over this overview.
3. **Do not** invent scope for modules not yet specified in the current phase.
