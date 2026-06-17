# Design — Resident Negotiated Billing Terms & Concession Tracking (Module 16)

**Status:** Proposed (implementable on current baseline)
**Author:** Design pass for COL / Homewood (requested by owner; primary operator = Michelle)
**Date:** 2026-06-17
**Module:** 16 — Resident Billing & Collections (`docs/specs/16-billing.md`)
**Mission alignment:** `pass` — Owner/admin financial visibility, staff clarity for the billing operator, full auditability of money decisions; AI-free, human-governed, regulation-safe. Strengthens "owner visibility" and "business operations on one role-governed data layer."

---

## 1. Context & Scope

### 1.1 The need (operator language)
Michelle runs billing for COL/Homewood. Two facts about ALF private-pay reality drive this design:

1. **Posted rates are a published card, not what every resident pays.** Each facility publishes a standard **private** rate and a **companion** (shared / semi-private) rate, plus level-of-care surcharges. These are the "rack rates."
2. **Almost every resident has a negotiated number.** Move-in incentives, financial-hardship reductions, legacy rate locks, length-of-stay loyalty, referral-partner pricing, or bundled/waived care charges mean the **actual monthly rent** differs from the posted rate. The difference is a **concession** the operator gives up — and today it is invisible.

Michelle needs, per resident:
- the **negotiated actual monthly rent** (the real number the responsible party owes),
- the **current balance** (outstanding AR),
- the **concession vs the standard private/companion rate** (how much we discounted, why, who approved it, and when it expires).

Owners/CFO need the roll-up: total concession given per facility/month, concession leakage trend, and which residents are billing off-rate.

### 1.2 What scope explicitly requires
- Standard facility **posted rates stay versioned and read-only** (a published rate card; changed only by superseding with a new version).
- Per-resident **negotiated actual rent/balance** tracked over time.
- **Concession** computed and reported against the standard **private** *and* **companion** tiers.

### 1.3 Current baseline (verified in repo)

| Concern | Today | Gap |
|---|---|---|
| Posted rates | `rate_schedules` (migration `027`), versioned via `effective_date`/`end_date`. Columns: `base_rate_private`, `base_rate_semi_private` (= companion), `care_surcharge_level_1/2/3`, fees. | Mutable via `admin_manage_rate_schedules` (`FOR ALL`) — **not read-only**. UI has no supersede flow. |
| Per-resident rate | `residents.monthly_base_rate / monthly_care_surcharge / monthly_total_rate / rate_effective_date` (migration `009`). | Flat, single-value, **un-versioned, un-audited, ignored by invoice generation**. No concept of standard-vs-negotiated or concession. |
| Payer split | `resident_payers` (who pays, Medicaid/LTC, share split). | Models *who pays*, not *negotiated rent vs posted*. |
| Invoices | `invoices` + `invoice_line_items` (`027`). Generator `src/lib/billing/generate-monthly-invoices.ts` + Edge twin `supabase/functions/_shared/billing/generate-monthly-invoices.ts`. | Bills straight from `rate_schedules.base_rate_private` + acuity surcharge. **No negotiated rate, no concession line, no off-rate visibility.** |
| Audit / RLS | `haven_capture_audit_log`, `haven_set_updated_at`; helpers `haven.organization_id()`, `haven.app_role()`, `haven.accessible_facility_ids()`, `haven.can_access_resident()`. Money in cents, soft-delete, UUID PKs. | Established — reuse verbatim. |
| Latest migration | `215_v2_admissions_list_view.sql`. | New work starts at **`216`**. |

**Design principle:** posted `rate_schedules` = the read-only baseline. A new **`resident_rate_agreements`** table = the versioned, audited, approvable negotiated contract. The invoice engine reads the agreement (falling back safely to posted rates), and renders concession as a transparent credit line so AR, revenue, and concession analytics all derive from invoice data with no special-casing.

---

## 2. Recommended Schema

Three migrations mirror the existing billing split (`027` schema / `028` RLS / `029` audit), plus one guard migration for posted-rate immutability.

### 2.1 Enums (migration `216`)

