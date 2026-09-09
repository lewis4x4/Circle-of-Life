# Verified insurance core: validation record

Scope: uploaded originals and extraction drafts, explicit evidence review, policy term approval, legacy policy verification, dated multi-entity/facility relationships, coverage lines, renewal work and certificate request/storage. Existing claim and premium allocation links preserved.

- Full Vitest: 3,461 passed, 0 failed, 2 existing skipped (3,463 tests).
- Server/API focused tests: 27 passed. Rendered insurance journey tests: 22 passed across 6 files. Additional auth error classification tests: 4 passed. Full counts above include these tests.
- Native PostgreSQL17 replay: 339 migrations and20 SQL probes passed, using Supabase auth/storage stubs and seeded current actors/sessions. Insurance probe includes historical interval counterexamples, preserved cancellation status, restored milestone behavior, duplicate/money/owner validation, raw and audit privacy, processing privilege and idempotency. Classified historical facility-vault metadata, original paths and audit denied to facility actors; ordinary facility files and manager custody retained.
- Independent SQL re-review APPROVE after four reproduced failures were corrected. Independent consumer re-review APPROVE for nested row serialization, expired extraction leases and auth HTTP401. Classified legacy vault custody also APPROVE with native replay passing.
- Knowledge agent privileged insurance-summary facility rejection test passes under deno --no-check. Normal Deno checking reaches six existing type errors in unrelated knowledge-agent paths; this is not a clean full Edge typecheck.
- First segment gate artifact 2026-09-09T01-13-08-709Z-INSURANCE-CORE.json failed required dependency audit; build/lint/schema/security/design checks passed. Retained as failed evidence. Existing dependencies patched: Next and eslint-config-next16.3.4, sharp0.35.4, js-yaml4.3.2; no new direct dependency added. Required high/critical audit passes; three moderate existing findings remain in Vitest/mocker and Hono.

Test data is synthetic. Build environment used placeholder Supabase configuration; no production provider call, customer upload, hosted migration or real-user clinical acceptance was performed. Generic screenshot/axe gates do not prove authenticated insurance backend behavior; rendered UI/API tests and SQL runtime probes provide distinct evidence. Full servicing scope is the next segment, not claimed delivered by this core record.

Final full gate: test-results/agent-gates/2026-09-09T01-40-18-759Z-INSURANCE-CORE-FINAL.json PASS after security upgrades and compatibility fixes. Prior second failed artifact is retained:2026-09-09T01-27-48-938Z-INSURANCE-CORE-VERIFIED.json (new framework lint rules and build TS project selection).

Chromium component browser smoke:7 assertions PASS,0 axe violations across3 views,0 page errors; real two-pagePDF renders with actual document CSP/nosniff and page2 control verified. API/Auth/navigation deliberately mocked. Evidence:test-results/insurance/browser/report.json and screenshots.

After the full gate, the only functional correction was the hosting-safe4MiB upload ceiling (replacing the initial20MiB assumption). Follow-up:18 upload/extraction/rendered tests PASS; full migration replay339files20probes, full application typecheck and targeted lint PASS. This supplemental check is distinct from the earlier full gate, not an assertion that a20MiB Netlify request was tested.
