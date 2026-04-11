# HAVEN–COL technical handoff (reference)

Verification work for this repository is driven by **`docs/HAVEN-BUILD-VERIFICATION-REPORT.md`** and the **Track E** remediation migrations (`137`–`145`).

- **Do not** copy PII or premium client-specific content from external downloads into committed docs.
- **Implementation source of truth** remains `docs/specs/` plus owner instructions; this file is an **index** for handoff-aligned engineering work.

## Track E mapping

| Segment | Migration / artifact |
|--------|------------------------|
| E1 Seed fixes | `137_track_e_col_seed_corrections.sql` + `008_seed_col_organization.sql` |
| E2 `alf_license_type` | `138_track_e_facility_alf_license_type.sql` |
| E3 ADL / LOC | `139_track_e_adl_assessments.sql` + `src/lib/admissions/*` |
| E4 Rate confirmation | `140_track_e_rate_confirmed.sql` + billing UI |
| E5 Memory Care | `scripts/check-memory-care.mjs` |
| E6 Admissions / Form 1823 | `141_track_e_form_1823_and_admission_docs.sql` + `src/types/admissions.ts` |
| E7 Resident profile contracts | `src/types/resident-profile-contracts.ts` + `src/lib/residents/*` |
| E8 Discharge | `142_track_e_discharge_reason_expansion.sql` + `src/lib/discharge/*` |
| E9 Discipline | `143_track_e_staff_discipline_records.sql` + `src/lib/staff/*` |
| E10 Enum parity | `144_track_e_enum_parity_batch.sql` + COL constant modules |
| E11 FL statutes | `145_track_e_fl_statutes_module_links.sql` + `StatuteCitation` |
| E12 Cross-cutting | `docs/specs/TRACK-E-CROSS-CUTTING-SWEEP.md` |

## Migration sequence note

Duplicate migration filenames were renumbered (`129`, `133`–`136`) so `npm run migrations:check` passes; Track E DDL starts at **`137`**.
