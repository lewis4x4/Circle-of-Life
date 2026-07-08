# COL Response Log — Michelle bed-hold / billing policy (2026-07)

**Source:** Michelle’s numbered answers to Brian’s policy questions (received ~2026-07-08).  
**Status of this doc:** Authoritative interim policy for bed-hold billing, Medicaid defaults, Form 1823 renewal, and Medicaid admit proration.  
**Unblocks:** Deferred bed-hold billing (`docs/specs/handoff-evidence/S4-bed-hold-billing-deferred-notes.md`).  
**Track:** BH-0 … BH-6 (do **not** reuse COL-V2-S4 — that slice already shipped).

---

## 01 — Bed-hold days, private-pay rent, Medicaid rates

**COL response:**
- **No limits** on bed-hold days.
- **Private-pay:** responsible for **full monthly rent** until official discharge (belongings removed; no longer a resident).
- **Medicaid:** bed-hold payments covered **pending bed-hold authorization**.
- **Discharge:** monthly rate **prorated by discharge date**.
- Current monthly Medicaid defaults:
  - Florida Community Care: **$1,650**
  - Simply Healthcare: **$1,600**
  - UnitedHealthcare: **$1,600**
  - Sunshine Health: **$1,350**
  - Humana: **$1,250**
- Higher reimbursement may occur case-by-case → per-resident override required.

**Schema / product impact:**
- `facility_medicaid_providers.default_rate_cents` → Michelle’s figures (all COL facilities).
- `bed_hold_max_days` stays **NULL** (unlimited).
- `bed_hold_hospital_billing` interim = **`full_rate`** (pending auth); do not invent reduced/no_pay without auth.
- Private-pay holds bill **full monthly room & board** — **not** reduced `bed_hold_daily_rate`.
- Invoice generator must include `active` + `hospital_hold` + `loa` and apply discharge proration.

**Status:** ✅ ANSWERED — proceed BH-2 / BH-3.

---

## 02 — When hold starts / ends

**COL response:**
- **Private-pay:** rent due by the **5th**; paid in advance; hold remains until next rent due unless resident/family notifies they will not return → facility releases hold. To retain bed, next month’s rent must be paid.
- **Medicaid:** bed-hold days begin when the resident’s **case manager is notified** of hospital admission. Providers differ on authorized days — use **unlimited** for now; adjust from authorization received.

**Schema / product impact:**
- Invoice `due_date` → **5th** of billing month (was 15th).
- Capture `hold_case_manager_notified_at` when entering `hospital_hold`.
- Capture decline-return / hold-release intent for private-pay (operator action).

**Status:** ✅ ANSWERED — proceed BH-3 (due date) + BH-4 (events).

---

## 03 — July 2026 AR report

**COL response:**
- Amounts are on the July 2026 Accounts Receivable report (to be shared).
- Michelle offered to enter amounts into Haven to learn that part of the system.

**Schema / product impact:**
- Need an **opening-balance / manual invoice** path into `invoices` (Homewood launch intake is not ledger-ready).

**Status:** ✅ ANSWERED (ops) — proceed BH-5; await report file.

---

## 04 — Clarification needed

**COL response:** Michelle asked to clarify the original question before answering.

**Status:** ⏳ BLOCKED — resend original Q4; do not invent scope.

---

## 05 — Form 1823 renewal

**COL response:**
- Form 1823 updated **annually** for all residents.
- Renewal date may change if hospitalized and a **new Form 1823** is received, or on **significant change** requiring a new physician assessment before the yearly benchmark.

**Schema / product impact:**
- Default `expiration_date` = `exam_date + 365 days` when omitted.
- On `hospital_hold` → `active`, mark Form 1823 **`renewal_due` / pending** for a new assessment.

**Status:** ✅ ANSWERED — proceed BH-6.

---

## 06 — Medicaid billing start

**COL response:**
- Medicaid billing begins on the **admission date**.
- Example: admit 2026-06-15 → bill partial month 2026-06-15 through 2026-06-30.

**Schema / product impact:**
- Admission proration already exists; keep and extend to Medicaid rate path + discharge symmetry.

**Status:** ✅ ANSWERED — covered by BH-3.

---

## Explicit non-goals (this wave)

- Per-provider hard day caps (deferred until authorizations dictate).
- Separate “short trip” presence state.
- Auto-flipping Medicaid hold to `reduced_rate` / `no_pay` without operator/auth input.
- Split-payer dual invoices (primary payer only for BH-3).

---

## Mission alignment

**pass** — Correct bed-hold and Medicaid billing improves owner financial visibility, staff clarity for Michelle’s AR workflow, and auditability of money decisions without inventing clinical or payer rules beyond COL’s stated policy.
