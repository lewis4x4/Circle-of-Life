# S4 — Bed-Hold Billing (DEFERRED): scope + landmines

**Status:** Deferred. **Blocker:** Jessica's per-provider Medicaid bed-hold policy
(owed to the team; tracked in `HAVEN_ENGINEER_HANDOFF_v2.md` §1 and §20 "Things Still Open").

**Interim rule (do not change until Jessica's policy lands):** treat all of
`active` / `hospital_hold` / `loa` as billable — this is exactly what
`public.resident_billable_status` (migration 217) already encodes. Do **not**
build per-provider bed-hold differentiation in the interim; it would violate the
documented deferral.

S2 (presence write path) and S3 (Command census tile) shipped without touching
billing. When S4 is unblocked, the following are the verified landmines to
respect (found during the S2/S3 codebase verification pass):

## Landmines

1. **`invoice_line_items.line_type` has NO enum/CHECK constraint.** It is bare
   `text NOT NULL` (`supabase/migrations/027_billing_and_collections_schema.sql:149`).
   The `'bed_hold'` value is "supported" only because any string is accepted —
   nothing defines or validates it. If a defensive CHECK is ever added, it must
   include `'bed_hold'` (and the existing `'negotiated_concession'` /
   `'rate_premium'` adjustment values) or it will break invoice creation.

2. **The invoice RPC enforces a subtotal reconciliation.**
   `haven_create_invoice_with_line_items` (`supabase/migrations/306_resident_rate_agreements_concessions.sql`,
   ~lines 865–877) requires that non-adjustment `line_type` totals equal
   `p_subtotal`, and only `line_type IN ('negotiated_concession','rate_premium')`
   count as adjustments. A new `'bed_hold'` line is a **non-adjustment** line, so
   its amount must be folded into `p_subtotal` **and** `p_total` by the caller
   (`persistMonthlyInvoicesFromPreview`, `src/lib/billing/generate-monthly-invoices.ts`
   ~lines 462–483), or the RPC raises
   `"invoice non-adjustment line total must equal subtotal"`. **No RPC signature
   change is needed** — only caller-side math.

3. **There are TWO copies of the invoice generator.** The presence-aware cohort
   change must be made in BOTH or they drift:
   - `src/lib/billing/generate-monthly-invoices.ts` — `buildMonthlyInvoicePreview`
     resident query filters `status = 'active'` only (~line 190).
   - `supabase/functions/_shared/billing/generate-monthly-invoices.ts` — the edge
     duplicate, also filters `status = 'active'` only (~line 194).

## Rate sources (already in schema, wired to nothing)

- **Private pay:** `rate_schedules.bed_hold_daily_rate` (integer cents,
  `027_*.sql:19`) — never read by any application code today.
- **Medicaid, per provider:** `facility_medicaid_providers.bed_hold_hospital_billing`
  (`full_rate` / `reduced_rate` / `no_pay` / `unknown`),
  `bed_hold_hospital_reduced_rate_cents`, and `bed_hold_max_days`
  (`217_*.sql:176–179`) — never read by any billing logic today. This is the shape
  Jessica's policy populates.

## Read/write inconsistency to reconcile in S4

`src/lib/billing/load-invoices.ts` (`fetchActiveResidentCountForBillingScope`,
~line 114) already counts `active` + `hospital_hold` + `loa` as the billable
cohort, while the invoice **generator** only pulls `status = 'active'`. So a
hospital-hold resident counts toward the billing-scope KPI but generates no
invoice line — exactly the gap S4 closes.

## Suggested seam

Widen the resident query in `buildMonthlyInvoicePreview` (and the edge copy) to
include `hospital_hold` / `loa`; for held days, emit a `'bed_hold'` line item
priced from `bed_hold_daily_rate` (private) or the per-provider
`facility_medicaid_providers.bed_hold_*` policy (Medicaid), folding the amount
into `p_subtotal` / `p_total`. Optional: a `presence-bed-hold-evaluator` edge
function mirroring `ar-aging-check`.