```sql
-- Lifecycle of a negotiated agreement version
CREATE TYPE rate_agreement_status AS ENUM ('draft', 'pending_approval', 'active', 'superseded', 'ended');

-- Room tier the negotiation is priced against (COL vocabulary: "companion" = shared/semi-private)
CREATE TYPE rate_room_class AS ENUM ('private', 'companion', 'other');

-- How the care/level-of-care charge behaves under the negotiated deal
CREATE TYPE care_charge_mode AS ENUM ('standard', 'flat', 'bundled', 'waived');

-- Why a concession was granted (drives reporting + owner review)
CREATE TYPE concession_reason AS ENUM (
  'none',
  'move_in_incentive',
  'financial_hardship',
  'length_of_stay_loyalty',
  'legacy_rate_lock',
  'medicaid_pending_bridge',
  'referral_partner',
  'care_level_offset',
  'goodwill_service_recovery',
  'other'
);
```

> `rate_room_class.companion` maps to the posted `rate_schedules.base_rate_semi_private` column. We introduce a dedicated enum (rather than reuse `room_type`) so the UI and reports speak COL's "private / companion" language. Documented mapping lives in the generator and in §4.

### 2.2 Core table: `resident_rate_agreements` (migration `216`)

One row = one **version** of a resident's negotiated terms. New negotiations supersede, never overwrite.

```sql
CREATE TABLE resident_rate_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),

  -- ---- Versioning / lifecycle ----
  status rate_agreement_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  effective_date date NOT NULL,
  end_date date,                                  -- NULL = open-ended / current
  supersedes_id uuid REFERENCES resident_rate_agreements (id),

  -- ---- Standard baseline snapshot (governance record at signing) ----
  rate_schedule_id uuid REFERENCES rate_schedules (id),  -- posted schedule priced against
  room_class rate_room_class NOT NULL DEFAULT 'private',
  standard_base_rate_at_signing integer NOT NULL,        -- cents: posted base for room_class at signing
  standard_care_surcharge_at_signing integer NOT NULL DEFAULT 0,
  standard_monthly_total_at_signing integer NOT NULL,    -- cents: snapshot gross at posted

  -- ---- Negotiated actuals (the contract) ----
  negotiated_base_rate integer NOT NULL,          -- cents: room rent the responsible party actually pays
  care_charge_mode care_charge_mode NOT NULL DEFAULT 'standard',
  negotiated_care_surcharge integer,              -- cents: required when mode IN ('flat'); NULL otherwise
  negotiated_monthly_total integer NOT NULL,      -- cents: all-in agreed monthly (room + care + agreed recurring)

  -- ---- Concession (stored for reporting stability + audit headline) ----
  concession_amount_at_signing integer NOT NULL DEFAULT 0,  -- cents: standard_monthly_total_at_signing - negotiated_monthly_total (>0 = discount)
  concession_pct_at_signing numeric(5,2) NOT NULL DEFAULT 0,
  concession_reason concession_reason NOT NULL DEFAULT 'none',
  concession_notes text,
  concession_expires_on date,                     -- time-limited incentives (rate steps back up)

  -- ---- Governance ----
  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  agreement_document_url text,                    -- signed residency agreement / addendum (Supabase Storage)
  notes text,

  -- ---- Conventions ----
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,

  CONSTRAINT rra_base_nonneg CHECK (negotiated_base_rate >= 0),
  CONSTRAINT rra_total_nonneg CHECK (negotiated_monthly_total >= 0),
  CONSTRAINT rra_flat_requires_amount
    CHECK (care_charge_mode <> 'flat' OR negotiated_care_surcharge IS NOT NULL),
  CONSTRAINT rra_effective_before_end
    CHECK (end_date IS NULL OR end_date >= effective_date)
);
```

**Sign convention (document everywhere):** `concession_amount = standard_monthly_total − negotiated_monthly_total`. Positive = discount granted; negative = **premium** (resident pays above posted, e.g. extra services). Reports label these "Concession" vs "Premium."

