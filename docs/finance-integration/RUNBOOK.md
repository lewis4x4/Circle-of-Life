# Finance integration verification and operation

All new external writes remain disabled. Never point migration replay at production. Local verification does not authorize cutover or prove business acceptance.

## Commands

- `npm run test:finance-integration`: executes finance integration Vitest behavioral assertions; emits dated JSON with individual test/acceptance IDs, counts, zero-skip requirement, synthetic target, commit and timing under `test-results/finance-integration`.
- `npm run test:platform-audit`: executes platform audit Vitest behavioral assertions and emits the same evidence envelope. Shared CSV tests are a narrow starting layer, not complete platform audit coverage.
- `npm run test:finance-webhook`: executes24 synthetic Deno QBO signature/schema assertions without application permissions and retains case-level JSON, source/test hashes and JUnit. It does not start a receiver or prove durable inbox/provider delivery.
- `npm run test:audit-edge`: executes Deno audit exporter boundary tests with only CORS environment permission, and retains JUnit plus case-level JSON.
- `npm run test:finance-provider-contract`: executes four synthetic Node transport/identity assertions, with no provider calls.
- `npm test`: full source Vitest suite. The generic segment runner does not run it.
- `npm run typecheck`: strict source TypeScript; run explicitly alongside the segment gates.
- `REQUIRE_PG_VERIFY=1 npm run migrations:verify:pg`: all numbered migrations plus selected SQL probes against a disposable PostgreSQL instance with Supabase stubs. `review_*.sql` naming is required for new probes.
- `npm run segment:gates -- --segment HFA-<bounded-segment>`: required hygiene, secret, dependency, lint, SQL/build and stress checks. Add `--ui` for UI changes with a run-owned preview URL. Do not disable assertions, relax budgets or label skips as passes.

Native PostgreSQL alternative: set `PG_VERIFY_NATIVE_SOCKET` to an exact run-owned scratch directory beneath `~/.hermes/tmp/agent-runs/<run-id>`, `PG_VERIFY_NATIVE_BIN` to installed PostgreSQL 17 binaries, and `PG_VERIFY_NATIVE_PORT` to its socket port. A private `manifest.json` must match the run directory and `created_by: codex`. Initialize with UTF8 explicitly. This path is not a full Supabase Auth/PostgREST emulator. Never reuse an existing server whose provenance is unclear.

The unconditional `Finance and platform audit verification` CI workflow runs deterministic tests and required segment gates on PRs without HAVEN_UI_GATES_ENABLED. Branch-protection configuration and actual CI execution remain separately verifiable; a workflow file alone is not enforcement evidence. `npm run test:finance-provider -- --provider=qbo --mode=read-only` is the bounded identity smoke. Supply HFA_QBO_ENVIRONMENT=sandbox (default) or production, HFA_QBO_REALM_ID, an independently verified HFA_QBO_EXPECTED_REALM_ID HFA_QBO_EXPECTED_COMPANY_INFO_ID, HFA_QBO_EXPECTED_COMPANY_NAME_SHA256 (UTF8 exact CompanyName SHA256), and HFA_QBO_ACCESS_TOKEN through secured environment injection. Bind the expected values independently to the approved realm; CompanyInfo.Id is not assumed to equal the OAuth realm. It performs only a CompanyInfo GET to a fixed Intuit host, rejects redirects/unsupported flags, checks exact returned identity and emits sanitized evidence. Missing configuration exits 2 with BLOCKED_EXTERNAL; identity/transport failures exit 1. No accounting mutation is implemented in this runner. Full controlled import/booking tests and Desktop/Quicken runners remain open pending selected-provider engineering and facts.

## First operational checks

Verify current entity/company map, payload and book policies, named approver roles, opening reconciliation and deployment identities before any provider mutation. Queue state, provider acknowledgment, posting and bank settlement remain distinct. Unknown provider outcome blocks resubmission until supported readback establishes uniqueness. Changed payload invalidates approval; revoked user scope blocks processing and retrieval. Source health must show missing, stale, incomplete or unreconciled values explicitly.

## Failures and recovery

Stop new outbound effects, preserve commands/receipts, assign the exception and reconcile supported provider evidence. Never bulk-delete accounting records or regenerate historical invoices to erase a release. Recover with dispatch paused; do not resume until independently durable evidence has restored the exact source/member/approval/command identities. Retention disposal is outside run-artifact cleanup.

For authenticated UI gates, supply `HAVEN_UI_STORAGE_STATE` with a private Playwright state file created only from synthetic actors in the verified disposable Supabase project. Both design review and axe load it for each context; existing redirect rejection prevents login screenshots from being counted as requested admin-route evidence. Keep state/cookies out of repository artifacts and do not reuse production staff sessions for fixture tests.

`node scripts/finance-integration/authenticated-smoke.mjs --config=<private-local-file> --suite=audit|finance` is a run-specific, guarded realAuth/PostgREST probe. It requires this run's verified container/project identities and emits structured BLOCKED_EXTERNAL when prerequisites are missing. It must never target production; do not bypass its guards to reuse it for another environment. Current runtime failures are preserved in authenticated-runtime-blocker.json.
