# F04 QBO read capture contract

Status: source implementation and synthetic tests only. QBO remains the reference path; D01 actual products, editions and company files are unresolved. This module is not an importer, complete scan, reconciliation, close sign-off or production activation.

## Implemented boundary

`supabase/functions/_shared/qbo-read.ts` exports `captureQboRead(input, fetchImpl?)`. Existing platform fetch is the runtime transport; injection is exclusively trusted composition/testing. There are no new dependencies, receiver endpoints, SQL, credential discovery, retries, POSTs, provider mutations or durable writes.

The caller provides fixed `environment`, `companyId`, `expectedCompanyId`, `minorversion`, access token, operation and optional cancellation. Production is rejected unless trusted engine configuration explicitly sets `allowProductionRead: true`. Equality between caller-provided company IDs is a consistency check, not provider identity verification or current authorization. The common engine must supply and revalidate actual authority, connection generation, company/app/environment identity, stop controls and grants before dispatch and publication. Never accept production enablement, fetch implementations or binding assertions from browser request data. Merely importing this module does not activate it.

Hosts are exactly `sandbox-quickbooks.api.intuit.com` and `quickbooks.api.intuit.com`. Requests are GET, no-store and manual-redirect; 3xx, redirected responses and unexpected response URLs are rejected. No arbitrary host, path, query language or report name is accepted. Minorversion is explicitly supplied, with a defensive integer range 1–999 rather than an asserted latest version. Company/account IDs use a defensive positive decimal-string profile up to 40 digits; SyncToken uses a nonnegative decimal-string profile. Provider variants outside this profile are unsupported, not normalized into different identifiers.

Allowed operations:

```text
account_count:
SELECT COUNT(*) FROM Account WHERE Active IN (true,false)

account_page(startPosition >= 1, 1 <= maxResults <= 1000):
SELECT * FROM Account WHERE Active IN (true,false)
  STARTPOSITION {startPosition} MAXRESULTS {maxResults}

GET /v3/company/{companyId}/query?query={URLSearchParams encoded query}&minorversion={version}

general_ledger(startDate, endDate, basis, currency):
GET /v3/company/{companyId}/reports/GeneralLedger
  ?start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}
  &accounting_method={Cash|Accrual}&minorversion={version}
```

Calendar dates must exist and start must not exceed end. Currency is the expected three-letter uppercase report currency, not an implied USD default. No arbitrary six-month restriction is imposed: the documented six-month guidance is a heuristic, not a completeness guarantee. TrialBalance and JournalEntry operations are not implemented in this module. TrialBalance date/as-of semantics remain unverified; JournalEntry scan/readback belongs to later bounded work.

## Capture and privacy

Default/max capture bound is 8 MiB; timeout defaults to 30 seconds and is configurable from 1 ms through 60 seconds. These are Haven resource policies, not provider limits. Deadline/cancellation cover transport and stream consumption, including injected transports that ignore AbortSignal. An absolute performance.now() deadline is checked before/after stream reads and after schema validation; every 64 reads yield to timers/caller cancellation. One bounded byte buffer prevents zero/tiny chunks from growing a chunk-object list. The stop reason is settled before underlying abort so compliant AbortError rejection cannot replace timeout/aborted classification. Cancellation input is checked using the intrinsic AbortSignal brand getter; cleanup uses intrinsic listener methods and cannot throw for malformed signal input. Early-refused and late-arriving bodies are cancelled. An indefinite provider read never advances a checkpoint. The bounded synchronous decoder/schema validation occurs after receipt; the deadline is checked afterward but is not a CPU preemption mechanism. Digest calculation follows validation and is not asserted to finish within that deadline.

`logSummary` contains only fixed code, HTTP status, byte count, capture-complete boolean and `scan_complete: false`. It contains no token, company/account identifiers, names, memo text, raw provider errors or monetary values. Exception messages are suppressed. `privateMetadata` contains only private account IDs/SyncTokens/count or report no-data declaration and must not be ordinary-logged.

`privateEvidence.copyCapturedBody()` returns a defensive byte copy. `captured_sha256` hashes exactly those retained bytes. **When `capture_complete` is false, this is only a prefix hash, never a whole response hash.** An early Content-Length refusal can have no captured evidence. Absent, empty or identity Content-Encoding retains Content-Length equality checking. Non-identity encodings may describe compressed bytes while fetch returns decompressed bytes; decoded byte bounds remain enforced, but encoded wire-length integrity is delegated to platform fetch. Complete transport capture of malformed JSON remains capture-complete but unsuccessful; this flag never means valid schema, complete provider data or complete scan. The accessor is a naming/API boundary, not encryption, authorization or durable storage. The engine must apply restricted encrypted evidence storage and retention before use. Ordinary JSON serialization contains neither raw bytes nor monetary payloads.

The JSON parser rejects malformed grammar, duplicate decoded object keys, invalid UTF-8, nesting beyond 40 and more than 500,000 values. Numeric literals remain private lexical tokens; monetary literals never undergo JavaScript Number conversion or appear in returned metadata. Only bounded pagination/count integers are converted after exact grammar and safe-integer checks. Raw bytes preserve large decimal literals, exponents, whitespace and ordering exactly. This does not validate accounting meaning or convert provider money into Haven cents.

## Response semantics

Account results validate the expected envelope, account array, unique IDs, SyncTokens and explicit boolean Active. Nonempty pages require matching requested startPosition and `maxResults` equal to actual returned record count; optional totalCount must not be less than page length. Empty QueryResponse is accepted as a live empty observation, not proof of absence or a completed scan. Count responses require a safe exact totalCount and no page/entity payload. Unknown envelope entities are rejected. These conservative compatibility expectations require actual provider fixtures before activation.

