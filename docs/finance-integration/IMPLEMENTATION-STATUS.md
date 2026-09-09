# Implementation progress

In progress. No phase-level or engineering-complete marker is claimed.

- F00: source/hosted identity inventory, all79 acceptance IDs, decision/ownership registers, provisional audit candidates, exact payload and amount checks, unconditional CI and evidence runners. HFA001 verified. Business approvals and complete audit-path classification remain open.
- F01: migrations336/337 and UI/Edge repairs implemented; independent financial race/error reviews repaired concrete failures. Required native SQL/unit checks pass. Real Auth/PostgREST validation is running in a separate disposable stack.
- F02 read alignment: migration338 selects current Cash resident-money accounts/transactions in one caller-scoped statement. Finance/Forecast use this source, keep legacy balances separate and never subtract trust from AR. No historical balances are moved or approved by this read repair. Bank/book reconciliation, historical classification, transfers and cutover remain open.
- F03 staging: immutable receipt-derived events/intents, UUID and stable hash identities, generation-fenced queue/supersession, stop controls and separate worker observations are implemented and independently reviewed. External payload staysNULL and dispatchfalse. Full approval/member/policy/connection/recovery/dispatch work remains open.
- F04 onward: selected-provider integration, remaining domain/reporting/audit/close workflows, release/recovery and business acceptance are still open.

Security updates fix high/critical runtime advisories in existing packages, with six internal-navigation compatibility fixes. Two moderate Vitest/mocker advisories remain in development dependencies. Build uses existing strict source/generated-route TypeScript config; full default-config test-mock typing debt remains distinct from executed assertions.
