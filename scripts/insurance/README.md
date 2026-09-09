# Insurance Chromium component smoke

Run `node scripts/insurance/browser-smoke.mjs` from this checkout. It uses existing Vite, React, Tailwind/PostCSS, Playwright and axe dependencies; it installs nothing and opens no production connection.

The script renders the real insurance components and original Haven global CSS in an isolated Vite harness. Auth, the facility selector, Next navigation and insurance API responses are explicit synthetic fixtures. A real two-page synthetic PDF is streamed to Chromium's native PDF viewer with the insurance original endpoint's current CSP (`sandbox; default-src 'none'; frame-ancestors 'self'`), `nosniff`, private/no-store and inline PDF headers. The outer harness enforces `frame-src 'self'`.

The smoke covers upload failure/retry, extraction failure/retry/manual fallback, human policy and relationship entry, field evidence, saving, explicit approval and navigation to a policy. It asserts that the **native PDF viewer's Page number input** reflects source page 2, checks mobile horizontal overflow and runs axe WCAG A/AA on desktop draft, mobile draft and policy detail.

Output is under `test-results/insurance/browser/`. Screenshots carry a visible synthetic-test label. `report.json` includes the mocked command payloads (synthetic data only), browser version, assertions, requests, PDF viewer state and axe results. `visual-review.json` records manual screenshot inspection and the limits of this evidence. Initial headless-shell and pre-page-fix evidence is retained separately; blank PDF transport was not accepted as visual success.

This does **not** validate production sign-in, real Supabase permissions, API request handlers, extraction accuracy, the actual Next shell or all browser PDF engines. SQL, API runtime and hosted acceptance evidence remain separate. Axe results cover the web UI, not PDF document accessibility certification.

Disposable harness/cache/profile files are confined to `INSURANCE_BROWSER_RUN_DIR` (default `/Users/brianlewis/.hermes/tmp/agent-runs/haven-insurance-20260909`). A provenance `manifest.json` must already exist there. The script appends exact paths while preserving its schema, closes browser/server on exit and leaves cleanup to the owning run's storage steward. No production test routes are added.
