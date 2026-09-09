# Finance build resumption

Overall task remains IN_PROGRESS. No full phase, engineering-complete or goal-complete claim.

Workspace: `/Users/brianlewis/Circle of Life/Haven Finance Integration`
Branch: `codex/haven-finance-integration`
Refreshed upstream main: `fad17dcc4bd2dc1deb35400b309c65a047b8de83`; integration merge `63e8909a6b17ed11a398052d5baa4de6eec2aeba`. Original source checkout and seven unrelated untracked files remain byte-identical.

Reviewed initial source scope: F00 registers/payload/tests/CI/security compatibility, F01 migrations336/337 and callers, F02 migration338 and current resident-money reads. Independent source approvals are in INDEPENDENT-REVIEWS.json and the task history. Native341 migrations/22 probes, full3473 unit assertions with0 skips, source typecheck and source/public-shell gates pass. Actual owner login and empty trust page rendered through real local Auth. Scoped authenticated axe still failed at its unchanged20-second load budget; it is not waived.

Run-owned local test infrastructure: `~/.hermes/tmp/agent-runs/hfa-20260908-01a08335/`. Native PostgreSQL17 uses its Unix socket on55447. Full Supabase project is `hfa-01a08335`; Docker DNS and engine operations are intermittent. Only this run's containers were changed. Real Auth helpers were not replaced with stubs in that stack. Private connection/credential files are beneath `full-supabase/` and must not be committed. Preview is `http://127.0.0.1:4317`; proxy59331 reaches actual local services, standaloneDeno browser gateway59332 adds the exact audit handler. Check current health/config before resuming, since isolated Auth repair is ongoing.

F03 staging source is independently approved but remains in run-owned `f03-outbox/` pending initial checkpoint integration: migration339, review_finance_event_outbox.sql, F03-EVENT-CONTRACT.md. Final migration hash `ffb4f41d3454b4d8d89c90be538edeef894b8689ce0a16ecee9e431f602e65b3`;56 new assertions,342 total migrations/23 probes and controlled races passed. It keeps payloadNULL/dispatchfalse. It does not implement full approval, provider binding, dispatcher, recovery or later phases.

Next executable work: finish or accurately block authenticated API/browser evidence; integrate/replay reviewed339; implement remaining F03 approval/member/recovery infrastructure and continue independent later engineering. Maintain all79 IDs. Do not classify opening records, mark providersN/A, activate production, or claim live acceptance without required evidence.

Missing business facts are already asked once: accounting products/editions/company files per active entity, actual payroll provider and controller/accountant. Named privacy/book/cutover policies, recovery targets and activation authority remain open in DECISIONS.md. A sharedDockerrestart would interrupt unrelated projects; approval question is pending, and no sharedrestart is authorized yet.
