# COL-314 public referral intake

Evidence date: 2026-09-21

## Failure reproduced

`src/app/contact/page.tsx` and `src/components/web/tour-scheduler-modal.tsx` previously changed only local `submitted` state. They rendered “Message Received” or “Tour Confirmed” without a durable write, and the tour flow additionally claimed that an SMS had been sent.

## Correction

- Both forms now wait for a successful `/api/public/referrals` receipt before rendering success.
- The server-only route validates a strict inquiry/tour payload, derives the canonical database facility, and calls a service-role-only `SECURITY INVOKER` RPC.
- Migration `442_public_referral_intake.sql` writes the request into the existing locked referral triage inbox. Organization comes from the active facility, anonymous provenance is explicit, and the existing audit trigger commits atomically with the intake.
- A request key makes lost-response retries idempotent. Changed content under an uncertain key conflicts instead of creating a second request.
- New public requests are limited to 20 per ten minutes per server-HMAC client fingerprint. Raw connection addresses are neither stored nor logged; rejected quota requests create no intake or audit row.
- Tour copy now states that the request needs staff confirmation. It does not claim a booking, lunch arrangement, SMS, provider delivery, staff acknowledgement, or customer acceptance.

## Source verification

- Focused Vitest: 35 passed across the public route, both forms, validation, and retry hook.
- Sentry request-privacy regressions: connection headers, request bodies, cookies, query strings, and user PII are scrubbed from error and transaction events.
- Full Vitest baseline: 6,513 passed, 2 skipped across 831 files. A final concurrent run reported four timeouts/assertion races in two unrelated files; all 28 tests in those files passed immediately in isolation, and all changed-scope tests remained green. The standalone care-event parity command was not configured and is covered by the PostgreSQL replay.
- TypeScript, targeted ESLint, migration sequence/claim checks, hosted-SQL static checks, and diff hygiene passed.
- Canonical UI-inclusive segment gate passed (required hygiene, audit, gitleaks, lint, production build, stress, four-view screenshot review, and axe): `test-results/agent-gates/2026-09-21T18-53-41-129Z-COL-314.json`.
- Independent code and security review approved after fixes for bounded intake, retry identity, form spacing, untrusted forwarded headers, and Sentry request-context privacy.

## Release evidence

Production migration, merged revision, Netlify deployment, hosted route/write/denial/readback, and post-merge CI evidence are pending. This document does not claim provider, staff/device, business, clinical, customer, or release acceptance.
