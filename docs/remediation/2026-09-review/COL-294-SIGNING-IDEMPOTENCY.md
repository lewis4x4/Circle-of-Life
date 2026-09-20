# COL-294 / SYS-006 — signing delivery idempotency

Evidence date: 2026-09-20

## Outcome

Haven now owns one durable, immutable-generation send intent before BoldSign I/O and records verified webhook receipt plus contract/signer projection in one transaction. Ambiguous provider outcomes never auto-resend. Definite rejection requires a new request generation. Provider success with changed local inputs is retained for reconciliation without projecting stale signer or contract state.

This is source and engineering verification. No production migration, Edge Function deployment, live BoldSign send/webhook, staff/device UAT, legal approval, customer acceptance, or release acceptance is claimed.

## Reproduced failure

- The prior send handler called BoldSign before a durable claim, then ignored three independent local write results. A provider-created document could be lost locally and a retry could create another.
- The prior webhook handler projected contract/signer state before duplicate detection, missed the documented nested `event.id`, `event.created`, and `event.eventType`, and allowed older/lower events to regress state.

## Correction

- Migration `439_signing_delivery_idempotency.sql` adds immutable attempt generations, a database-built provider/signer snapshot, opaque recovery labels, explicit ambiguous/definite/committed/reconciliation states, trusted lifecycle-field guards, provider environment binding, append-only events, canonical event-content conflict detection, advisory serialization, monotonic provider-time projection, and service-role-only atomic commands.
- `boldsign-send-contract` claims before I/O, transmits only the stored snapshot, persists provider truth before post-send disclosure checks, surfaces every receipt/commit failure, resumes links from a committed document, and refuses automatic resend after uncertainty.
- `boldsign-webhook` verifies the raw-body HMAC, parses the official nested envelope and signer context, streams a 1 MiB body cap, requires the configured provider environment, and makes one atomic database call.
- Existing current-actor, organization, facility, role, and final embedded-link disclosure checks from COL-293 remain in force.

## Verification

- Focused Deno: 36 passed across send, webhook, and current-actor suites.
- Application Vitest: 819 files passed; 6,434 tests passed; 2 skipped; 0 failed.
- TypeScript typecheck: PASS.
- Full ESLint and constitution lint: PASS.
- Production build: PASS, 509 static pages generated.
- Migration order/hosted SQL checks: PASS, 442 migrations through `439`.
- PostgreSQL 17 replay: PASS, 442 migrations, 84 SQL probes, 7 acceptance suites, and 105-case care-event parity.
- Two-session PostgreSQL proof: PASS for identical/competing send claims, identical/conflicting concurrent webhook deliveries, provider-response/webhook race, and signer-mutation reconciliation without projection.
- Environment example scan, tracked-secret scan, and dependency audit: PASS; 0 high-severity dependency vulnerabilities.
- Independent functional, security, and code-quality reviews: APPROVE after corrections.

## Rollback and remaining gates

Before application, rollback is reverting this bounded source change. After migration application, rollback requires restoring the prior Edge Functions only after preserving send claims/event history and explicitly reconciling every nonterminal or ambiguous attempt; do not drop receipt/history rows as a shortcut.

Production application and deployment remain a human-gated operation. Live provider behavior, hosted schema/function readback, named staff/device acceptance, legal validity, customer acceptance, and release acceptance remain unperformed.

Mission alignment: **pass** — the correction preserves facility/organization authority, audit history, recovery, and human/legal acceptance boundaries while preventing duplicated or regressed resident-contract state.
