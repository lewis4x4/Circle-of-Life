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

**Non-goals (Core):** Yelp OAuth, automated review fetch, posting replies via platform APIs, or AI-generated reply text — **D44** adds **owner-only Google OAuth token storage** for future Business Profile use; review ingestion remains Enhanced / follow-up.

**Shipped (Track D19):** **`/admin/reputation`** — **Download replies CSV** (client-side export, up to **500** rows per facility with listing label and platform); does **not** call external review APIs.

**Shipped (Track D28):** **`/admin/reputation`** — **Download accounts CSV** (up to **500** **`reputation_accounts`** rows per facility: label, platform, place id, notes, audit columns). **No** OAuth, **no** new DDL.

### Track D — D44 Google OAuth (integrations) (2026-04-10)

**Purpose:** Let the **organization owner** connect a Google account for **future** Business Profile / review API use without exposing tokens to the browser.

- **Route:** **`/admin/reputation/integrations`** — status (env + connection), **Connect Google** (starts OAuth), **Disconnect** (deletes stored credentials).
- **API:** `GET /api/reputation/oauth/google` → Google consent; `GET /api/reputation/oauth/google/callback` → token exchange + upsert; `GET /api/reputation/integrations/status`; `DELETE /api/reputation/integrations/google`.
- **Migration `119`:** **`reputation_google_oauth_credentials`** — one row per org (`organization_id` PK); **RLS enabled with no policies** so only **service role** (Next.js route handlers) can read/write tokens.
- **Server env (never commit values):** `REPUTATION_GOOGLE_CLIENT_ID`, `REPUTATION_GOOGLE_CLIENT_SECRET`, `REPUTATION_GOOGLE_REDIRECT_URI` (must match Google Cloud OAuth client **exactly**, e.g. `https://<host>/api/reputation/oauth/google/callback`), `REPUTATION_OAUTH_STATE_SECRET` (min 16 chars, HMAC for OAuth `state`). Optional: `NEXT_PUBLIC_SITE_URL` for redirect base in production.
- **Out of scope (defer):** Scheduled review fetch, Yelp OAuth, posting replies via API — tokens are stored for follow-up segments.

---

## RLS (normative)

- **SELECT:** `organization_id = haven.organization_id()`, `deleted_at IS NULL`, `facility_id` in **`haven.accessible_facility_ids()`**; roles `owner`, `org_admin`, `facility_admin`, `nurse`.
- **INSERT / UPDATE:** Same facility guard; same roles (operational marketing/comms aligned with referral intake).

---

## Definition of done

- Migration `092` applies; types updated; segment gates **PASS** when UI ships.
