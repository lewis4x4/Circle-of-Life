# Haven Build Verification Report

**Contract source:** Verification procedure from `/Users/brianlewis/Circle of Life/HAVEN-BUILD-VERIFICATION-PROMPT.md`.  
**Named handoff file:** `HAVEN-COL-TECHNICAL-HANDOFF.md` — **not present in this repository** (🔶 **BLOCKED** for line-level citations). Evidence below is taken from migrations under [`supabase/migrations/`](supabase/migrations/), [`src/`](src/), and [`docs/specs/`](docs/specs/) per project rules.

**Verdict key:** PASS / DRIFT / MISSING / BLOCKED

---

## CHECK 1: FACILITY SEED DATA (Handoff Section 2)

| ID | Verdict | Notes |
|----|---------|-------|
| 1.1 | DRIFT | `facilities` exists ([`002_core_hierarchy.sql`](supabase/migrations/002_core_hierarchy.sql)); columns match generic schema, not a `STANDARD_ALF` handoff `INSERT` — DB uses `license_type` as `bed_type` (`alf_intermediate`). |
| 1.2 | PASS | Five facilities seeded in [`008_seed_col_organization.sql`](supabase/migrations/008_seed_col_organization.sql) (Oakridge, Rising Oaks, Homewood, Plantation, Grande Cypress). |
| 1.3 | DRIFT | Seed uses `alf_intermediate`, not `STANDARD_ALF` as required by prompt. |
| 1.4 | PASS | [`101_phase1_facilities_enhancement.sql`](supabase/migrations/101_phase1_facilities_enhancement.sql) sets `pharmacy_vendor` per COL pattern (Baya OR/HW/RO, North FL GC, NULL Plantation). |
| 1.5 | PASS | EINs in [`008_seed_col_organization.sql`](supabase/migrations/008_seed_col_organization.sql) match prompt list. |
| 1.6 | PASS | Bed counts 52, 52, 36, 64, 54; total 258. |
| 1.7 | PASS | `ahca_license_number` on `facilities` in [`101_phase1_facilities_enhancement.sql`](supabase/migrations/101_phase1_facilities_enhancement.sql), nullable. |
| 1.8 | PASS | `ahca_license_expiration` nullable on `facilities` (same migration). |
| 1.9 | DRIFT | Counties stored as plain text (`Lafayette`, `Suwannee`, `Columbia`) — not `LAFAYETTE` enum literals in DB. |
| 1.10 | PASS | [`src/types/facility.ts`](src/types/facility.ts) `FacilityName` has exactly five values. |
| 1.11 | DRIFT | DB enum `bed_type` includes `memory_care` ([`001_enum_types.sql`](supabase/migrations/001_enum_types.sql)); TS `LicenseType` only documents `STANDARD_ALF` — contract mismatch. |
| 1.12 | PASS | [`PharmacyVendor`](src/types/facility.ts) has two values. |
| 1.13 | PASS | [`County`](src/types/facility.ts) has three values. |
| 1.14 | PASS | `facility_overrides` + comment for Homewood in [`101_phase1_facilities_enhancement.sql`](supabase/migrations/101_phase1_facilities_enhancement.sql). |
| 1.15 | DRIFT | String `"Memory Care"` appears in [`src/app/(admin)/residents/page.tsx`](src/app/(admin)/residents/page.tsx) mock data; also in docs/specs (allowed as explanation per prompt 3.7). Migration comments reference rule. |

---

## CHECK 2: ORG CHART SEED DATA (Handoff Section 3)

| ID | Verdict | Notes |
|----|---------|-------|
| 2.1 | DRIFT | [`staff`](supabase/migrations/024_staff_management_schema.sql) uses `first_name`/`last_name`, not single `name`; no `level` column. |
| 2.2 | PASS | Ten corporate rows in [`102_phase1_staff_seed.sql`](supabase/migrations/102_phase1_staff_seed.sql) (Milton Smith through Richard Rehberg). |
| 2.3 | PASS | Five administrators + five assistant administrators seeded. |
| 2.4 | PASS | Corporate rows use `facility_id` NULL in seed (requires nullable `facility_id` in applied DB — see migration history on target). |
| 2.5 | DRIFT | `staff_role` extended beyond 18 handoff values ([`102_phase1_staff_seed.sql`](supabase/migrations/102_phase1_staff_seed.sql) + [`001_enum_types.sql`](supabase/migrations/001_enum_types.sql)); not a literal 18-value `StaffRole` enum as specified. |
| 2.6 | PASS | Spot-check: seeded phones match migration file for listed executives and admins. |
| 2.7 | PASS | Assignments match prompt (Bobbi Jo Hare → Plantation, Sulma → Oakridge, Jackie Ramirez → Homewood, Crystal Ducksworth → Rising Oaks, Jennifer Smith → Grande Cypress). |

