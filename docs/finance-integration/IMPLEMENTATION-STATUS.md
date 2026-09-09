# Implementation progress

In progress. No phase-level or engineering-complete marker is claimed.

- F00: source/hosted identity inventory, all79 acceptance IDs, decision/ownership registers, provisional audit candidates, exact payload and amount checks, unconditional CI and evidence runners. HFA001 verified. Business approvals and complete audit-path classification remain open.
- F01: migrations336/337 and UI/Edge repairs implemented; independent financial race/error reviews repaired concrete failures. Required native SQL/unit checks pass. Real Auth/PostgREST validation is running in a separate disposable stack.
- F02 read alignment: migration338 selects current Cash resident-money accounts/transactions in one caller-scoped statement. Finance/Forecast use this source, keep legacy balances separate and never subtract trust from AR. No historical balances are moved or approved by this read repair. Bank/book reconciliation, historical classification, transfers and cutover remain open.
- F03 staging: immutable receipt-derived events/intents, UUID and stable hash identities, generation-fenced queue/supersession, stop controls and separate worker observations are implemented and independently reviewed. External payload staysNULL and dispatchfalse. Full approval/member/policy/connection/recovery/dispatch work remains open.
- F04 onward: selected-provider integration, remaining domain/reporting/audit/close workflows, release/recovery and business acceptance are still open.

Security updates fix high/critical runtime advisories in existing packages, with six internal-navigation compatibility fixes. Two moderate Vitest/mocker advisories remain in development dependencies. Build uses existing strict source/generated-route TypeScript config; full default-config test-mock typing debt remains distinct from executed assertions.

Cash response-scope repair: stale facility/account responses and post-completion callbacks cannot replace the selected ledger or clear another account form; error is separate from empty. Eight independent component regression cases passed. Durable cash command recovery remains open.

F03 local batch review: migration340 adds immutable declared rule versions, exact payload/member/source hashes, independent local review, current-actor/session-expiry checks, invalidation and atomic unsent supersession. Both reviewers approve this bounded source. All batches remain unverified accounting classification, business release ineligible and dispatch disabled. Native343 migrations/24probes/53 batch assertions and separate concurrency/privilege/parity checks passed; HFA-F03-BATCH gate passed. Discovery/workbench341 remains separate work.

Exact money input: dollar parsing no longer rounds fractional cents or accepts malformed grouping/exponents. Journal callers reject invalid entered lines, preserve unbalanced drafts and distinguish per-line storage bounds from larger aggregate totals. Independent45 scoped cases and focused finance70cases pass; full local suite3521cases passes with0skips. These counts are not provider or full authenticated workflow evidence.

F03 discovery/workbench: migration341 and /admin/finance/integration provide current-authorized live pages of events, local batches and declared rules, plus separately authorized batch detail. Existing primitives, exact amounts and Eastern display are retained. Independent100SQL assertions cover2509events/26pages;36 source and32 actual-component synthetic browser checks pass, Axe0violations, visual93. Full3557unit cases and HFA-F03-WORKBENCH gate pass (344migrations/25SQLprobes/build/lint). Real Auth/routed application/provider/business acceptance remain open.
