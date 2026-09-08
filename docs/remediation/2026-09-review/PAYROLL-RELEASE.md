# Payroll-only release

User authorized pushing and deployment on 2026-09-08. This release cherry-picks the reviewed payroll repair onto production main 9db72d2d. Earlier unreleased clinical/finance repairs are excluded.

The unchanged payroll SQL is migration 334_payroll_source_freshness.sql on this baseline. Earlier artifacts refer to its original development filename 341; those logs remain historical. The backlog branch is separately renumbered to reserve334 for this release. SQL/UI review confirms no dependency on unreleased migrations334–340.

Production preflight: site circleoflifealf (be2bb95e-ba70-47f8-8d2d-70cd37b9b41a), project manfqmasfqppukpobpld, migrations through333, no payroll batches. Previous published deploy 6a9f729d06a33b0008dffd27 at main9db72d2d. Private backup archive catalog verified (public/haven/auth/storage/migration ledger); no application records exported into this repository.

## Production release completed

- PR #458 merged as adb5ecb954e901610637fcd4b792ab2753d5c018. Netlify production deploy 6aa028b2a2a7920008189a1d published 2026-09-08T15:31:05.418Z at https://circleoflifealf.com. Automatic publishing restored after the controlled cutover.
- Migration 334 committed atomically with its exact reviewed SQL recorded in the hosted ledger. SHA-256: 4801112cc77b0922807bf81685aa40908e3b6887a74a93cb0749d14d970ef285. Other unreleased migrations were not applied.
- Exact payroll-only release gate passed: 337 migrations / 18 probes, lint/build/security/design/accessibility. Ten focused tests and baseline/concurrency scenarios passed on this baseline. Required GitHub CI checks passed; Cursor Bugbot was skipped at its usage limit, so independent native source approval remains the review evidence.
- Preview and production browser checks passed under normal CSP, including actual facility selection and the scoped empty payroll state. Production had zero runtime or HTTP errors. No customer payroll batches existed for a read-only download exercise.
- Hosted PostgreSQL regression used the real signed owner claims and real Auth helpers with the existing table grants. It proved same-line correction/reapproval, stale export blocking, excluded reapproval restoration, intermediate status recovery and historical value immutability. The fixture transaction rolled back with zero synthetic staff remaining. An initial fixture omitted a secondary batch ID; that failed transaction rolled back, the test setup was corrected, and the full regression passed.
- Real PostgREST checks confirmed all three payroll RPCs reject unknown batches 403/42501. Only the temporary release Auth session was signed out, then the request guard rejected its old token 401. No messages were sent.
- A 30-minute sampled HTTP health watch is running (/, /login 200; unauthenticated /api/rounding/tasks 401). The Verify payroll release health task follow-up will report completion/failure and push its final evidence. This is sampled availability monitoring; Sentry production error-rate access is unavailable.

## Artifacts and retained boundaries

Machine-readable evidence is in payroll-release-preflight.json, payroll-release-backup.json, payroll-release-migration-applied.json, payroll-release-production-cutover.json, payroll-release-hosted-sql-proof.json, payroll-release-hosted-api-proof.json and payroll-release-browser.json. Full local gate: test-results/agent-gates/2026-09-08T15-17-53-641Z-PAYROLL-ONLY-RELEASE.json.

The verified private production backup is retained under the recorded 0700 release run root. Temporary owner-session material was revoked and removed using an exact-path cleanup manifest. Monitor artifacts remain active until completion. Original sibling runtimes/worktrees were preserved.

Legacy exports still lack original file archives; later staff display-name changes are not frozen. Vendor acceptance and named-staff UAT remain outside this release. Hosted payroll fixture verification is transaction-rollback evidence, not a customer payroll run.
