# 18 — Insurance & Risk Finance (Phase 3)

**Dependencies:** `00-foundation`, `07-incident-reporting`, `11-staff-management`, `16-billing`, `17-entity-facility-finance`  
**Build weeks (target):** 23–24 (Core slice 1); Enhanced/Future as below  
**Migration sequence:** `044_*` (first migration for this module; follows `043_gl_budget_lines.sql`)

---

## Implementation note (repo migrations vs spec SQL)

- Spec snippets use `auth.organization_id()`, `auth.accessible_facility_ids()`, `auth.app_role()` for readability.
- **Migrations in this repo** implement equivalent policies using **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`** in schema `haven` (see [README.md](README.md)).
- Trigger functions: **`public.haven_set_updated_at()`** and **`public.haven_capture_audit_log()`** (see `006_audit_triggers.sql`).
- **Do not** commit real carrier names, broker contact details, or premium dollar amounts from external roadmaps — use generic placeholders in seeds and docs.

---

## Purpose and operator value

**Insurance & Risk Finance** gives multi-entity operators a **system of record for corporate insurance** (not resident LTC billing — that remains Module 16): policy inventory, renewal workflow, claims tied to incidents where applicable, premium allocation across facilities, certificate-of-insurance (COI) tracking, and workers’ compensation claim headers. It **integrates with Module 17** for GL posting of premiums and reserves.

**Operator outcomes (Core):**

- See all **entity-level policies** in one place with effective dates, limits, and renewal milestones.
- **Link claims** to `incidents` when the loss is operational; track reserves and payments in cents.
- **Allocate premium** to facilities for internal P&L / management reporting.
- **Track COIs** held from vendors, lenders, landlords with expiry alerts.
- **Workers’ comp** claim header + OSHA-relevant dates (detailed OSHA 300 log can be Enhanced).

**Non-goals (Core):** No carrier API integration; no automated ACORD PDF population; no premium finance loan servicing.

---

## Scope tiers

### Core (ship first)

- Tables: `insurance_policies`, `insurance_renewals`, `renewal_data_packages`, `insurance_claims`, `claim_activities`, `loss_runs`, `premium_allocations`, `certificates_of_insurance`, `workers_comp_claims`.
- RLS: `owner`, `org_admin` full CRUD where noted; `facility_admin` SELECT on rows scoped to accessible facilities / parent entity.
- Triggers: `haven_set_updated_at` + `haven_capture_audit_log` on all mutable financial/risk tables.
- Admin UI: routes in § Admin UI.
- **GL hooks:** optional columns on `entity_gl_settings` for `insurance_expense_gl_account_id`, `claims_reserve_gl_account_id` (nullable FKs to `gl_accounts`); `journal_entries.source_type` extended values `insurance_premium`, `insurance_claim_reserve` (application-posted only; no DB triggers on insurance tables in Core).

### Enhanced

- **Renewal data package** job: assemble JSON snapshot from census, staffing counts, incident aggregates, billing totals (read-only queries).
- **Total cost of risk** summary card (premiums + paid losses + reserves) per entity / rolling 12 months.
- **AI-assisted** renewal narrative draft from `renewal_data_packages.payload` (subordinate to human review; audit who published).

### Future

- Carrier portals / API feeds; automated loss run import; premium finance APR schedules; full OSHA 300/301 electronic submission.

---

## Relationship to other modules

| Module | Relationship |
|--------|----------------|
| 16 — Billing | Resident LTC / Medicaid / private pay billing unchanged. Optional future FK from `insurance_claims` to billing if payer-of-record workflows merge — not Core. |
| 17 — Finance | Premium and reserve movements post via `journal_entries` + lines; `entity_id` aligns with policies. |
| 7 — Incidents | `insurance_claims.incident_id` nullable FK to `incidents.id` |

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- ENUMS (add in migration if not present)
-- ============================================================
CREATE TYPE insurance_policy_type AS ENUM (
  'general_liability',
  'property',
  'workers_comp',
  'auto',
  'umbrella',
  'directors_officers',
  'cyber',
  'epli',
  'professional',
  'other'
);

CREATE TYPE insurance_policy_status AS ENUM (
  'draft',
  'active',
  'expired',
  'cancelled',
  'pending_renewal'
);

CREATE TYPE insurance_renewal_status AS ENUM (
  'upcoming',
  'in_progress',
  'bound',
  'expired',
  'declined'
);

CREATE TYPE insurance_claim_status AS ENUM (
  'reported',
  'investigating',
  'reserved',
  'partially_paid',
  'closed',
  'denied',
  'withdrawn'
);

CREATE TYPE coi_holder_type AS ENUM (
  'vendor',
  'landlord',
  'lender',
  'other'
);

-- ============================================================
-- INSURANCE POLICIES (entity-level)
-- ============================================================
CREATE TABLE insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),

  policy_type insurance_policy_type NOT NULL,
  carrier_name text NOT NULL,
  broker_name text,
  policy_number text NOT NULL,
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  status insurance_policy_status NOT NULL DEFAULT 'active',

  aggregate_limit_cents integer,
  occurrence_limit_cents integer,
  deductible_cents integer,
  premium_cents integer,
  premium_period text,

  notes text,
  document_storage_path text,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_insurance_policies_org ON insurance_policies (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_insurance_policies_entity ON insurance_policies (entity_id, expiration_date)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_insurance_policies_expiry ON insurance_policies (organization_id, expiration_date)
WHERE
  deleted_at IS NULL
  AND status = 'active';

-- ============================================================
-- RENEWAL DATA PACKAGES (snapshot for renewal workflow)
-- ============================================================
CREATE TABLE renewal_data_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  insurance_policy_id uuid NOT NULL REFERENCES insurance_policies (id),

  generated_at timestamptz NOT NULL DEFAULT now (),
  period_start date NOT NULL,
  period_end date NOT NULL,

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_renewal_data_packages_policy ON renewal_data_packages (insurance_policy_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- INSURANCE RENEWALS
-- ============================================================
CREATE TABLE insurance_renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  insurance_policy_id uuid NOT NULL REFERENCES insurance_policies (id),
  renewal_data_package_id uuid REFERENCES renewal_data_packages (id),

  target_effective_date date NOT NULL,
  status insurance_renewal_status NOT NULL DEFAULT 'upcoming',
  milestone_120_date date,
  milestone_90_date date,
  milestone_60_date date,
  milestone_30_date date,

  quoted_premium_cents integer,
  bound_premium_cents integer,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_insurance_renewals_policy ON insurance_renewals (insurance_policy_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- INSURANCE CLAIMS (corporate / GL — not resident LTC claims)
-- ============================================================
CREATE TABLE insurance_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),
  facility_id uuid REFERENCES facilities (id),
  insurance_policy_id uuid REFERENCES insurance_policies (id),
  incident_id uuid REFERENCES incidents (id),

  claim_number text,
  date_of_loss date,
  reported_at timestamptz,
  status insurance_claim_status NOT NULL DEFAULT 'reported',

  reserve_cents integer NOT NULL DEFAULT 0 CHECK (reserve_cents >= 0),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),

  adjuster_name text,
  description text,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_insurance_claims_org ON insurance_claims (organization_id, date_of_loss DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_insurance_claims_incident ON insurance_claims (incident_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- CLAIM ACTIVITIES
-- ============================================================
CREATE TABLE claim_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  insurance_claim_id uuid NOT NULL REFERENCES insurance_claims (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id),

  activity_date date NOT NULL,
  activity_type text NOT NULL,
  description text NOT NULL,
  performed_by uuid NOT NULL REFERENCES auth.users (id),

  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX idx_claim_activities_claim ON claim_activities (insurance_claim_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- LOSS RUNS (generated summaries)
-- ============================================================
CREATE TABLE loss_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid NOT NULL REFERENCES entities (id),

  period_start date NOT NULL,
  period_end date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now (),

  total_claims_count integer NOT NULL DEFAULT 0,
  total_paid_cents bigint NOT NULL DEFAULT 0,
  total_reserve_cents bigint NOT NULL DEFAULT 0,

  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_loss_runs_entity ON loss_runs (entity_id, period_end DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- PREMIUM ALLOCATIONS (policy → facility)
-- ============================================================
CREATE TABLE premium_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  insurance_policy_id uuid NOT NULL REFERENCES insurance_policies (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),

  allocation_method text NOT NULL DEFAULT 'bed_count'
    CHECK (allocation_method IN ('bed_count', 'revenue_share', 'manual', 'custom')),

  allocation_percent numeric(6, 3),
  allocated_premium_cents integer NOT NULL DEFAULT 0 CHECK (allocated_premium_cents >= 0),

  period_start date NOT NULL,
  period_end date NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_premium_allocations_policy ON premium_allocations (insurance_policy_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_premium_allocations_facility ON premium_allocations (facility_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- CERTIFICATES OF INSURANCE (third-party certs we track)
-- ============================================================
CREATE TABLE certificates_of_insurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  entity_id uuid REFERENCES entities (id),

  holder_name text NOT NULL,
  holder_type coi_holder_type NOT NULL DEFAULT 'other',

  carrier_name text NOT NULL,
  policy_number text,
  effective_date date NOT NULL,
  expiration_date date NOT NULL,

  additional_insured boolean NOT NULL DEFAULT false,
  waiver_of_subrogation boolean NOT NULL DEFAULT false,
  aggregate_limit_cents integer,

  document_storage_path text,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_coi_expiry ON certificates_of_insurance (organization_id, expiration_date)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- WORKERS COMP CLAIMS (header — not full OSHA 300 in Core)
-- ============================================================
CREATE TABLE workers_comp_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  staff_id uuid REFERENCES staff (id),

  claim_number text,
  injury_date date NOT NULL,
  status insurance_claim_status NOT NULL DEFAULT 'reported',

  first_report_filed_at timestamptz,
  modified_duty_start date,
  modified_duty_end date,
  return_to_work_date date,

  reserve_cents integer NOT NULL DEFAULT 0 CHECK (reserve_cents >= 0),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),

  description text,

  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_workers_comp_facility ON workers_comp_claims (facility_id, injury_date DESC)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- ENTITY GL SETTINGS EXTENSION (Module 17)
-- ============================================================
-- Migration adds nullable columns to entity_gl_settings:
--   insurance_expense_gl_account_id uuid REFERENCES gl_accounts(id)
--   claims_reserve_gl_account_id uuid REFERENCES gl_accounts(id)
```