#### Indexes
```sql
CREATE INDEX idx_rra_resident ON resident_rate_agreements (resident_id, effective_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_rra_facility ON resident_rate_agreements (facility_id, effective_date DESC)
  WHERE deleted_at IS NULL;

-- Exactly one current agreement per resident (the single-active invariant)
CREATE UNIQUE INDEX uq_rra_one_active_per_resident
  ON resident_rate_agreements (resident_id)
  WHERE status = 'active' AND end_date IS NULL AND deleted_at IS NULL;

-- Concession reporting (only rows that actually discount)
CREATE INDEX idx_rra_facility_concession ON resident_rate_agreements (facility_id)
  WHERE deleted_at IS NULL AND status = 'active' AND concession_amount_at_signing <> 0;

-- Expiring incentives sweep
CREATE INDEX idx_rra_concession_expiring ON resident_rate_agreements (concession_expires_on)
  WHERE deleted_at IS NULL AND concession_expires_on IS NOT NULL;
```

### 2.3 Optional line detail: `resident_rate_agreement_lines` (migration `216`, recommended)

Header totals satisfy the MVP. For itemized recurring charges (pet fee, second occupant, custom services, a la carte care) that should appear deterministically on every invoice, add a child table. This keeps invoice generation a straight read instead of re-deriving fees.

```sql
CREATE TABLE resident_rate_agreement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES resident_rate_agreements (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  line_type text NOT NULL,            -- 'base_rent' | 'care_surcharge' | 'pet_fee' | 'second_occupant' | 'service' | 'custom'
  description text NOT NULL,
  standard_unit_price integer NOT NULL DEFAULT 0,   -- cents (posted equivalent, for concession math)
  negotiated_unit_price integer NOT NULL,           -- cents
  quantity numeric(8,2) NOT NULL DEFAULT 1,
  is_recurring boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rra_lines_agreement ON resident_rate_agreement_lines (agreement_id);
```

> If you ship header-only first, `negotiated_monthly_total` = base + care + a free-text note; add the lines table when itemization is needed. The invoice generator should be written to consume lines if present, else fall back to header totals.

### 2.4 Denormalized cache on `residents` (no new columns)

`residents.monthly_base_rate / monthly_care_surcharge / monthly_total_rate / rate_effective_date` already exist and are read by admissions/exec rollups. Keep them as a **denormalized cache of the current active agreement**, synced by trigger (see §6.4) so existing readers keep working without a refactor. The agreement table is the source of truth; these columns are a convenience mirror.

---

## 3. Posted-Rate Read-Only / Versioned Enforcement (migration `219`)

Requirement: posted rates "stay versioned/read-only." Today `rate_schedules` is freely mutable. Enforce **supersede-don't-edit**:

1. Add `status` to `rate_schedules`: `ALTER TABLE rate_schedules ADD COLUMN status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','superseded'));`
2. `BEFORE UPDATE` trigger `haven_rate_schedule_guard()`:
   - If `OLD.status = 'published'`, **reject** changes to any money column (`base_rate_private`, `base_rate_semi_private`, `care_surcharge_*`, fees) and to `effective_date`.
   - Allow only: setting `end_date` (closing the version), `status` → `superseded`, `updated_by`, `updated_at`, `deleted_at` (drafts only), `notes`.
   - `RAISE EXCEPTION 'rate_schedules are versioned and read-only once published; create a new effective-dated version instead.'`
3. Block hard `DELETE` on published rows (soft-delete drafts only).
4. "Edit" in the UI becomes **"Supersede with new version"**: clones the current schedule into a `draft`, opens the rate form, and on save sets the prior version's `end_date = new.effective_date − 1` and `status = 'superseded'` (the rate-change process already described in `16-billing.md`).

This makes the posted card an immutable, auditable lineage — the stable yardstick concessions are measured against.

---

## 4. Invoice Generation Behavior

Modify both twins in lockstep (they are intentional duplicates):
- `src/lib/billing/generate-monthly-invoices.ts`
- `supabase/functions/_shared/billing/generate-monthly-invoices.ts`

### 4.1 Rate resolution per resident (new)
For each active resident, for `period_start`:

1. **Find the active agreement** effective on `period_start`:
   `status='active' AND effective_date <= period_start AND (end_date IS NULL OR end_date >= period_start)`.
