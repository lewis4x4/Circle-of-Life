# COL-293 signing-link authorization evidence

Date: 2026-09-20. Mission alignment: pass.

## Bounded outcome

Prevent signing-link disclosure after the caller loses current facility authority during a BoldSign link request. Preserve the existing entry/pre-provider checks and contract send lifecycle. Provider send/local-write retry recovery remains COL-294. No migrations or shared authorization semantics change.

## Reproduction and correction

Base: origin/main `9d7e5686`. The existing characterization passed while explicitly expecting HTTP 200 and an embedded signing link after facility access was revoked in the last provider request. Converting it to the required HTTP 403/no-signing-data assertion failed: actual 200, expected 403 (5 passed, 1 failed).

The handler now checks current authority after each link response body has been consumed (also for unsuccessful responses), and again immediately before the final success response. A denied check returns only the sanitized 401/403 error; it never returns previously accumulated links or document identifiers. Existing authorized multi-site nurse behavior remains supported.

## Focused verification

`deno test --allow-env --no-lock supabase/functions/boldsign-send-contract-handler.test.ts supabase/functions/_shared/current-actor.test.ts`: 18 passed, 0 failed, including native type checking. Transport is replaced with synthetic responses; no runtime network permission or live credentials are supplied.

Coverage includes entry denial, disjoint facilities, pre-send and pre-link revocation, authorized success, in-flight last-link revocation, later-signer delayed body revocation after a prior link was accumulated, role loss, absent current actor, failed provider response with revoked authority, and final success-boundary denial. Later signer requests stop on denial. Existing three send-state mutations are preserved.

The same command is now an unconditional CI step after Deno setup. An independent read-only reviewer approved the handler, tests, and workflow after running diagnostics, native type checking, and the 18-test command.

Supplementary Deno lint flags three pre-existing conventions: two URL imports (`no-import-prefix`) and the existing async fetch double (`require-await`). No new lint diagnostic remains in the added test code. Repository ESLint remains a separate required gate.

## Repository verification

- `npm run typecheck`: passed.
- `npm test`: 819 files passed; 6,433 tests passed, 2 skipped. Standalone care-event database parity skipped because no parity database was supplied; the segment replay runs its own isolated database parity.
- `npm run segment:gates -- --segment COL-293-signing-link-authorization`: required local gates PASS, including ESLint, audit (zero vulnerabilities), secret checks, migration ordering, production build and stress suite. Artifact: `test-results/agent-gates/2026-09-20T13-44-37-418Z-COL-293-signing-link-authorization.json`.
- That artifact also records a failed locally optional PostgreSQL probe: `review_authoritative_actor.sql` raised `Deferred time must be in the future`. Its unchanged fixture initializes a one-second deadline before completing another operation. Application tests ran concurrently. The isolated replay applied migrations and passed 105 level-parity cases before this probe. A serial replay with `REQUIRE_PG_VERIFY=1` is pending; CI requires this gate. No all-gates-green claim is made.
- UI/a11y checks not run: no user-interface change.

## Release boundary

This evidence is local/synthetic engineering proof. No live BoldSign request, hosted database mutation, Edge Function deployment, staff UAT, or release acceptance was performed. Previously sent provider documents and local state are not rolled back on authorization denial; that existing recovery boundary belongs to COL-294. Security-change merge/deployment remains on hold for owner review.
