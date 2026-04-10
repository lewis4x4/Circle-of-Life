# FACILITY ADMIN PORTAL — Complete Build Handoff
## LLM-Optimized Technical Spec | Paperclip Pipeline Ready

**blueprint_id:** blueprint-col-facility-admin-portal-2026-04-10
**client:** Circle of Life
**generated:** 2026-04-10
**status:** READY FOR BUILD
**estimated_effort:** L (80–110 hours)

> **FOR AGENTS**: Read this BEFORE touching any code. This document is the single source of truth for the Facility Admin Portal feature. Every file referenced below already exists in the codebase — your job is to integrate, test, and polish.

---

## WHAT THIS IS

A centralized admin portal at `/admin/facilities/` where owner/org_admin users manage every operational dimension of each ALF location. 12-tab interface covering licensing, effective-dated rates, building profiles, emergency contacts, vendor assignments, document vault, staffing config, communication settings, alert thresholds, audit trail, and facility timeline.

---

## FILE MANIFEST

### Database (1 file)
```
supabase/migrations/131_facility_admin_portal.sql
  ├── btree_gist extension enable
  ├── ALTER TABLE facilities (7 new columns)
  ├── ALTER TABLE entities (3 new columns)
  ├── CREATE TABLE facility_emergency_contacts
  ├── CREATE TABLE facility_documents
  ├── CREATE TABLE rate_schedule_versions (EXCLUDE constraint for no-overlap)
  ├── CREATE TABLE facility_operational_thresholds
  ├── CREATE TABLE facility_audit_log (append-only)
  ├── CREATE TABLE facility_survey_history
  ├── CREATE TABLE facility_building_profiles (1:1)
  ├── CREATE TABLE facility_communication_settings (1:1)
  ├── CREATE TABLE facility_timeline_events
  ├── CREATE FUNCTION haven.facility_audit_trigger()
  ├── 8 audit triggers (one per config table)
  ├── SEED: building profiles for all 5 facilities
  ├── SEED: 55+ emergency contacts (county-specific + shared vendors)
  ├── SEED: default operational thresholds (11 types × 5 facilities)
  ├── SEED: default communication settings (5 facilities)
  └── Supabase Storage bucket: facility-documents (25MB limit, RLS)
```

### Constants & Validation (2 files)
```
src/lib/admin/facilities/facility-constants.ts
  ├── CONTACT_CATEGORIES (32 values + labels)
  ├── DOCUMENT_CATEGORIES (27 values + labels)
  ├── RATE_TYPES (13 values + labels)
  ├── THRESHOLD_TYPES (12 values + labels)
  ├── SURVEY_TYPES, SURVEY_RESULTS
  ├── TIMELINE_EVENT_TYPES (14 values)
  ├── CARE_SERVICES (4 values — NO 'memory_care')
  ├── CONSTRUCTION_TYPES, FIRE_SUPPRESSION_TYPES, GENERATOR_FUEL_TYPES
  ├── FACILITY_TABS (12 tabs + labels)
  ├── FL_COMPLIANCE_CONTACTS (hardcoded state numbers)
  └── ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES

src/lib/validation/facility-admin.ts
  ├── listFacilitiesQuerySchema
  ├── facilityDetailQuerySchema
  ├── updateFacilitySchema (.strict(), .refine())
  ├── createRateSchema
  ├── emergencyContactSchema
  ├── documentMetadataSchema
  ├── surveyHistorySchema (with citation_details array)
  ├── buildingProfileSchema (50+ fields)
  ├── communicationSettingsSchema
  ├── thresholdSchema
  ├── timelineEventSchema
  └── auditLogQuerySchema
```

### API Routes (11 files)
```
src/app/api/admin/facilities/
  ├── route.ts                              — GET list (paginated, filterable)
  └── [facilityId]/
      ├── route.ts                          — GET detail + PUT update
      ├── rates/route.ts                    — GET list + POST create (auto-close previous)
      ├── documents/route.ts                — GET list + POST multipart upload
      ├── emergency-contacts/route.ts       — GET list + POST create
      ├── surveys/route.ts                  — GET list + POST create
      ├── building-profile/route.ts         — GET + PUT upsert (1:1)
      ├── communication-settings/route.ts   — GET + PUT upsert (role-filtered fields)
      ├── thresholds/route.ts               — GET list + PUT bulk upsert
      ├── timeline/route.ts                 — GET list + POST create
      └── audit-log/route.ts                — GET only (owner/org_admin)
```

