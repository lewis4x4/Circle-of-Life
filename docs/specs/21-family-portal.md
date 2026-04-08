# 21 — Family Portal (Phase 5)

**Module:** Family Portal — consent attestations, clinical triage on family messages, care conference scheduling metadata  
**Dependencies:** [`00-foundation.md`](00-foundation.md), [`003_user_rbac.sql`](../../supabase/migrations/003_user_rbac.sql) (`family_resident_links`), [`032_family_portal_messages.sql`](../../supabase/migrations/032_family_portal_messages.sql)  
**Migrations:** `083_family_portal_module_schema.sql`, `084_family_portal_module_rls_audit.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/family-portal`

---

## Implementation note (repo migrations vs spec SQL)

Applied migrations use **`haven.organization_id()`**, **`haven.app_role()`**, **`haven.accessible_facility_ids()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log` per [`004_haven_rls_helpers.sql`](../../supabase/migrations/004_haven_rls_helpers.sql) and [`006_audit_triggers.sql`](../../supabase/migrations/006_audit_triggers.sql).

---

## Purpose

- **`family_consent_records`:** Immutable-leaning attestations (document type + version, signer, resident) for HIPAA acknowledgments, photo sharing, **recording consent**, etc.
- **`family_message_triage_items`:** Staff queue rows tied to **`family_portal_messages`** with **`matched_keywords`** (populated by application logic initially; **DB trigger** keyword matching is **Enhanced**).
- **`family_care_conference_sessions`:** Scheduled sessions, status, **recording consent** timestamps, optional **`external_room_id`** placeholder for vendor/WebRTC — **no in-app WebRTC** in Core.

---

## Scope tiers

### Core (ship first)

- Three tables + enums; RLS; audit/`updated_at`; admin hub lists (read-heavy).

### Enhanced (defer)

- **`INSERT` trigger** on `family_portal_messages` to auto-create triage rows when body matches org keyword list.
- WebRTC embed, recording storage, **`family_portal_messages.encryption_key_id`** (see `README.md` deferred-items table).

### Non-goals (v1)

- Replacing the **`/family/*`** resident-family UX; admin surface complements it.

---

## DATABASE (Core)

See migrations **`083`** / **`084`**.

---

## RLS (normative)

- **Family role:** `SELECT`/`INSERT` on own **`family_consent_records`** via **`family_resident_links`**; `SELECT` on **`family_care_conference_sessions`** for linked residents.
- **Staff:** Facility-scoped access for triage and conferences; consent records readable in facility context.
- **`family_message_triage_items`:** Staff-only (clinical queue), no family `SELECT`.

---

## Definition of done (Core segment)

- Migrations apply; types updated; `npm run segment:gates -- --segment "<id>" --ui` **PASS** when admin UI ships.

## COL Alignment Notes

**Family handbook and welcome packet not collected:** COL's family handbook and welcome packet content are not documented in the wiki. The Family Portal's onboarding flow and information library must reflect COL's actual family-facing content. Before the Family Portal launches, collect: (1) current family handbook, (2) welcome packet, (3) facility-specific visitor policies (`Visitor Notice.pdf` exists in HR-Forms).

**Resident rights documentation required:** FL §429.28 mandates that resident rights be provided in writing at admission and posted in the facility. The Family Portal should display resident rights as a persistent, accessible section. The actual FL §429.28 rights text should be seeded as content — COL must confirm they have no facility-specific addenda to the standard rights.

**Grievance procedure in the portal:** COL uses a formal `Grievance Form.pdf` and `Grievance Reports Log.pdf`. The Family Portal's message triage feature should support formal grievance submission with a dedicated `message_type = 'grievance'` that triggers the Module 07 grievance workflow (10-day acknowledgment, 21-day resolution timeline per FL §429.28(3)).

**HIPAA consent before portal access:** COL's existing admission consent process includes HIPAA authorization. The `family_consent_records` table in Module 21 must align with COL's existing HIPAA consent forms used at admission — don't require a second HIPAA consent if one was already obtained at admission. The admission consent should be linkable to the family portal consent record.

**Care conference scheduling:** COL uses a `Care Plan Meeting Summary.pdf` for ISP meetings. The Module 21 care conference scheduling feature should produce a summary document compatible with COL's existing form format so administrators don't need to re-document meetings in a separate system.
