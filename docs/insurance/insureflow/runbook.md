# Local synthetic receiver verification

Mission alignment: **pass** for the isolated receiver. This is source/local proof, not staging, provider, hosted authorization, customer or live-use acceptance.

The receiver has no live connection path. The new read route is `/admin/insurance/agency-summaries`. It requires a current owner/org_admin session and reads only the database's eligible projection. Synthetic connection configuration is service-only; there is no product setup or credential entry screen.

## Repeat the checks

Use existing repository dependencies. Do not install the provider ZIP over Haven or apply its InsureFlow PolicyDetail patches here.

- `npx vitest run src/lib/insurance/insureflow src/components/insurance/agency-summaries.test.tsx src/app/api/insurance/agency-summaries/route.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run segment:gates -- --segment INSUREFLOW-RECEIVER-VERIFIED --ui`

For the database checks, create an explicitly run-owned PostgreSQL 17 UTF8 scratch cluster with the repository cleanup manifest contract. Set `PG_VERIFY_NATIVE_SOCKET`, `PG_VERIFY_NATIVE_PORT` and `PG_VERIFY_NATIVE_BIN`; the socket must be beneath `~/.hermes/tmp/agent-runs/<run-id>/`, with matching private `manifest.json`. No database URL or application credentials are accepted by the synthetic integration script.

- `REQUIRE_PG_VERIFY=1 npm run migrations:verify:pg` replays all migrations and rollback-only probes, including `review_insureflow_receiver.sql`.
- `NODE_ENV=test npx tsx scripts/insurance/verify-insureflow-receiver.ts` creates its own scratch database, replays migrations, runs the actual worker/reducer and authenticated SQL projection against supplied synthetic responses, writes a hash-pinned result and drops its database.
- `INSURANCE_BROWSER_RUN_DIR=<run-owned-directory> node scripts/insurance/agency-summary-browser-smoke.mjs` renders the real source component/CSS with mocked auth, navigation and API; see its argument contract before running. This is browser component verification, not a hosted sign-in test.

Do not point these tests at a shared database or import real account mappings. The fake provider origin is reserved `.invalid`; the injected transport has no global fetch fallback and rejects non-test/live use. Token-shaped test values are fabricated locally and are never provisioned in a provider.

## Failure and recovery

Invalid controls and transport errors preserve membership and cursor. A 401 invalidates visibility and blocks subsequent claims until a reviewed configuration action resolves it. Fenced/uncertain commits are not followed by another mutation; reread current authoritative state on a later invocation. Normal and replay cursors are separate. Recovery is bounded to three passes; exhausted/immutable-conflict releases remain unavailable and need investigation. A new provider approval resolves corrected source data under a new release ID; validator corrections require a reviewed recovery reset/revalidation for the unchanged release.

State safeguards are 8 MiB per connection and 10,000 manifest/receipt/recovery entries, with 1,000 explicit account mappings. These are local implementation bounds, not retention approvals or capacity promises. A transaction exceeding a bound fails without cursor progress. Live retention and scaling decisions remain prerequisites.

## Release and rollback boundary

The branch is stacked on insurance PR #462. Review/land that dependency first, reconcile migration numbering with other pending branches, and rerun release checks before any hosted migration. No remote migration, Edge deployment, provider patch, secret provisioning, scheduled worker or real-data transfer was performed here. To remove the local feature, stop synthetic harnesses and revert this branch; do not delete shared source records or apply destructive database rollback without a separately reviewed plan.

Live work remains open: staging origin and scoped credential delivery, exact provider namespace/integration ID, approved account-to-entity mapping, authorized readers, freshness/withdrawal timing, retention/removal rules and live-use approvals.
