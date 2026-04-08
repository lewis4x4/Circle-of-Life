# 01 — Referral and Inquiry (Phase 4)

**Module:** Referral and Inquiry — CRM-style pipeline before admission  
**Dependencies:** [`00-foundation.md`](00-foundation.md), [`03-resident-profile.md`](03-resident-profile.md) (`residents` including `resident_status` with `inquiry`)  
**Migrations:** `075_referral_inquiry_schema.sql`, `076_referral_inquiry_rls_audit.sql` (split: DDL + indexes first; RLS, triggers, FK to `residents`, comments second)  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — add `/admin/referrals/*` when implemented.

---

## Implementation note (repo migrations vs spec SQL)

- Spec SQL uses `auth.users` / `auth.uid()` for readability. **Applied migrations** use **`haven.organization_id()`**, **`haven.app_role()`**, **`haven.accessible_facility_ids()`**, and `public.haven_set_updated_at` / audit patterns per [`004_haven_rls_helpers.sql`](../../supabase/migrations/004_haven_rls_helpers.sql) and [`006_audit_triggers.sql`](../../supabase/migrations/006_audit_triggers.sql).
- **`residents.referral_source_id`** exists without FK in [`009_residents.sql`](../../supabase/migrations/009_residents.sql). Migration **`075`** or **`076`** must add **`REFERENCES referral_sources(id)`** (nullable remains).

---

## Purpose and operator value

- Capture **inquiries and referrals** before a resident record is fully admitted: hospitals, agencies, families, web, and other channels.
- Support **source attribution** and reporting (“which channel fills beds”).
- Enforce **HIPAA minimum necessary** via explicit **`pii_access_tier`** on lead rows and matching RLS (not a substitute for BAA or training).
- **Core** delivers manual entry + pipeline + duplicate merge rules. **Enhanced** adds **HL7 v2 ADT** (and similar) inbound processing via the **existing** [`integration_inbound_queue`](../../supabase/migrations/063_infection_jurisdiction_labs.sql) table — **do not** create a second global inbound queue.

---

## Scope tiers

### Core (ship first)

- Tables: **`referral_sources`**, **`referral_leads`** (plus merge metadata columns).
- Admin UI: list, create, edit, status transitions, **merge duplicates** (owner/org_admin; optional facility_admin per policy below).
- RLS aligned to org + facility access.

### Enhanced

- **HL7 v2 ADT** (and FHIR-bridged payloads): enqueue to **`integration_inbound_queue`** with a documented `message_type` namespace; Edge Function or worker promotes to `referral_leads` / updates existing rows; idempotency via control ID in `payload_json` or dedupe key column (additive migration).
- Optional **`referral_lead_notes`** or activity stream table.

### Non-goals (v1)

- Full marketing CRM, paid ads attribution, or outbound campaign automation.
- Replacing **`search_documents`** / [`platform-search.md`](platform-search.md); optional trigger to index **non-PHI** lead labels only in Enhanced.

---

## ENUM TYPES

```sql
CREATE TYPE referral_lead_status AS ENUM (
  'new',
  'contacted',
  'tour_scheduled',
  'tour_completed',
  'application_pending',
  'waitlisted',
  'converted',
  'lost',
  'merged'
);

-- Minimum-necessary tier for lead row (policy enforcement in app + RLS helpers)
CREATE TYPE pii_access_tier AS ENUM (
  'public_summary', -- name fragment / channel only; no clinical
  'standard_ops', -- contact info for sales coordinator role
  'clinical_precheck' -- expanded for nurse review pre-admission
);
```

---

## DATABASE SCHEMA (Core)

```sql
-- ============================================================
-- REFERRAL SOURCES (master — ties to residents.referral_source_id)
-- ============================================================
CREATE TABLE referral_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id), -- NULL = org-wide source
  name text NOT NULL,
  source_type text NOT NULL, -- 'hospital', 'agency', 'family', 'web', 'other'
  external_id text, -- EHR or CRM id
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,
  CONSTRAINT referral_sources_org_name_active UNIQUE NULLS NOT DISTINCT (organization_id, name, deleted_at)
);

CREATE INDEX idx_referral_sources_org ON referral_sources (organization_id)
WHERE
  deleted_at IS NULL;

-- ============================================================
-- REFERRAL LEADS
-- ============================================================
CREATE TABLE referral_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  referral_source_id uuid REFERENCES referral_sources (id),
  status referral_lead_status NOT NULL DEFAULT 'new',
  pii_access_tier pii_access_tier NOT NULL DEFAULT 'standard_ops',

  -- Prospect (minimum necessary; expand only when tier allows)
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  date_of_birth date,
  phone text,
  email text,
  notes text,

  -- Conversion
  converted_resident_id uuid REFERENCES residents (id), -- set when status = converted
  converted_at timestamptz,

  -- Duplicate merge (canonical lead survives; merged row points to winner)
  merged_into_lead_id uuid REFERENCES referral_leads (id),
  merged_at timestamptz,
  merged_by uuid REFERENCES auth.users (id),

  -- Idempotency / external keys (Enhanced HL7)
  external_reference text, -- e.g. MRN + sending facility from ADT

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_referral_leads_facility_status ON referral_leads (facility_id, status)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_referral_leads_org_created ON referral_leads (organization_id, created_at DESC)
WHERE
  deleted_at IS NULL;

CREATE UNIQUE INDEX idx_referral_leads_dedupe_external ON referral_leads (organization_id, facility_id, external_reference)
WHERE
  deleted_at IS NULL
  AND external_reference IS NOT NULL;
```

