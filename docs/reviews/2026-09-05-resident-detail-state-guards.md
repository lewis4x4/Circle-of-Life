# Resident detail state guards — 2026-09-05

Segment: `RESIDENT-DETAIL-STATE-GUARDS-2026-09-05`

Mission alignment: **pass** for this implementation — preserve unsaved clinical input during header recovery and prevent resident tab content from surviving a confirmed facility mismatch. Release readiness remains **risk** because the complete gate bundle fails on existing repository checks.

The shell now renders the header, tab strip, and child content in stable positions. A failed header projection still permits independently loaded child content in the existing scope; recovering the header does not remount that content. A confirmed missing resident blocks the tab. Changing resident or facility scope immediately hides the old content until a successful current-scope lookup, and obsolete async responses cannot restore it. A failed new-scope lookup leaves the old content hidden.

## Verification

- `npm test -- src/components/residents/AdminResidentDetailShell.test.tsx src/lib/residents/resident-detail-bootstrap.test.ts`: 8 tests passed. Includes preserved input and DOM identity after recovery, initial and retry-confirmed missing residents, pending facility changes, stale responses, and failed new-scope loads.
- `npm run typecheck`: passed.
- Chromium component fixture at 375px and 1440px: 6 assertions passed using the actual shell, tab strip, design primitives, and compiled application CSS. Navigation, facility state, modal components, and data loading were mocked; all resident data was synthetic. Verified text and DOM identity after recovery, hiding on facility change and mismatch, and initial missing-resident blocking. Visually inspected recovered mobile and missing-resident desktop renders. Machine-readable results: `test-results/resident-detail-state-guards/browser.json`.
- Full command: `npm run segment:gates -- --segment RESIDENT-DETAIL-STATE-GUARDS-2026-09-05 --ui`.
- Gate artifact: `test-results/agent-gates/2026-09-05T17-15-43-811Z-RESIDENT-DETAIL-STATE-GUARDS-2026-09-05.json`.
- Build, lint, migration naming, tracked-secret scan, gitleaks, and stress checks passed. The default one-route axe check passed; this is not authenticated resident-route validation.

## Existing gate failures

The strict bundle verdict is **FAIL**; no checks were downgraded or skipped by command-line override.

1. Required npm audit: 5 findings, including high findings in `browserslist` and `fast-uri`. `package.json` and `package-lock.json` are unchanged from base `1d5a74fa`.
2. Required design review: the schema-prose scanner includes the existing test file `src/app/(admin)/admin/referrals/hl7-inbound/new/page.test.tsx` and flags fixture text at lines 53, 149, and 159. The file and scanner are unchanged from base. The scanner stops the bundled design screenshots before they run.
3. Nonblocking local Postgres replay: fails in the database stub with `permission denied for schema auth`. The stub and replay runner are unchanged from base. There are no schema changes in this segment.

The source fix is suitable for draft review. Merge, production deployment, and authenticated production validation are not complete. Resolve the existing required gate failures and obtain passing CI before release.