---

## RLS POLICIES (policy intent — translate to `haven.*` in migrations)

**Roles:**

| Role | insurance_policies, renewals, packages, claims, loss_runs, premium_allocations, coi, workers_comp |
|------|-----------------------------------------------------------------------------------------------------|
| `owner`, `org_admin` | Full CRUD within `organization_id` |
| `facility_admin` | SELECT on rows where `facility_id` is null OR in accessible facilities; SELECT on `premium_allocations` / `workers_comp_claims` / `insurance_claims` scoped to accessible facilities; **no** INSERT/UPDATE/DELETE on policies (Core) |
| Others | No access |

**claim_activities:** SELECT/INSERT/UPDATE/DELETE only when parent `insurance_claims` is visible and user is owner/org_admin; facility_admin SELECT if parent claim’s `facility_id` is accessible.

Enable RLS on every table above; policies follow `organization_id = haven.organization_id()` and soft-delete filter.

---

## Audit and updated_at

- All tables except `claim_activities` (append-only log style): `BEFORE UPDATE` → `haven_set_updated_at`; `AFTER INSERT/UPDATE/DELETE` → `haven_capture_audit_log` where applicable.
- `claim_activities`: audit on INSERT; optional soft-delete for mistaken entries (Core: INSERT only from app).

---