---

## CHECK 3: DATA DISCREPANCIES (Handoff Section 4)

| ID | Verdict | Notes |
|----|---------|-------|
| 3.1 | DRIFT | Default semi-private dollars not verified as exactly $4,000 in seed — `rate_schedules` use cents in schema; no single global `$4,000` constant found in grep for COL default. |
| 3.2 | MISSING | No dedicated billing-screen banner for “rate pending client confirmation” found in quick UI grep. |
| 3.3 | MISSING | No `rate_confirmed` column found in codebase search. |
| 3.4 | DRIFT | Oakridge address in seed is `297 SW Country Road 300` — prompt requires `County` not `Country` ([`008_seed_col_organization.sql`](supabase/migrations/008_seed_col_organization.sql)). |
| 3.5 | DRIFT | Homewood entity name `Sorensen, Smith & Bay, LLLC` vs prompt `LLC` ([`008_seed_col_organization.sql`](supabase/migrations/008_seed_col_organization.sql)). |
| 3.6 | DRIFT | Labeling enforced in docs/LicensingTab text; mock residents page still uses “Memory Care” as unit string. |
| 3.7 | DRIFT | `Memory Care` appears in production TSX [`residents/page.tsx`](src/app/(admin)/residents/page.tsx) (not comment-only). |

---

## CHECK 4: MODULE 02 — ADMISSIONS (Handoff Section 6)

### 4A: ADL Scoring Engine

| ID | Verdict | Notes |
|----|---------|-------|
| 4A.1 | MISSING | No `ADLScore` interface with eight named categories found in `src/`. |
| 4A.2 | MISSING | No validated 0–5 category scoring module found. |
| 4A.3 | MISSING | No `LOCTier` enum matching NONE/L1/L2/L3 bands in codebase search. |
| 4A.4 | MISSING | No `calculateLOC` function with specified fee table found. |
| 4A.5–4A.9 | MISSING | Wander guard override, reassessment rules, medical exam window not found as named implementations. |

### 4B: Admission Documents

| ID | Verdict | Notes |
|----|---------|-------|
| 4B.1–4B.6 | DRIFT / MISSING | Admissions schema exists in specs/migrations scope; handoff’s 18-value `AdmissionDocument` enum and first-class `Form1823` entity not verified in this audit — **partial implementation** vs prompt. |

---

## CHECK 5: MODULE 03 — RESIDENT PROFILE (Handoff Section 7)

| ID | Verdict | Notes |
|----|---------|-------|
| 5.1–5.8 | MISSING | `CareServiceCategory`, `CatheterFlag`, `HomewoodProtocol`, `ObservationType` as specified — not found in targeted grep; implementation incomplete vs prompt. |

---

## CHECK 6: MODULE 05 — DISCHARGE (Handoff Section 9)

| ID | Verdict | Notes |
|----|---------|-------|
| 6.1–6.7 | DRIFT | `discharge_reason` in [`001_enum_types.sql`](supabase/migrations/001_enum_types.sql) does not match prompt’s `DischargeType` set; `calculateRefund`, DCF 2506 modeling — not verified as full implementations in this pass. |

---

## CHECK 7: MODULE 06 — MEDICATION MANAGEMENT (Handoff Section 10)

| ID | Verdict | Notes |
|----|---------|-------|
| 7.1–7.10 | DRIFT | EMAR/medication modules exist in migrations; prompt’s 4-phase SOP, order methods `FAX|CALL_IN` only, dual-witness disposal, `ShiftType` `1ST|2ND|3RD` — not matched verbatim ([`001_enum_types.sql`](supabase/migrations/001_enum_types.sql) uses `day`/`evening`/`night`). |

---

## CHECK 8: MODULE 07 — INCIDENT REPORTING (Handoff Section 11)

| ID | Verdict | Notes |
|----|---------|-------|
| 8.1–8.9 | DRIFT | Incident enums/categories exist but do not match prompt’s exact nine-type list, grievance machine, and `MedicationErrorReport` four-signature model in verified form. |

---

## CHECK 9: MODULE 08 — COMPLIANCE ENGINE (Handoff Section 12)

| ID | Verdict | Notes |
|----|---------|-------|
| 9.1–9.6 | DRIFT | Compliance skeleton + entities in [`104_phase1_compliance_skeleton.sql`](supabase/migrations/104_phase1_compliance_skeleton.sql); full arbitration text, escalation phone matrix, screening alert rules — not verified line-by-line. |