GeneralLedger validates report name, exact requested date range, basis, currency, timestamp, columns, recursive Section/Data rows, matching cell counts and one NoReportData declaration. Report groups, Data/Section rows, headers/summaries, columns and cells reject unknown keys that could hide additional financial rows. Header.Time requires a real civil date, hours 00–23, minutes/seconds 00–59 and valid offset fields, with up to nine fractional digits; leap seconds and 24:00 are unsupported. ColData monetary strings stay in raw evidence. Fault and warning keys, the documented oversized-report message, malformed/unknown row shapes and a local observed cell count reaching 400,000 are rejected even on HTTP 200. The cell check is conservative; it does not prove the provider returned everything. NoReportData=true is a provider declaration, never an automatic zero ledger; contradictory data rows are rejected. Previously unseen legitimate provider report variants must receive a reviewed fixture/schema extension rather than a permissive fallback.

Failures are fixed `invalid_config`, `scope_mismatch`, `production_disabled`, `aborted`, `timeout`, `transport_error`, `redirect_rejected`, `auth_required` (401), `access_denied` (403), `not_observed` (404), `throttled` (429), `provider_unavailable` (5xx), `http_error`, `body_too_large`, `body_incomplete`, `invalid_response`, `provider_fault` or `provider_partial`. No retry is performed and raw error text is never surfaced in ordinary diagnostics. Non-200 bodies are bounded and preserved when possible; a capture failure can supersede HTTP classification while retaining HTTP status.

## Evidence and unresolved provider guarantees

Research checked September 9, 2026. Main Account/JournalEntry/query docs returned compilation placeholders; GeneralLedger/TrialBalance pages timed out. The following are primary sources, not actual account calls:

- [Official PHP SDK query guide](https://intuit.github.io/QuickBooks-V3-PHP-SDK/quickstart.html#query-resources): 1,000 maximum records, default 100, STARTPOSITION/MAXRESULTS and COUNT. No projection, JOIN, GROUP BY or OR support.
- [Official Intuit query article](https://medium.com/intuitdev/deep-dive-into-quickbooks-online-data-queries-b77034bdc144): explicitly include Active true/false to retrieve inactive name-list entities; Account is a name-list entity.
- [Pinned Intuit entity model](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/5bb480b505726d9f7b89ff0747b9acc629236a77/src/Data/IPPIntuitEntity.php): ID and SyncToken are strings, versions change on modification, only latest entity version is retained.
- [Pinned report construction](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/5bb480b505726d9f7b89ff0747b9acc629236a77/src/ReportService/ReportService.php), [header](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/5bb480b505726d9f7b89ff0747b9acc629236a77/src/Data/IPPReportHeader.php) and [cells](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/5bb480b505726d9f7b89ff0747b9acc629236a77/src/Data/IPPColData.php): GET report route, date/basis parameter names, response header fields and string cell values. A generic SDK setter is not proof every report accepts the parameter.
- [Official February 2026 report guidance](https://medium.com/intuitdev/quickbooks-online-reports-api-best-practices-and-troubleshooting-31edc9934b4c): 400,000-cell cap may produce an error or partial response; GeneralLedger supports start/end dates; NoReportData still returns structural content; accounting basis must match. Date chunking is recommended for large reports, not presented as an immutable snapshot mechanism.
- [Official Line.Amount decimal model](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/cda0609a-fc32-86b3-0cff-02d7e9aa9c75.htm): decimal money representation. No universal provider monetary scale/magnitude bound verified.
- [Official 2018 API best practices](https://blogs.a.intuit.com/2018/09/10/quickbooks-online-api-best-practices/): historical throttling guidance and HTTP429. Current quotas and guaranteed Retry-After/remaining-quota headers were not verified; no assumed retry policy is implemented here.

No verified guarantee establishes deterministic ID tie ordering, a cross-page snapshot token, stable membership during offset scanning, historical deleted-object completeness, or cross-report atomicity. Even matching before/after counts and duplicate-free pages can miss concurrent balanced additions/deletions. A full live scan requires orchestration, all pages, scope/count evidence and change detection; it must still be labeled as a live scan. CDC's limited window/result cap does not prove complete history or write absence. Immutable retained raw captures make the observations reproducible, not the provider state atomic.

Remaining gates include integration into the authenticated common engine; durable scoped encrypted capture/import state; quotas/retry scheduling; full pagination; authoritative company bindings and provider fixtures; approved mappings/currency/basis; controlled close/freeze/export assurance; named per-entity reconciliation; restore/recovery; and independent release approval. Source tests satisfy none of those external gates.

## Verification

Run `deno check`, `deno lint` and `deno test` on the two shared files. All test data are synthetic and fetch is injected; tests run with no network/environment permissions and make no provider calls. Tests cover request construction, inactive accounts, configuration/scope denial, production default, redirects, status classification, body bounds/truncation, stalled/late transports, cancellation, duplicate/malformed JSON, inconsistent pages/reports, private canaries and byte-exact huge decimal preservation using an independent Node SHA-256 oracle. Root must independently review before integration.

Author verification after independent REQUEST CHANGES: Deno check and lint passed; 98 permanent synthetic tests passed, zero failed or skipped. The earlier 72-test source at SHA-256 24a1710c6c0883cf915840340317e191cefa3f4b4dc5cafb0ca56d2b69b561a1 failed six independent boundary findings; the original reviewer artifacts remain retained separately. Permanent tests now reproduce stream starvation/zero-chunk storage, invalid civil timestamps, identity-encoding length mismatch, hidden report members, malformed cancellation values and AbortError classification races. Tags HFA-028 and HFA-036 identify supporting source checks only; HFA-028 still requires actual provider proof and no acceptance status is changed by this work.
