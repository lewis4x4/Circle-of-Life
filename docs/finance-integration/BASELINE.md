# Finance integration baseline

Captured 2026-09-08. Mission alignment: risk until financial integrity, audit and named acceptance gates pass.

- Reviewed and actual source HEAD: `3dec84bbdc216d1c58e7296568b007ebe6f101be`.
- Original branch: `codex/haven-home-login`; original checkout: `/Users/brianlewis/Circle of Life/Circle-of-Life`.
- Isolated implementation: `/Users/brianlewis/Circle of Life/Haven Finance Integration`, branch `codex/haven-finance-integration`.
- Remote: `https://github.com/lewis4x4/Circle-of-Life`.
- Original tracked files clean. Unrelated `docs/Brand Guide/` and three September 6 gate artifacts preserved; exact path hashes in private run provenance. Other worktrees were listed and retained. No runtime from another run is terminated.
- Expected Supabase identity: `manfqmasfqppukpobpld`; connected MCP lists only `gablgsruyuhvjurhtcxx`, which is not the target. Hosted identity/parity pending alternate authorized read-only verification.
- Netlify identity/deployment and active provider company files pending verified read-only inventory.
- No production mutation, outbound activation, payment initiation or payroll submission is authorized by this implementation handoff.
- Local SQL target: run-owned PostgreSQL 17 with repository Supabase auth stubs; distinct from real Supabase Auth/PostgREST proof.
- Original handoff and all 79 IDs retained at source path. This implementation's acceptance register starts byte-identical with all requirements NOT_STARTED.

## Test execution boundaries

`migrations:verify:pg` runs the auth stub, every numbered migration, `review_*.sql` and three named older probes. Native mode accepts only an ownership-manifested scratch socket. It does not test hosted Auth, API grants through PostgREST, or providers. `npm test` runs Vitest source tests. The segment runner omits the full unit suite and typecheck; execute those explicitly. Existing CI gates are conditional on HAVEN_UI_GATES_ENABLED; finance deterministic CI must execute unconditionally.

## Verified baseline refresh

Hosted read-only SQL shows 344 migration metadata records, numbered through 335. Current main `fad17dcc4bd2dc1deb35400b309c65a047b8de83` added payroll freshness (334) and employee lifecycle (335). Integrated with Lore merge `63e8909a6b17ed11a398052d5baa4de6eec2aeba`; original handoff branch was squashed upstream, so fast-forward was unavailable. Finance author types were preserved privately, temporarily removed only for integration and cleanly reapplied via three-way patch; no concurrent code discarded. New finance/audit migration numbers are 336/337. Original reproduction evidence remains tied to 3dec84.

Current REST identity is verified against `manfqmasfqppukpobpld.supabase.co` through the repository-configured service client used only for reads. HOSTED-INVENTORY.json records exact IDs/counts and HOSTED-MIGRATIONS.json records migration versions. Current catalog reports five active entities/facilities; this does not verify each official accounting company, nor imply one facility per entity is a design invariant. Migration metadata is not DDL parity proof.

Netlify API read verified site `be2bb95e-ba70-47f8-8d2d-70cd37b9b41a` / `circleoflifealf`, URL https://circleoflifealf.com, correct Git remote and main branch. Published deploy `6aa054790bc9d700089b72cb` is ready at `fad17dcc4bd2dc1deb35400b309c65a047b8de83`; see HOSTED-DEPLOYMENT.json. Finance branch has not been deployed.