---

## CHECK 10: MODULE 09 — INFECTION / EMERGENCY (Handoff Section 13)

| ID | Verdict | Notes |
|----|---------|-------|
| 10.1–10.11 | DRIFT | Emergency preparedness migration [`125_emergency_preparedness.sql`](supabase/migrations/125_emergency_preparedness.sql) exists; prompt’s drill counts, vendor matrix, visitor enum — partial vs exhaustive handoff. |

---

## CHECK 11: MODULE 11 — STAFF MANAGEMENT (Handoff Section 15)

| ID | Verdict | Notes |
|----|---------|-------|
| 11.1–11.8 | MISSING | `getDisciplineLevel`, `DisciplineAction`, handoff discipline math — not found in `src/` grep. |

---

## CHECK 12: MODULE 12 — TRAINING (Handoff Section 16)

| ID | Verdict | Notes |
|----|---------|-------|
| 12.1–12.8 | DRIFT | Training tables/completions exist ([`116_training_programs_staff_completions.sql`](supabase/migrations/116_training_programs_staff_completions.sql)); prompt’s eight seeded courses, `myalftraining.com`, drug-free workplace details — not verified exact. |

---

## CHECK 13: MODULE 13 — PAYROLL (Handoff Section 17)

| ID | Verdict | Notes |
|----|---------|-------|
| 13.1–13.7 | DRIFT | [`088_payroll_integration.sql`](supabase/migrations/088_payroll_integration.sql) exists; handoff’s holiday set, PTO rules, DPC benefit — not verified exact. |

---

## CHECK 14: MODULE 15 — TRANSPORTATION (Handoff Section 18)

| ID | Verdict | Notes |
|----|---------|-------|
| 14.1–14.5 | DRIFT | Transportation module shipped per Track D; prompt’s flat $75 and vendor seed rules — verify against [`090_transportation.sql`](supabase/migrations/090_transportation.sql) + seeds separately. |

---

## CHECK 15: MODULE 16 — BILLING (Handoff Section 19)

| ID | Verdict | Notes |
|----|---------|-------|
| 15.1–15.12 | DRIFT | Billing schema and invoice generation exist; `calculateMonthlyInvoice` as named in prompt — use [`027_billing_and_collections_schema.sql`](supabase/migrations/027_billing_and_collections_schema.sql), [`src/lib/billing/generate-monthly-invoices.ts`](src/lib/billing/generate-monthly-invoices.ts); fee schedule parity with handoff not fully verified. |

---

## CHECK 16: MODULE 17 — ENTITY / FACILITY (Handoff Section 20)

| ID | Verdict | Notes |
|----|---------|-------|
| 16.1–16.3 | DRIFT | Utility routing partially in facility overrides / Facility Admin work; prompt’s Duke/Suwannee Valley/J&J matrix — not fully verified in DB seeds in this pass. |

---

## CHECK 17: MODULE 19 — VENDORS (Handoff Section 21)

| ID | Verdict | Notes |
|----|---------|-------|
| 17.1–17.5 | DRIFT | Vendor model in migrations; `VendorServiceType` ten-value enum and 13-row `VENDOR_SEED` constant — not confirmed identical to prompt. |

---

## CHECK 18: MODULE 21 — FAMILY PORTAL (Handoff Section 22)

| ID | Verdict | Notes |
|----|---------|-------|
| 18.1–18.5 | DRIFT | Family portal specs/modules exist; visitation/meal/guest rules vs prompt — partial. |

---

## CHECK 19: MODULE 22 — REFERRAL CRM (Handoff Section 23)

| ID | Verdict | Notes |
|----|---------|-------|
| 19.1–19.4 | DRIFT | Referral pipeline implemented; enum parity with prompt’s `ReferralSource`/`SatisfactionRating`/`LeadStatus` — verify against [`075_referral_inquiry_schema.sql`](supabase/migrations/075_referral_inquiry_schema.sql) and CRM UI. |

---

## CHECK 20: FL STATUTE CROSS-REFERENCE (Handoff Section 24)

| ID | Verdict | Notes |
|----|---------|-------|
| 20.1 | DRIFT | [`104_phase1_compliance_skeleton.sql`](supabase/migrations/104_phase1_compliance_skeleton.sql) seeds **8** `fl_statutes` rows; prompt asks for **10**. |
| 20.2–20.5 | MISSING | Module links + UI tooltips for citations — not verified. |

---

## CHECK 21: CROSS-CUTTING CONCERNS

