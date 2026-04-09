# 23 — Reputation & Online Presence (Phase 6)

**Module:** Connected listings and structured reply tracking for public reviews  
**Dependencies:** [`00-foundation-regulatory.md`](00-foundation-regulatory.md) (organizations, facilities, auth users)  
**Migration:** `092_reputation.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/reputation`

---

## Implementation note (repo migrations vs spec SQL)

Migration uses **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## Purpose (Core)

- **`reputation_accounts`:** Facility-scoped connectors for external review surfaces (platform label, optional external place/listing id, notes).
- **`reputation_replies`:** Draft or posted reply text, optional excerpt of the review being addressed, **`posted_by_user_id`** for auditability, and workflow status.

**Non-goals (Core):** OAuth to Google/Yelp APIs, automated review fetch, or AI-generated reply text (Enhanced / integration).

**Shipped (Track D19):** **`/admin/reputation`** — **Download replies CSV** (client-side export, up to **500** rows per facility with listing label and platform); does **not** call external review APIs.

---

## RLS (normative)

- **SELECT:** `organization_id = haven.organization_id()`, `deleted_at IS NULL`, `facility_id` in **`haven.accessible_facility_ids()`**; roles `owner`, `org_admin`, `facility_admin`, `nurse`.
- **INSERT / UPDATE:** Same facility guard; same roles (operational marketing/comms aligned with referral intake).

---

## Definition of done

- Migration `092` applies; types updated; segment gates **PASS** when UI ships.