---

## RLS (policy intent — implement with `haven.*` in migrations)

- **`referral_sources`:** `SELECT` for users whose app role may see the org; `INSERT/UPDATE/DELETE` for `owner`, `org_admin`; `facility_admin` may `SELECT` sources for their facilities or org-wide (`facility_id IS NULL`); optional `INSERT` for facility-scoped sources at their facilities (product choice — default: org_admin only for master data).
- **`referral_leads`:** `organization_id = haven.organization_id()`; facility scope: `facility_id IN (SELECT haven.accessible_facility_ids())` OR org-wide roles see all org facilities; **never** expose rows across organizations.
- **Tier enforcement:** RLS cannot encode all “tier” rules; application must filter columns by `pii_access_tier` and role. RLS blocks cross-org/cross-facility; add **optional** `haven` helper later if column-level projection is required.

---

## Business rules

1. **Status:** Only valid transitions (document state machine in UI); `converted` requires `converted_resident_id` and resident `status` appropriate (`inquiry` or `pending_admission`).
2. **Merge:** Only **`owner`** and **`org_admin`** may merge (default); `facility_admin` merge is **off** unless an org setting enables it (future table or `entity_gl_settings`-style flag — Enhanced).
3. **Duplicate detection (advisory):** Same `organization_id` + `facility_id` + normalized `phone` + `date_of_birth` suggests duplicate; soft-merge via `merged_into_lead_id`.
4. **Minimum necessary:** Roles without clinical pre-admission clearance see **`public_summary`** or **`standard_ops`** fields only in API responses (enforce in Next.js route handlers or RPC).

---

## Integration (Enhanced): HL7 v2 ADT → existing queue

Table **`integration_inbound_queue`** (already exists) columns include `source_system`, `message_type`, `payload_json`, `status`. **Convention:**

- `message_type`: prefix with `HL7_ADT_` + event (e.g. `HL7_ADT_A01`, `HL7_ADT_A04`) OR `REFERRAL_` for non-HL7 JSON bridges.
- Ingestion Edge Function (new): **service role** dequeue, parse, **idempotent** insert/update `referral_leads` using `external_reference` + `idx_referral_leads_dedupe_external`.
- **RLS:** Processing uses **service_role**; no broadening of `integration_inbound_queue` SELECT to facility roles without a separate security review.

---

## Admin UI (when implemented)

- **`/admin/referrals`** — pipeline or table; filters by facility, status, source.
- **`/admin/referrals/new`**, **`/admin/referrals/[id]`** — create/edit; merge action with confirmation.
- **`/admin/referrals/sources`** — optional CRUD for `referral_sources` (or embed in settings).

---

## API shape (illustrative)

- Server actions or route handlers under `src/app/api/referrals/*` or Supabase client from admin pages — **no PHI in client logs**.
- Merge: `POST` with `{ winner_lead_id, loser_lead_id }` transaction: set loser `merged_into_lead_id`, `status = merged`.

---

## Acceptance

1. Migrations `075` / `076` apply cleanly after `074`; `npm run migrations:check` passes.
2. **`residents.referral_source_id`** references **`referral_sources(id)`** where non-null.
3. Types in `src/types/database.ts` extended; RLS manual spot-check per [`PHASE1-RLS-MANUAL-PROCEDURE.md`](PHASE1-RLS-MANUAL-PROCEDURE.md) patterns if applicable.
4. Segment gates for the implementation segment: `npm run segment:gates -- --segment "phase4-referral-inquiry" --ui` when UI ships.
5. **Mission:** Referral data remains **subordinate to human decision-making** on admission; audit trail for merge and conversion.

---

## Cross-reference: README migration alignment

The Phase 4 row in [`README.md`](README.md) must list **`075`–`076`** (not `070`–`071`) until historical renumbering is done — see table update in the same PR as this spec.

## COL Alignment Notes

**Caring.com is an active referral source:** COL has an active contract with Caring.com (a paid senior living directory) in `Management/Agreements/Caring.com Contract.pdf`. Module 22 (Referral CRM) handles Caring.com's lead attribution in detail, but Module 01's `referral_sources` table must include Caring.com as a seeded source at org initialization with `source_type = 'paid_directory'` and `monthly_cost` populated from the contract.

**Tour tracking:** COL uses `Tour Satisfactory Forms` to document prospect facility tours. The referral inquiry module should model a `tour_scheduled` → `tour_completed` → `tour_follow_up` workflow as part of the lead pipeline. Tour satisfaction ratings feed into Module 23 (Reputation) metrics.

**Inquiry intake process not documented:** COL's formal inquiry intake process (how initial phone inquiries are handled, what information is collected, who handles them) is not documented in the wiki. Before building the Module 01 UI, collect COL's current inquiry intake workflow to ensure the form fields match what their staff currently capture.
