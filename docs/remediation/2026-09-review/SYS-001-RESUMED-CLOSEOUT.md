# SYS-001 resumed security closeout

Scope: finish the interrupted SYS-001 authorization/lifecycle task and its independent-review corrections, then stop as instructed by the owner. The subsequent independent-review roadmap is preserved in roadmap-status.json; it is not complete and no next item was started. SYS-008 is included only as the routable facility-revocation part of this task.

## Changes and independent challenge

- Migration327 and the shared lifecycle worker replace mismatched draft RPC calls with durable restrictive/expansive commands, exact version binding, actor/session checks, audit atomicity, target leases, bounded reconciliation and terminal receipts. Existing identity/history is preserved when retiring a login.
- Independent review caught late provider writes undoing newer intent. Target serialization plus observed-state verification and a bounded watch of lifecycle-touched accounts address delayed callbacks and process death. Independent Auth security bans are retained; automatic unban requires explicit reactivation or provenance of an obsolete own ban.
- Forward SQL replacements reject nullable onboarding versions, missing rounding grants/assignments and missing operation assignee/role checks. Applied/committed migration326 was not rewritten.
- Migration328 binds ingest to a document generation. All replacement chunks, summary, optional converted text and semantic completion receipt commit together. Failed replacement preserves the earlier complete index. A superseded run cannot claim ownership back, commit output, erase newer chunks or overwrite newer status. Current profile/Auth/session/facility authority is locked after document locking.
- The current-user middleware returns a retryable503 for unavailable authority without globally signing out healthy sessions. Definitive stale/inactive authority remains denied.
- The editor retains exact lifecycle payload/request identity after uncertainty and202, distinguishes terminal action_required from pending, and allows a replacement only after an explicit successful current-access refresh. Reactivation offers current authorized facilities with no preselection, including users with no historical grant. Facility child routing and persistence are real.

Source-only independent reviews challenged these changes repeatedly; every resulting actionable blocker is addressed before source approval. The final verification artifact and commit below must be recorded before calling integrated engineering complete.

## Verification scope

Canonical TypeScript, focused lifecycle/worker/component/middleware/proxy tests, and focused Deno tests were run during development. Full ingest Deno typecheck runs with cached dependencies and nodeModulesDir=none, avoiding the existing root-node_modules resolution issue without adding dependencies or changing the Deno lock.

The initial integrated gate SYS-001-RESUMED-FINAL failed its new SQL convergence assertion while passing full lint, audit, secret scan, production build, stress, design screenshots and axe. It is retained as superseded evidence. A fresh passing replacement gate is required.

The UI gate takes four responsive screenshots of the public home route and checks axe on one route. It is not authenticated account-editor browser UAT. Component tests exercise real editor controls with mocked server responses, including no-history reactivation, lost-response idempotency and failed terminal-review refresh. Native PostgreSQL replay uses Supabase stubs, not a live GoTrue/PostgREST integration.

## Release prerequisite

Read-only checks on2026-09-07 confirmed GitHub main and published Netlify both at f3345c32fb17880a2a59e5c91949c8b82465cf4f, previous deploy6a9df313b3e3a0000876cd51. Linked Supabase project manfqmasfqppukpobpld is production; ledger is through318. CLI mixed-length migration sorting reports spurious mismatches, so never blindly push its inferred missing list. The existing seven remediation migrations319–325 and authorization migrations326–328 need a tested, matched deployment.

The PR merge triggers Netlify production and changed Edge Functions. Do not merge into an unprepared database. No existing Supabase staging branch was returned; Docker failed to respond within10 seconds when checked with host permission. The owner was asked for an existing staging project while source verification and branch publication continue. Required remaining proof: tested rollback/backup, staging signed-token matrix, hook configuration, forward migration deployment, matched application/Edge/worker release, and hosted verification. No clinical/customer UAT is claimed.

Mission alignment: pass for verified source boundaries; operational release remains gated by matched runtime evidence.

## Final integrated engineering evidence

PASS: test-results/agent-gates/2026-09-07T15-38-13-899Z-SYS-001-RESUMED-VERIFIED.json. All required checks passed including native331-migration/13-probe replay, full lint, audit, secret scanning, build, stress, design and axe. Fresh full Vitest:3,148 passed,2existing skips,0failed across521files. Edge tests:88passed with runtime network denied;87typechecked and the existing Knowledge Agent test retains its documented no-check exception. Full changed ingest module typecheck passes with cached dependencies/nodeModulesDir=none.

All independent source-review findings in the current task are addressed and approved. The last convergence defect was fixed using an explicit latest-command pointer; identical-timestamp tests remain unchanged.

The owner clarified that release work must use Haven's connected services, with no personal Docker use or separate project. Managed PITR is enabled; existing profiles are all version1 and incompatible witness methods count0. Release proceeds through an independently reviewed fixed-project script with TLS, exact reviewed SQL hashes, verified private backup preserving ownership/ACL, exact hook patch, existing pilot sign-in verification/local signout and one transactional migration batch. Hosted mutation steps are recorded separately when executed.

## Connected Haven release progress

Source commit63130958 is pushed. Private native backup completed and archive contents/ownership/ACL plus hash verified (hosted-backup.json); managed PITR also confirmed. The exact Auth token hook was installed and enabled without changing site URLs or broader configuration. Old documented demo credentials/identities were unavailable; no account was created or password changed. The confirmed existing task-owner identity was verified through a no-email temporary sign-in and locally signed out. Its token carried the correct numeric authorization version and session ID (hosted-token-probe.json).

Netlify preview6a9edeba76ec55000801b613 failed after compilation because the TypeScript worker exceeded its roughly2GiB V8 heap. GitHub gates and bundle-size checks passed. A bounded4GiB build-only NODE_OPTIONS setting is being verified; no typecheck bypass or paid compute-plan change. Database batch remains pending until the application candidate can deploy.

The production Next build passed with NODE_OPTIONS=--max-old-space-size=4096. The setting is restricted to Netlify build configuration and retains TypeScript checking. The owner-token probe confirms the enabled hosted hook; matched database deployment and preview/production checks follow.