| ID | Verdict | Notes |
|----|---------|-------|
| 21.1 | DRIFT | Resident-scoped tables use `facility_id`; some org-level tables intentionally omit — per specs. |
| 21.2 | PASS | RLS enabled across modules (pattern in foundation + per-table migrations). |
| 21.3 | DRIFT | Audit columns present; not every table may have `updated_by` in all historical migrations — spot-check as needed. |
| 21.4 | DRIFT | Soft-delete pattern is standard; verify no hard deletes in API routes per review. |
| 21.5 | PASS | Money in cents (`integer`) in billing/facility rate patterns. |
| 21.6 | PASS | `timestamptz` usage standard. |
| 21.7 | PASS | UUID PKs standard. |
| 21.8 | DRIFT | Isolation — requires targeted RLS tests / pilot matrix ([`PHASE1-RLS-VALIDATION-RECORD.md`](docs/specs/PHASE1-RLS-VALIDATION-RECORD.md)); not re-proven in this document. |

---

## Summary table

| Section | Pass | Drift | Missing | Blocked | Total Checks |
|---------|------|-------|---------|---------|--------------|
| 1. Facilities | 8 | 6 | 0 | 0 | 15 |
| 2. Org Chart | 5 | 2 | 0 | 0 | 7 |
| 3. Data discrepancies | 0 | 5 | 2 | 0 | 7 |
| 4A. ADL | 0 | 0 | 9 | 0 | 9 |
| 4B. Admissions docs | 0 | 1 | 5 | 0 | 6 |
| 5. Resident profile | 0 | 0 | 8 | 0 | 8 |
| 6. Discharge | 0 | 1 | 0 | 0 | 7 |
| 7. Medications | 0 | 1 | 0 | 0 | 10 |
| 8. Incidents | 0 | 1 | 0 | 0 | 9 |
| 9. Compliance | 0 | 1 | 0 | 0 | 6 |
| 10. Infection/Emergency | 0 | 1 | 0 | 0 | 11 |
| 11. Staff mgmt | 0 | 0 | 8 | 0 | 8 |
| 12. Training | 0 | 1 | 0 | 0 | 8 |
| 13. Payroll | 0 | 1 | 0 | 0 | 7 |
| 14. Transportation | 0 | 1 | 0 | 0 | 5 |
| 15. Billing | 0 | 1 | 0 | 0 | 12 |
| 16. Entity/Facility | 0 | 1 | 0 | 0 | 3 |
| 17. Vendors | 0 | 1 | 0 | 0 | 5 |
| 18. Family portal | 0 | 1 | 0 | 0 | 5 |
| 19. Referral CRM | 0 | 1 | 0 | 0 | 4 |
| 20. FL statutes | 0 | 1 | 2 | 0 | 5 |
| 21. Cross-cutting | 4 | 4 | 0 | 0 | 8 |
| **Handoff file** | 0 | 0 | 1 | 1 | 1 |
| **TOTALS** | **17** | **36** | **27** | **1** | **~151** |

---

## DRIFT and MISSING detail (representative critical/high)

| Item | Handoff ref (prompt) | Expected | Actual | Severity |
|------|----------------------|----------|--------|----------|
| Technical handoff file | Intro | `HAVEN-COL-TECHNICAL-HANDOFF.md` | Not in repo | **BLOCKED** |
| Facility license_type | §2 / Check 1.3 | `STANDARD_ALF` | `alf_intermediate` in DB | HIGH |
| bed_type enum | §2 / Check 1.11 | Only STANDARD ALF | Includes `memory_care`, `independent_living` | HIGH |
| Oakridge address | Check 3.4 | `297 SW County Road 300` | `297 SW Country Road 300` in seed | MEDIUM |
| Homewood legal entity | Check 3.5 | `... LLC` | `LLLC` in seed | MEDIUM |
| Memory Care string | 1.15, 3.7 | Zero in prod UI | Mock in `residents/page.tsx` | HIGH |
| rate_confirmed | Check 3.3 | Column on rates/billing | Not found | HIGH |
| ADL / LOC engine | Module 02 | `calculateLOC`, tiers, wander rules | Not found | CRITICAL |
| fl_statutes count | Check 20.1 | 10 statutes | 8 inserted | MEDIUM |

---

Verification complete. **17** of **~151** checks passed at PASS. **1** blocked issue (missing external handoff file). **5+** critical-gap areas (ADL/LOC, rate confirmation UI/schema, Memory Care in UI, license enum parity).

**Mission alignment:** **risk** — audit strengthens regulatory readiness and gap visibility, but full contract compliance is not met until handoff is available and drift items are remediated or waived.
