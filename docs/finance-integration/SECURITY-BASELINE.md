# Security verification baseline

2026-09-08 `npm ci --ignore-scripts` against the original lockfile reported 1 critical, 2 high and 3 moderate advisories. Runtime Next 16.2.11 and sharp 0.35.3 were affected; js-yaml had a high advisory. The finance worktree upgrades the existing Next/eslint-config-next/bundle-analyzer to 16.3.4, sharp override to 0.35.4, and compatible transitive js-yaml/hono packages. No new application dependency is introduced.

Official evidence: [Next August security release](https://nextjs.org/blog/august-2026-security-release) and [16.3.4 release](https://github.com/vercel/next.js/releases/tag/v16.3.4). Initial follow-up npm audit reports only two moderate Vitest/mocker advisories; high/critical gate must still execute on final lockfile. This is source/dependency work, not proof the hosted runtime was updated.

The first attempted full unit run overlapped dependency replacement and produced Next import-resolution errors; retain it as inconclusive, not an application regression result. Repeat only after install completion. Initial native SQL replay failed because run-owned initdb used SQL_ASCII; UTF8 template repair allowed all 336 baseline migration files and 17 SQL probes to pass. Neither issue changed production.

GitHub run 34263530454 (source fad17dcc4bd2dc1deb35400b309c65a047b8de83) reported success while seed auth, Homewood auth, segment gates, route/auth smoke, UI checks and bundle-size steps were skipped. New unconditional finance verification is required; old green status is insufficient evidence.

Next16.3 build invokes TypeScript over the default config, surfacing pre-existing fixture-only typing errors previously excluded from the explicit source typecheck contract. Set `typescript.tsconfigPath` to the existing `tsconfig.typecheck.json`, without adding exclusions or ignoring build errors. Deterministic CI separately requires the full Vitest suite; runtime source and generated route types remain strictly checked. Six ordinary internal navigation calls now use Next router.push per the new lint rule; authentication reload paths were untouched.

Independent review confirms source typecheck passes, while default-tsconfig test-fixture typing diagnostics remain separate existing debt. Vitest executes test assertions but does not typecheck all mocks. The custom build config does not repair those fixture typings or claim they are green.

Real browser login reproduced a pre-existing CSP defect: local HTTP Supabase was whitelisted as HTTPS/WSS, so the browser blocked the token request. CSP now uses the exact parsed configured origin; HTTP/WS is allowed only for loopback, while nonlocal Supabase still requires HTTPS/WSS. Production origin/path isolation and rejected insecure protocols have behavioral tests. Evidence: test-results/finance-integration/local-csp-baseline.json.
