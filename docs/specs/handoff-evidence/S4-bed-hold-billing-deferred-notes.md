# S4 — Bed-Hold Billing: scope + landmines (UNBLOCKED 2026-07)

**Status:** **Unblocked** for implementation as track **BH-1 … BH-6** (do not reuse COL-V2-S4).  
**Policy source:** `docs/specs/COL-RESPONSE-LOG-2026-07-michelle-bed-hold.md` (Michelle, Jul 2026).  
**Prior blocker:** Jessica per-provider Medicaid bed-hold policy — **superseded** by Michelle’s interim rules (unlimited days; full rate pending authorization).

## Interim billing rules (locked)

1. **No day caps** — leave `facility_medicaid_providers.bed_hold_max_days` NULL; do not enforce 7–10 day defaults.
2. **Private-pay on hold** — bill **full monthly rent** (`room_and_board` + care as applicable) while `hospital_hold` / `loa`, until **official discharge** (belongings out → `status = discharged` + `discharge_date`).  
   **Do not** price private-pay holds from `rate_schedules.bed_hold_daily_rate` in this wave.
3. **Medicaid on hold** — bill at provider monthly default (or resident override) with `bed_hold_hospital_billing = full_rate` pending authorization. Adjust later when auth says otherwise.
4. **Discharge month** — prorate by `discharge_date` (symmetric with admission proration).
5. **Due date** — private-pay rent due by the **5th** of the month.

## Landmines (still valid)

1. **`invoice_line_items.line_type` has NO enum/CHECK constraint.** Bare `text NOT NULL` (`027_*.sql`). Prefer reusing `room_and_board` / `care_surcharge` for full-month hold billing. If a dedicated `'bed_hold'` line is ever added for Medicaid reduced-rate cases, fold it into `p_subtotal` as a **non-adjustment** line.

2. **The invoice RPC enforces subtotal reconciliation.**  
   `haven_create_invoice_with_line_items` (`306_*.sql`) requires non-adjustment line totals = `p_subtotal`. Only `negotiated_concession` / `rate_premium` count as adjustments.

3. **TWO copies of the invoice generator** must stay twins:
   - `src/lib/billing/generate-monthly-invoices.ts`
   - `supabase/functions/_shared/billing/generate-monthly-invoices.ts`

## Rate sources

- **Private pay:** negotiated agreement → legacy resident monthly → `rate_schedules` posted private/companion + acuity.
- **Medicaid:** `resident_payers.medicaid_rate` override → `facility_medicaid_providers.default_rate_cents` (Michelle defaults) → fall back to private schedule only if catalog missing.
- **`bed_hold_daily_rate` / `bed_hold_hospital_reduced_rate_cents`:** reserved for future reduced-rate auth cases — **not** used for private-pay full-rent holds.

## Read/write inconsistency (BH-3 closes)

`fetchActiveResidentCountForBillingScope` already counts `active` + `hospital_hold` + `loa`. Invoice generator historically filtered `status = 'active'` only — BH-3 widens the cohort to match.

## Segment map

| Seg | Scope |
|-----|--------|
| BH-0 | Policy log + this unblock (docs) |
| BH-1 | Official discharge write path |
| BH-2 | Medicaid catalog seed/update (all COL facilities) |
| BH-3 | Invoice engine: cohort, Medicaid rates, admit+discharge proration, due by 5th |
| BH-4 | Hold notified_at + decline-return fields |
| BH-5 | Opening-balance invoice entry for Michelle |
| BH-6 | Form 1823 annual default + hospital-return renewal |
