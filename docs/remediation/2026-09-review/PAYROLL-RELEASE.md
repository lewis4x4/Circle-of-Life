# Payroll-only release

User authorized pushing and deployment on 2026-09-08. This release cherry-picks the reviewed payroll repair onto production main 9db72d2d. Earlier unreleased clinical/finance repairs are excluded.

The unchanged payroll SQL is migration 334_payroll_source_freshness.sql on this baseline. Earlier artifacts refer to its original development filename 341; those logs remain historical. The backlog branch is separately renumbered to reserve334 for this release. SQL/UI review confirms no dependency on unreleased migrations334–340.

Production preflight: site circleoflifealf (be2bb95e-ba70-47f8-8d2d-70cd37b9b41a), project manfqmasfqppukpobpld, migrations through333, no payroll batches. Previous published deploy6a9f729d06a33b0008dffd27 at main9db72d2d. Private backup archive catalog verified (public/haven/auth/storage/migration ledger); no application records exported into this repository.

Release proof is recorded below as execution completes. No production completion is claimed by this preparation record.
