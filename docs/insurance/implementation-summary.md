# Haven insurance implementation

Implemented on `codex/haven-insurance-workspace`, based on main `fad17dcc`. Review: [PR462](https://github.com/lewis4x4/Circle-of-Life/pull/462). Core commit: `118356c6`; servicing and final integration follow in the same branch. No production migrations or releases were performed.

## Delivered

- Private document intake with validated bytes/checksum, quarantine/scanner integration, immutable originals, authenticated streaming and recoverable extraction leases. A provider returns drafts only; manual review works without provider configuration. Extraction provenance is retained.
- Source-side policy review with exact entity/facility matching, explicit unknowns, manual reasons or page evidence, version-checked approval and immutable history. Legacy verification keeps policy IDs and lifecycle status. Renewals and dated endorsements preserve prior terms/schedules. Shared policies and coverage lines count the policy premium once.
- Renewal ownership/milestones with duplicate prevention and recovery; internal certificate requests remain distinct from issued evidence and never create policies.
- Versioned renewal packages with frozen prepared names/schedules, approved-version export/print, separately recorded sharing/acknowledgment, and audited operational reassignment.
- Vendor certificate requirements, supporting endorsements and reasoned exceptions; carrier loss report valuations, explicit no-loss evidence, correction supersession, duplicate controls and null-aware totals.
- Restricted incident-linked insurance matters and workforce exposure summaries with separate estimated/actual payroll, state/class mappings and source/broker confirmation. No clinical content or individual payroll is automatically copied.
- Manager-only raw records, originals, audit trails and legacy portfolio PDF access; approved facility summaries and certificate requests remain available to facility administrators. Named incident choices expose date/type/facility metadata only.

The old mutable renewal-generation endpoint is retired and historical packages remain read-only in the UI. Legacy payload edits invalidate their old approval stamps in the database. The existing executive insurance scoring formula remains unchanged and is clearly labeled a legacy heuristic; it is not the authority for new verified shared-policy records or coverage assessment.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Full application tests |3541 passed,0 failed,2 existing skips|Final test summary in implementation-summary.json|
| Full release gates |PASS|test-results/agent-gates/2026-09-09T03-08-27-475Z-INSURANCE-RELEASE-VERIFIED.json|
| Prior servicing gates |PASS|test-results/agent-gates/2026-09-09T02-47-01-055Z-INSURANCE-SERVICING-FINAL.json|
| Database replay |340 migrations,21 SQL probes PASS|Release gate|
| Durable concurrent authorization tests |4/4 PASS,zero forbidden mutations|test-results/insurance/authority-races/1788923308350-72147-85c74970.json|
| Browser component journey |18 checks PASS,0 page errors,0 axe violations across7 views|test-results/insurance/browser/report.json|
| Independent reviews |SQL,consumer and portfolio-boundary APPROVE|Scoped review record below|
| Maintainability pass |Behavior preserved;40 tests before/after|cleanup-report.md|

Database checks use real PostgreSQL/current-actor/session logic with Supabase service stubs. Browser tests use real components/CSS/Chromium/PDF rendering while Auth, API and Next navigation are explicitly mocked. The native PDF viewer was checked on page2; approved package PDFs and frozen-null-owner printing were visually inspected. These are distinct evidence layers, not hosted acceptance.

Independent review reproduced and corrected historical endorsement access rewrites, cancellation reactivation, unrecoverable reminders, legacy table/audit/export bypasses, strict-schema UI serialization errors, abandoned lease retry blocking, incorrect authentication HTTP status, stale review resubmission, missing shared-policy choices, prepared-label drift, and queued actor/assignee revocation races. The durable race runner preserves four of the concurrency counterexamples. Prior failed gate and browser attempts remain in test-results rather than being overwritten as passes.

## Source map

- `supabase/migrations/336_insurance_verified_workspace.sql`: reviewed intake, terms, relationships, reminders, certificate requests, authority locks and legacy custody.
- `supabase/migrations/337_insurance_servicing_records.sql`: five servicing record families, immutable versions, reviewed transitions, reassignment, exports and portfolio storage protection.
- `src/app/api/insurance/` and `src/lib/insurance/`: validated client/service boundaries, extraction adapters, types and request handling.
- `src/components/insurance/` and canonical `/admin/insurance` wrappers: operator workflows, source viewer and review/servicing screens.
- `scripts/insurance/`, `supabase/tests/review_insurance*.sql`, `test-results/insurance/`: durable regression runners, fixtures and evidence.
- `docs/insurance/runbook.md`: configuration, operation, hosting envelope and release procedure.

## Deployment and acceptance boundaries

Migration336 and337, runtime and the knowledge-agent permission guard require a coordinated release. The branch/PR is reviewable; production remains unchanged. No actual customer insurance documents were imported, no roster/ownership relationships were invented, and no broker messages, certificates or claims were sent/issued.

Extraction remains opt-in; no live provider call was made during verification. Actual provider performance and supported document families require a representative authorized/redacted corpus and agreed reviewer thresholds. Files currently use a hosting-safe4MiB intake limit. Monetary fields retain the existing signed integer-cents range; larger policy/exposure amounts need an explicit schema widening. Unclassified historical vault copies require a custody inventory. Claims medical-data processing, cross-business sharing rights and broker/finance/clinical sign-off remain separate from the engineering result.

Required high/critical dependency audit passes after patching existing Next/eslint-config-next16.3.4, sharp0.35.4 and js-yaml4.3.2. Three pre-existing moderate findings remain in Vitest/mocker and Hono. No new direct dependency was added. The targeted knowledge-agent permission regression passes; a full Deno typecheck still encounters six pre-existing errors in unrelated knowledge-agent paths.

Mission alignment:PASS for the implemented engineering scope. This is not a coverage opinion, clinical acceptance or production-launch approval.