### React Hooks (5 files)
```
src/hooks/
  ├── useFacilities.ts       — list with filter/pagination
  ├── useFacility.ts         — single facility + updateFacility mutation
  ├── useFacilityRates.ts    — rates CRUD
  ├── useFacilityDocuments.ts — document vault + multipart upload
  └── useFacilityAuditLog.ts — paginated audit log with filters
```

### Pages (3 files)
```
src/app/(admin)/admin/facilities/
  ├── page.tsx                  — Facility list (grid of cards)
  └── [facilityId]/
      ├── layout.tsx            — Pass-through layout
      └── page.tsx              — Detail shell with tab nav
```

### Components (10 files)
```
src/components/admin/facilities/
  ├── FacilityCard.tsx          — List view card (occupancy, alerts, admin name)
  ├── FacilityHeader.tsx        — Detail header (name, status, entity, stats)
  ├── FacilityTabNav.tsx        — Horizontal scrollable tab bar
  ├── tabs/
  │   ├── OverviewTab.tsx       — Dashboard: occupancy gauge, census, alerts, contacts
  │   ├── RatesTab.tsx          — Rate table + add modal + history accordion
  │   ├── DocumentsTab.tsx      — Upload, categorize, expiration tracking
  │   └── AuditTab.tsx          — Paginated log with filters + CSV export
  └── shared/
      ├── OccupancyGauge.tsx    — Visual bar/circle gauge (green/yellow/red)
      ├── ExpirationBadge.tsx   — Color-coded days-to-expiry badge
      └── AlertCountBadge.tsx   — Red/yellow severity count badge
```

### Types (previously created)
```
src/types/
  ├── facility.ts               — FacilityRow, FacilityOverrides, enums
  ├── staff.ts                  — Extended StaffRole (14 new values)
  └── compliance.ts             — LegalEntity, FlStatute, BackgroundScreening
```

### Blueprint Spec
```
docs/specs/blueprint-col-facility-admin-portal.md
  — Full architectural spec with ADRs, security matrix, performance design
```

---

## CRITICAL BUILD RULES

### 1. NEVER use "Memory Care"
COL does NOT hold a Memory Care license. The correct term is **"Enhanced ALF Services"**. The enum value is `enhanced_alf_services`. The string "memory_care" is intentionally excluded from CHECK constraints, Zod schemas, and UI dropdowns. Violation = regulatory compliance risk.

### 2. Rate amounts are in CENTS
All `amount_cents` fields store integer cents, not dollars. `$5,500/month` = `550000`. This matches the existing `rate_schedules` table convention (migration 027). Display formatting: `(amount_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })`.

### 3. Effective-dated rates auto-close
When creating a new rate for a facility + rate_type combo, the API route auto-sets `effective_to = effective_from - 1 day` on the previous active version. The EXCLUDE constraint prevents overlapping date ranges. If the constraint fires (409), the client should display the conflict.

### 4. Audit log is append-only
No UPDATE or DELETE on `facility_audit_log`. The trigger is SECURITY DEFINER and non-blocking (EXCEPTION handler returns the row even if audit write fails). Never add UPDATE/DELETE policies to this table.

### 5. Document storage path convention
Files uploaded to Supabase Storage bucket `facility-documents` use path: `{facility_id}/{uuid}/{original_filename}`. The `facility_id` prefix enables RLS on the storage bucket via `storage.foldername()`.

### 6. Role-based field filtering on communication settings
`facility_admin` can update visitation and notification fields ONLY. Marketing fields (google_business_profile_url, yelp_listing_url, caring_com_profile_url, facebook_page_url, facility_tagline, key_differentiators, tour_*) are stripped server-side if the caller is not owner/org_admin.

### 7. Tables use `as never` cast
The 9 new tables are not in the auto-generated `database.ts` until `supabase gen types typescript` is re-run after migration. All `.from('table_name')` calls must use `as never` cast until types are regenerated.

---

## AUTHORIZATION MATRIX

| Action | owner | org_admin | facility_admin | manager | Other |
|--------|-------|-----------|----------------|---------|-------|
| View facility list | ✅ all | ✅ all | ✅ assigned | ✅ assigned | ❌ |
| View facility detail | ✅ all | ✅ all | ✅ assigned | ✅ limited | ❌ |
| Edit facility core | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage rates | ✅ | ✅ | ❌ | ❌ | ❌ |
| Upload documents | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit building profile | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit emergency contacts | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit comm settings | ✅ | ✅ | ✅ visit/notify | ❌ | ❌ |
| Edit thresholds | ✅ | ✅ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ |
| Add surveys/timeline | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## NAVIGATION INTEGRATION

Add to admin sidebar and dashboard:

