# Stand Up pilot validation

Mission alignment: **pass for bounded pilot implementation and testing**. Automatic Google operation and real staff acceptance remain separate activation checks.

Implemented: facility-scoped weekly reports, explicit monthly rent roll, reported-versus-verified distinction, immutable revision receipts, optimistic concurrency and retry, history comparisons, staged imports and reversal, baseline-bound three-way recovery, durable conflict decisions, exact-file conditional workbook bridge, prior-week recovery backlog, and independent signed Front Office publication.

Verification performed during the September 10–11 build:

- Full Haven suite: 542 test files, 3,441 passed, two existing skipped tests.
- Python workbook/bridge suite: 29 tests passed, including conditional rejection, unknown successful write readback, rejected file edit recovery, prior-week rollover, namespace preservation and boolean/sparse-coordinate rejection.
- Native PostgreSQL replay: 339 migration files, 20 SQL probes, including authorization, CAS/idempotency, batch atomicity/reversal and recovery decisions.
- A separate two-session lock-wait test denied a save when the actor was revoked during the wait, persisting zero reports.
- Genuine native GoTrue/PostgREST staging: current actor and workspace calls passed; revoked-session access was denied. Auth helpers were real, not stubbed; Storage HTTP was not part of this pilot.
- Authenticated browser: real form login, save receipt, cents/zero preservation, conflicting file preview, explicit resolution and queue removal passed. Desktop and phone views passed overflow checks; main-content WCAG2A/AA/2.1AA axe checks reported zero violations and no console/page errors.
- Production build, full release TypeScript and lint passed. Required segment gate artifact: `test-results/agent-gates/2026-09-11T01-48-12-246Z-STAND-UP-PILOT.json`. That gate's visual check covers login; the authenticated Stand Up check is separately recorded above.
- Critical/high dependency findings were removed by updating existing Next/eslint-config-next, sharp, Hono and js-yaml versions. Two moderate transitive findings remain recorded in private release evidence. Generic secret detection remains active; three exact historical false-positive fingerprints were verified as source digests and a rejected synthetic test input.
- The actual 2026 September 7 workbook packet parsed five facility records with zero issues. A local patched copy read back correctly, preserved other facility values and unchanged ZIP members outside the targeted worksheet/calculation settings. This did not modify Google Drive or prove viewer formula recalculation.
- The migration was rehearsed in a rolled-back transaction against Haven's live schema after a verified backup; no pilot tables remained afterward.

Independent security and functional reviews approved the corrected local/rehearsal scope. They did not approve untested Google conditional-write behavior, displayed formula recalculation, unattended credentials or staff acceptance.

Limits: no claim that all historical years are normalized; unsupported/overlapping dates or fields are held for review. Native/CI proof does not certify clinical, customer or full organizational launch readiness. Follow `scripts/stand-up/README.md` for provider activation and Monday operator testing.