## Admin UI (routes)

Add to [FRONTEND-CONTRACT.md](FRONTEND-CONTRACT.md) when implementing:

| Route | Purpose |
|-------|---------|
| `/admin/insurance` | Hub: policy summary, renewal timeline teaser, open claims count |
| `/admin/insurance/policies` | List policies; filters by entity, status, expiry |
| `/admin/insurance/policies/new` | Create policy |
| `/admin/insurance/policies/[id]` | Policy detail: renewals, allocations, linked claims |
| `/admin/insurance/renewals` | Renewals list / milestone view |
| `/admin/insurance/claims` | Claims list; link to incident when present |
| `/admin/insurance/claims/[id]` | Claim detail + activities |
| `/admin/insurance/loss-runs` | Generate and list loss runs; export CSV/PDF |
| `/admin/insurance/coi` | Certificates of insurance list; expiry alerts |
| `/admin/insurance/workers-comp` | WC claims dashboard |

**Facility scoping:** facility selector applies to claims, WC, allocations views; entity selector for policy inventory.

---

## Edge Functions (optional Core)

| Function | Trigger | Logic |
|----------|---------|-------|
| `insurance-renewal-milestones` | Cron daily | Update renewal milestone dates; enqueue notifications (email later) |
| `assemble-renewal-data-package` | Manual / API | Build `renewal_data_packages.payload` from queries (Enhanced) |

---

## Acceptance criteria (Core)

1. Migration `044_*` creates enums and tables, indexes, RLS enabled, audit/`updated_at` triggers.
2. **owner** / **org_admin** can CRUD policies, renewals, claims, allocations, COIs, WC headers; **facility_admin** can read scoped data as above.
3. `insurance_claims.incident_id` optional link works when incident exists; no orphan requirement.
4. Money fields are integer cents; soft deletes only.
5. `npm run migrations:check` and `npm run migrations:verify:pg` pass.
6. Segment gate with `--ui` passes for new Admin routes under `/admin/insurance/*`.

---

## Spec summary (for handoff)

**Insurance & Risk Finance** adds **entity-level corporate insurance** inventory, **renewal workflow**, **claims** (optionally tied to incidents), **premium allocation**, **COI tracking**, and **workers’ comp headers**, with **GL integration points** to Module 17 and **RLS** aligned to the org/facility hierarchy.

**Exact Core scope:** tables in § DATABASE SCHEMA; admin routes in § Admin UI; no carrier APIs in Core.
