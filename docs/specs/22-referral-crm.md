# 22 — Referral Source CRM (Phase 6)

**Module:** Hospital and partner feeds into the referral pipeline  
**Dependencies:** [`01-referral-inquiry.md`](01-referral-inquiry.md) (`referral_sources`, `referral_leads`)  
**Migration:** `091_referral_hl7_inbound.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/referrals/hl7-inbound`

---

## Implementation note (repo migrations vs spec SQL)

Migration uses **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## Purpose (Core)

- **`referral_hl7_inbound`:** Durable queue for HL7 v2 ADT-style payloads (raw text), processing status, optional HL7 message control id (MSH-10) for deduplication, and optional link to a **`referral_leads`** row once reconciled.

**Non-goals (Core):** Full HL7 parser, MLLP listener, or automatic lead creation (Enhanced / integration).

---

## Scope tiers

### Core

- Queue table + enums + RLS + audit; admin list + manual ingest form under Referrals.

### Enhanced

- Edge ingress (MLLP/HTTPS), ADT segment parsing, auto-draft leads, idempotent replay.

**Shipped (Track D12):** Edge Function **`process-referral-hl7-inbound`** — for **`pending`** queue rows, minimal **MSH** parse (message type + control id + trigger from `MSH-9`); updates status to **`processed`** / **`failed`** and **`parse_error`** codes; does **not** auto-create **`referral_leads`**.

**Shipped (Track D16):** **`/admin/referrals/hl7-inbound`** — **Draft lead** on **`processed`** rows without **`linked_referral_lead_id`**: inserts **`referral_leads`** with **`external_reference`** = `hl7:{inbound_row_id}`, optional **PID-5** name via `tryParsePid5Name`, sets **`linked_referral_lead_id`**. Manual only (not triggered by the Edge Function).

**Shipped (Track D22):** **`/admin/referrals/hl7-inbound`** — **Download queue CSV** (up to **500** rows for the selected facility), including **`raw_message`** for partner or archive handoff. **No** MLLP, **no** auto-leads.

**Shipped (Track D65):** Same route — **Copy raw** per row (full **`raw_message`** to clipboard) for quick partner handoff without downloading CSV.

**Shipped (Track D67):** Same route — **status** filter (**All** / **pending** / **processed** / **failed** / **ignored**) on the loaded queue; client-side list filter only.

**Shipped (Track D68):** Same route — **Download queue CSV** applies the selected **status** when not **All** (up to **500** rows server-filtered); filename includes **`_<status>`** when filtered.

**Shipped (Track D27):** **`/admin/referrals`** — **Download leads CSV** (up to **500** **`referral_leads`** rows for the selected facility, **`referral_sources(name)`** join). **No** new DDL.

**Shipped (Track D70):** Same hub — **status** filter on the loaded pipeline list (**All** + each **`referral_lead_status`**); **Showing N of M**; **Download leads CSV** applies the same filter server-side when not **All** (up to **500**); filename **`_<status>`** when filtered.

---

## RLS (normative)

Aligned with **`referral_leads`** (`076_referral_inquiry_rls_audit.sql`):

- **SELECT:** `organization_id = haven.organization_id()`, `deleted_at IS NULL`, `facility_id` in **`haven.accessible_facility_ids()`**.
- **INSERT / UPDATE:** Same facility guard; roles `owner`, `org_admin`, `facility_admin`, `nurse`.

---

## Definition of done

- Migration `091` applies; types updated; segment gates **PASS** when UI ships.