```typescript
// src/lib/auth/dashboard-routing.ts — add to navGroups for owner/org_admin/facility_admin/manager
{
  label: 'Facilities',
  icon: 'Building2',
  href: '/admin/facilities',
  roles: ['owner', 'org_admin', 'facility_admin', 'manager'],
}
```

---

## SEED DATA SUMMARY

The migration seeds the following for all 5 existing COL facilities:

| Data Type | Oakridge | Homewood | Rising Oaks | Plantation | Grande Cypress |
|-----------|----------|----------|-------------|------------|----------------|
| Building profile | ✅ | ✅ | ✅ | ✅ | ✅ |
| Electric provider | Duke Energy | Duke Energy | Suwannee Valley | FPL | FPL |
| Gas provider | J&J Gas | J&J Gas | J&J Gas | GW Hunter | GW Hunter |
| Emergency contacts | 11 local + 8 shared | 11 local + 8 shared | 11 local + 8 shared | 11 local + 8 shared | 12 local + 8 shared |
| Transport vendors | 6 (inc Lafayette-only) | 6 (inc Lafayette-only) | 5 | 5 | 5 |
| Operational thresholds | 11 defaults | 11 defaults | 11 defaults | 11 defaults | 11 defaults |
| Communication settings | defaults | defaults | defaults | defaults | defaults |
| Survey result | no_citations | no_citations | no_citations | no_citations | no_citations |

---

## STILL REQUIRES CLIENT INPUT (Human Tasks)

These items CANNOT be built until Brian obtains from the Circle of Life owner:

| Item | Blocked Feature | Who |
|------|-----------------|-----|
| AHCA license numbers (5) | Licensing tab, compliance alerts | Brian → COL owner |
| AHCA license expirations (5) | License renewal countdown | Brian → COL owner |
| Plantation pharmacy vendor | Vendor assignments | Brian → COL owner |
| Plantation phone number | Facility core fields | Brian → COL owner |
| Grande Cypress phone number | Facility core fields | Brian → COL owner |
| Semi-Private rate confirmation ($4K vs $4.4K) | Rate seeding | Brian → COL owner |
| Homewood LLC vs LLLC | Entity name validation | Brian → Sunbiz check |

**None of these block the build.** The portal is fully functional without them — the fields accept NULL and display "Pending" badges. The owner populates them through the portal once obtained.

---

## BUILD SEQUENCE (Recommended)

```
PHASE 1 — Database (Segments 131a-131c)
  131a: Run migration (tables + triggers + storage bucket)
  131b: Verify seed data populated correctly
  131c: Regenerate database.ts types

PHASE 2 — API Layer (Segments 131d-131f)
  131d: Facility list + detail routes
  131e: Rate, document, emergency contact routes
  131f: Building profile, comm settings, thresholds, timeline, audit routes

PHASE 3 — Frontend (Segments 131g-131k)
  131g: FacilityCard, FacilityHeader, shared components
  131h: Facility list page + detail shell + tab nav
  131i: OverviewTab + RatesTab
  131j: DocumentsTab + AuditTab
  131k: Remaining tabs (Building, Emergency, Vendors, Staffing, Communication, Thresholds, Timeline)

PHASE 4 — Integration (Segments 131l-131m)
  131l: Nav integration (sidebar + dashboard)
  131m: Expiration scanner Edge Function (daily cron)

PHASE 5 — QA Gate
  131n: Segment gates for all routes + RLS verification + rate overlap tests
```

---

## DECISIONS LOG

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | Effective-dated rates with EXCLUDE constraint | Billing needs historical rates for Medicaid reconciliation | 2026-04-10 |
| 2 | Separate building profile table (not JSONB) | 50+ fields; don't bloat every facility SELECT | 2026-04-10 |
| 3 | Custom audit triggers (not pgaudit) | Need field-level diffs queryable by facility | 2026-04-10 |
| 4 | "Enhanced ALF Services" only, never "Memory Care" | COL lacks MC license — regulatory risk | 2026-04-10 |
| 5 | Supabase Storage for docs (not R2) | Built-in RLS integration, low volume | 2026-04-10 |
| 6 | No two-person rate approval | Per Brian — owner/org_admin entry sufficient | 2026-04-10 |
| 7 | Auto-seed building profiles from Storm Prep doc | Per Brian — populate known data at migration time | 2026-04-10 |
| 8 | Both in-app + email for critical expiration alerts | In-app for daily visibility, email for RED severity backup | 2026-04-10 |
| 9 | Audit triggers on new tables only (expand later) | Start contained, expand to beds/rooms/insurance in follow-up | 2026-04-10 |
