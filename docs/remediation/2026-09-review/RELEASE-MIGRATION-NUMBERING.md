# Payroll-first release migration numbering

Payroll is being released from main through migration 333 as migration 334. The unreleased roadmap migrations shift to 335–341 so a future roadmap release neither reuses payroll version 334 nor reapplies its SQL at 341. SQL bodies are byte-for-byte unchanged.

Current roadmap evidence paths and executable payroll baseline selection use the new names. Existing review JSON, hashes, prior logs, and chronological execution statements retain their original review-time provenance; resolve their filenames with this mapping. This numbering note does not claim the shifted backlog was deployed.

| Original reviewed filename | Current filename | Unchanged SHA-256 |
| --- | --- | --- |
| `334_reconciliation_evidence_invariant.sql` | `335_reconciliation_evidence_invariant.sql` | `d235d1226cca6ede05dd7ce2dd418078f37b3250c28c3c74d2de28d6f4f62f98` |
| `335_assessment_fall_risk_chronology.sql` | `336_assessment_fall_risk_chronology.sql` | `a7294a9e8063290695c6e812d86dcbae0e7d8b1c86f0b183c71f106655c5ac73` |
| `336_atomic_discharge_bed_release.sql` | `337_atomic_discharge_bed_release.sql` | `88d5dcbc27abe4ba31306163e4a7d8f1c8a8c118bab849887cc89b0c088a46b8` |
| `337_operational_medication_shifts.sql` | `338_operational_medication_shifts.sql` | `af98ad489c19569334e07b16d4c8fcf4d9c4aa2638d30b3f7d0574ad2d9d1f1e` |
| `338_atomic_payment_recording.sql` | `339_atomic_payment_recording.sql` | `4fde33aca986e04af11852d9c9ecf9c99bb0b305c9eec1805218a547e93db336` |
| `339_atomic_purchase_order_creation.sql` | `340_atomic_purchase_order_creation.sql` | `1688eaae91e58b73e992eb97ae42a790e96e774976adb9b24da66b8f99f907d4` |
| `340_atomic_source_gl_posting.sql` | `341_atomic_source_gl_posting.sql` | `f7ed989fa9eca3e5de6197114b0e540e296d90e3414ef57bc8132e20a36c9205` |
| `341_payroll_source_freshness.sql` | `334_payroll_source_freshness.sql` | `4801112cc77b0922807bf81685aa40908e3b6887a74a93cb0749d14d970ef285` |

Verification on 2026-09-08: `npm run migrations:check` passed (001–341, 344 files); native PostgreSQL 17 replay passed all 344 migrations and 25 SQL probes using Supabase stubs. The updated payroll concurrency harness passed its original stale baseline before migration 334, same-line concurrent import, correction/reapproval rejection, queued refresh, stable history, and actor revocation checks. `git diff --check` passed. These checks do not establish hosted deployment or authenticated hosted behavior.