2. **If found** → bill from the agreement (gross-at-standard + concession credit, §4.2).
3. **If none found** → **safe fallback** to current posted `rate_schedules` + acuity (today's exact behavior). Flag the preview/invoice row `source = 'standard_fallback'` so Michelle sees who is billing un-negotiated. *(Zero-blocking architecture: missing agreement never blocks billing.)*

### 4.2 Canonical storage = gross-at-standard + negotiated concession credit
Compute each month against the **current** posted schedule and **current** acuity (so concession stays truthful as acuity drifts):

```
standard_room   = posted base for room_class (private→base_rate_private, companion→base_rate_semi_private)
standard_care   = posted surcharge for current acuity_level
standard_total  = standard_room + standard_care + standard recurring
negotiated_room = agreement.negotiated_base_rate
negotiated_care = (care_charge_mode = 'standard') ? standard_care
                : (care_charge_mode = 'flat')     ? negotiated_care_surcharge
                : 0                                              -- 'bundled' / 'waived'
negotiated_total = negotiated_room + negotiated_care + agreed recurring
concession       = standard_total - negotiated_total
```

Persist on the **invoice** (columns already exist — no schema change to `invoices`):
- `subtotal` = `standard_total` (revenue at posted)
- `adjustments` = `−concession` (negative; the credit)
- `total` = `negotiated_total`
- `balance_due` = `total − amount_paid`

**Line items:**
| line_type | unit_price | notes |
|---|---|---|
| `room_and_board` | `standard_room` | "Private/Companion Room — Monthly Rate" (or prorated) |
| `care_surcharge` | `standard_care` | only if > 0 |
| *(recurring)* | standard unit price | from agreement lines, if present |
| `negotiated_concession` | `−concession` | only when `concession <> 0`; description includes reason (e.g. "Move-in incentive — negotiated rate") |

This is the key elegance: **AR aging, revenue dashboards, and concession analytics all read invoice line data** — no special cases. The family total is the negotiated number; the concession is explicit for internal reporting.

### 4.3 Family-facing rendering toggle
Invoice PDF/portal honors a render flag `show_concession_detail` (org/facility setting, default **off** for family statements):
- **Off (net):** single "Monthly Rate" line at `negotiated_total`. What most families expect.
- **On (gross+credit):** shows room/care at posted then the concession credit. Used for internal copies and residents who negotiated transparently.
Either way, stored data is identical; only presentation differs.

### 4.4 Proration
Extend existing proration: prorate `standard_room` and `negotiated_room` by the same day-fraction so `concession` stays proportional. Care follows its mode. Idempotency is unchanged — the unique index `idx_invoices_facility_resident_period` (migration `071`) still guards duplicates.

### 4.5 Premium (negotiated > standard)
`concession` is negative → `adjustments` positive (a surcharge line `negotiated_premium`). Generator handles the sign uniformly; reports bucket negatives as "Premium."

---

## 5. Reporting

All exports reuse the shared `src/lib/csv-export.ts` (the D-series hub-CSV pattern) and `billingCurrency`.

1. **Concession Register** — `/admin/billing/concessions` (Michelle's worklist + owner visibility).
   Columns: resident, room, room_class, **standard total**, **negotiated total**, **concession $ / %**, reason, effective date, expires_on, approver, source. Facility scope + **All-facilities** (org) toggle. Filters: has-concession, reason, expiring ≤30/60d, premium-only, standard-fallback (no agreement). CSV export respects active filter (D-series scope convention).
2. **Concession leakage / revenue bridge** — monthly Σ`standard_total` (revenue at posted) vs Σ`negotiated_total` (realized) across census = total concession given; trend by facility. Feeds the existing **Revenue Dashboard** (`/admin/billing/revenue`) and **Executive CFO** view. Derived from invoice lines (point-in-time correct).
3. **Effective-rate / RevPAU** — realized monthly revenue ÷ occupied beds vs posted rate; owner "are we discounting our way to occupancy?" signal.
4. **Expiring concessions** — incentives with `concession_expires_on` within 30/60 days → task for `facility_admin` + owner alert so the rate steps back up (reuses the AR/expiration scan pattern; see §6.5).
5. **Off-rate exceptions** — residents on `standard_fallback` (no agreement) and residents whose concession exceeds the approval threshold but lack `approved_by`. Surfaces governance gaps.
6. **Per-resident rate history** — agreement version timeline on the resident billing page (audit-friendly).

---

## 6. Safety / Audit / RLS Requirements

### 6.1 RLS (migration `217`) — financial, admin-only; family never sees concessions
```sql
ALTER TABLE resident_rate_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_rate_agreements ON resident_rate_agreements
  FOR SELECT USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner','org_admin','facility_admin'));

CREATE POLICY admin_manage_rate_agreements ON resident_rate_agreements
  FOR ALL USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (SELECT haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner','org_admin','facility_admin'));
```
- **No `family` SELECT policy** — concession reason/approver/amount are internal. Families see only the net total on their invoice (existing `family_see_own_invoices`).
- `nurse` is intentionally excluded (financial surface), unlike `resident_payers` which nurses can read for clinical context.
- `resident_rate_agreement_lines` mirrors `invoice_line_items`: SELECT/manage gated by the parent agreement's accessibility + `organization_id = haven.organization_id()`.

### 6.2 Audit & updated_at (migration `218`)
```sql
CREATE TRIGGER tr_resident_rate_agreements_set_updated_at
  BEFORE UPDATE ON resident_rate_agreements
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at ();
CREATE TRIGGER tr_resident_rate_agreements_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_rate_agreements
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log ();
CREATE TRIGGER tr_resident_rate_agreement_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_rate_agreement_lines
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log ();
```
Every concession change is an immutable financial event in `audit_log` (no UPDATE/DELETE policy on `audit_log` — per non-negotiables).

### 6.3 Approval governance (migration `218` guard + app layer)
- Concessions above a threshold (config; default **> 10%** or **> $500/mo**) require owner/org_admin approval before going live.
- DB guard `haven_rate_agreement_approval_guard()` (`BEFORE INSERT OR UPDATE`): if `status='active' AND concession_amount_at_signing > 0` then `approved_by` and `approved_at` must be NOT NULL; reject otherwise. The *threshold* routing (when approval is required vs auto) is enforced in the API/UI; the DB guarantees **any active discount is attributable to an approver**.
- Premiums and zero-concession agreements don't require approval but are still audited.

### 6.4 Single-active invariant & cache sync (migration `218`)
- `uq_rra_one_active_per_resident` (§2.2) guarantees one current agreement.
- `AFTER INSERT OR UPDATE` trigger `haven_sync_resident_current_rate()`: when an agreement becomes `active`, set the prior active row to `superseded` with `end_date = new.effective_date − 1`, and write `negotiated_base_rate / negotiated_care / negotiated_monthly_total / effective_date` into the `residents.monthly_*` cache columns. Keeps legacy readers correct.

### 6.5 Lifecycle / consistency rules
- Agreement changes are **prospective**: never mutate an already-`sent` invoice. Correcting a sent invoice = void + regenerate (existing void flow).
- Expiring-incentive sweep: extend `facility-expiration-scanner` (or a small `rate-agreement-expiry-check`) to flag `concession_expires_on` and create a `collection_activities`-style task; **non-blocking** if cron/secret absent.
- Money in cents (integer); UTC `timestamptz`; soft-delete only; UUID PKs; denormalized `organization_id` + `facility_id`; RLS filters org first then facility — all per `AGENTS.md` non-negotiables.
- No secrets in code; document any new env var names only.

### 6.6 Mission / regulatory notes
- Florida AHCA 59A-36 requires a written residency agreement with rate disclosure; `agreement_document_url` anchors the negotiated terms to the signed document. Concession history supports rate-increase notice disputes.
- Medicaid OSS residents: negotiated private-pay concessions must not be applied to the Medicaid patient-responsibility split — keep `resident_payers` as the payer-split authority; the agreement governs the **private-pay/responsible-party** obligation only. Document this boundary in the generator.

---

## 7. UI / UX

Follow `docs/specs/FRONTEND-CONTRACT.md`, existing glass-panel/`AmbientMatrix` patterns, mobile-first single-column stacking, explicit loading/error/empty states, and `dollarsToCents` helpers from `@/lib/money/dollars-to-cents`.

### 7.1 Resident Billing page — `/admin/residents/[id]/billing` (extend existing page)
Add a **Rate Agreement** panel above "Payers on File":
- **Current agreement card:** room class; **Standard rate** (with link to the posted schedule version) vs **Negotiated rate**; **Concession badge** (green discount / amber premium, `$X (Y%)`); reason; effective date; expires-on (if any); approver; signed-doc link.
- **Negotiated balance summary:** current negotiated monthly total · this month's invoice total · **outstanding balance** (Σ `balance_due` of open invoices) — answers "what do they actually pay, and what do they owe?" in one glance.
- **History timeline:** superseded versions with effective ranges and concessions.
- **Actions:** "New negotiated agreement" / "Adjust rate" (creates next version) · "End agreement."

### 7.2 New / adjust agreement form — `/admin/residents/[id]/billing/rate-agreement/new`
- Select **room class** → auto-loads standard base from current posted schedule (read-only display) + current acuity surcharge (read-only).
- Enter **negotiated base rent** with **live concession calc** ("Concession: $450/mo, 10.6% below standard").
- **Care mode** selector (standard / flat+amount / bundled / waived).
- **Concession reason** (required when concession ≠ 0), notes, **expires-on** (optional), **document upload**, **effective date**.
- **Approval routing:** if over threshold, banner "Requires owner approval" → saves as `pending_approval`; owner approves to `active`.
- Guardrails: confirm on **premium** (negotiated > standard); block negative; require reason; warn if companion selected but the schedule has no `base_rate_semi_private`.

### 7.3 Rate Schedules page — `/admin/billing/rates` (reinforce read-only)
- Replace any edit affordance with **"Supersede with new version."** Keep Current/Historical badges.
- Add a roll-up chip: "Negotiated agreements: N residents · $X/mo total concession" → links to Concession Register.

### 7.4 Concession Register — `/admin/billing/concessions` (new)
Table + facility/org toggle + filters + CSV (§5.1). Michelle's primary screen; doubles as owner visibility.

### 7.5 Invoice generation preview — `/admin/billing/invoices/generate`
Add columns **Standard · Negotiated · Concession · Source**; visually flag `standard_fallback` rows for review before approving the batch.

### 7.6 Invoice detail — `/admin/billing/invoices/[id]`
Show the `negotiated_concession` line; toggle "show concession detail on family statement" (§4.3).

### 7.7 Family portal
Net rent only. **Never** expose concession reason/approver/amount.

---

## 8. Migration Naming (next = `216`, no gaps)

Mirrors the `027`/`028`/`029` billing split; one atomic commit for the segment.

| File | Contents |
|---|---|
| `306_resident_rate_agreements_concessions.sql` | Enums (§2.1), `resident_rate_agreements` + indexes (§2.2), `resident_rate_agreement_lines` (§2.3). |
| `217_resident_rate_agreements_rls.sql` | RLS enable + policies for both tables (§6.1). |
| `218_resident_rate_agreements_audit_triggers.sql` | `set_updated_at` + audit triggers; approval guard; single-active/cache-sync trigger (§6.2–6.4). |
| `219_rate_schedule_versioning_guard.sql` | `rate_schedules.status` column + `haven_rate_schedule_guard()` BEFORE UPDATE + DELETE block (§3). |

> If the team prefers fewer files, `217`–`218` may be merged, but keeping RLS and triggers separate matches the module's existing precedent and the gate runner's expectations. Run `bun run migrations:check` to confirm sequence parity.

---

## 9. Acceptance Criteria

### Schema & invariants
- [ ] Migrations `216`–`219` apply cleanly; `bun run migrations:check` passes (no gaps, canonical names).
- [ ] `resident_rate_agreements` has RLS enabled; `audit_log` captures INSERT/UPDATE/DELETE; `updated_at` auto-updates.
- [ ] `uq_rra_one_active_per_resident` rejects a second active open-ended agreement for the same resident.
- [ ] `rra_flat_requires_amount` and non-negative CHECKs enforced; `concession_amount` sign convention documented in code.

### Posted-rate read-only
- [ ] Updating any money column on a `published` `rate_schedules` row is rejected by `haven_rate_schedule_guard()`; only `end_date`/`status`/`notes`/audit fields are mutable.
- [ ] Hard `DELETE` on published rate schedules is blocked; "Supersede" creates a new version and closes the prior (`end_date = new.effective_date − 1`).

### Negotiated rate & concession
- [ ] Creating an agreement computes `concession_amount/pct_at_signing` from the posted standard for the chosen `room_class` (private→`base_rate_private`, companion→`base_rate_semi_private`).
- [ ] A premium (negotiated > standard) stores negative concession and renders as a premium line, not a discount.
- [ ] Activating a new version supersedes the prior and syncs `residents.monthly_*` cache columns.

### Approval & governance
- [ ] An `active` agreement with a positive concession **above threshold** cannot be saved without `approved_by` + `approved_at` (DB guard + UI routing); below threshold auto-activates.
- [ ] All concession changes appear in `audit_log` with actor and before/after.

### Invoice generation
- [ ] For a resident with an active agreement, the generated invoice has `subtotal = standard_total`, `adjustments = −concession`, `total = negotiated_total`, plus a `negotiated_concession` line when concession ≠ 0.
- [ ] For a resident with **no** agreement, billing falls back to posted rates (today's behavior) and the preview marks the row `standard_fallback`.
- [ ] Proration scales standard and negotiated room proportionally; concession stays proportional; idempotency (unique per facility+resident+period) holds.
- [ ] Family statement defaults to net single-line; internal/gross rendering available via toggle.
- [ ] Both generator twins (lib + Edge `_shared`) produce identical results (parity test).

### Reporting & UI
- [ ] Concession Register lists standard vs negotiated vs concession with reason/approver/expiration; facility + org toggle; CSV respects active filter.
- [ ] Resident billing page shows current negotiated rate, outstanding balance, concession badge, and version history.
- [ ] New-agreement form shows live concession math, requires reason on concession, warns on premium, blocks companion when no semi-private posted rate exists.
- [ ] Expiring-incentive sweep flags `concession_expires_on` within 30/60 days; **no-ops safely** if cron/secret absent.
- [ ] Family portal never exposes concession internals.

### Security & gates
- [ ] `nurse`/`family`/caregiver roles cannot SELECT `resident_rate_agreements` (RLS test).
- [ ] Cross-facility access blocked via `accessible_facility_ids()` (RLS matrix row).
- [ ] `bun run build` (root) and `bun run build` in `apps/web`/`COL` pass; ESLint clean.
- [ ] `npm run segment:gates -- --segment "resident-negotiated-billing" --ui` green with artifact in `test-results/agent-gates/`.

---

## 10. Implementation Order (suggested segments)

1. **`rra-schema`** — migrations `216`–`219`, regenerate `src/types/database.ts`, money/enums in code. Gate.
2. **`rra-generator`** — agreement-aware invoice generation in both twins + parity test + preview columns. Gate.
3. **`rra-ui-resident`** — resident billing panel + new/adjust agreement form + approval routing. Gate.
4. **`rra-concession-register`** — `/admin/billing/concessions` + CSV + revenue-bridge wiring + rates-page supersede affordance. Gate.
5. **`rra-expiry-sweep`** — expiring-incentive scan + tasks/alerts (ops/cron). Gate.

Each segment = one atomic commit with its gate artifact, per `AGENTS.md` segment discipline. Ship `1–4` to satisfy the core need; `5` is the proactive hardening pass.

---

## 11. Open Questions for Owner / Michelle

1. **Approval threshold** — confirm the dollar/percent at which a concession needs owner sign-off (default proposed: >10% or >$500/mo).
2. **Companion posted rates** — `16-billing.md` flags private-pay rates as not yet collected. Need each facility's posted **private** and **companion** monthly rates (and care surcharges) before go-live; companion agreements are blocked until `base_rate_semi_private` is set.
3. **Family transparency default** — should statements show the concession line, or net rent only (proposed default: net)?
4. **Historical concessions** — should we backfill current residents' negotiated rates from COL's `Statement of Accounts.xlsx` as initial `active` agreements (effective = their current rate date)? Recommended for a clean AR transition.
5. **Care bundling reality** — does Homewood bundle care into a single "all-in" rate for some residents (mode `bundled`), or always itemize? Confirms default `care_charge_mode`.
