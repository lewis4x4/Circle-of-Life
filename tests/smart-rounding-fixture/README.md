# Smart Rounding component browser checks

Run `npx playwright test --config playwright.smart-rounding-fixture.config.ts`.

The local Vite harness imports the production observation capture and compliance components with the production stylesheet. Playwright intercepts their read-only API requests and returns synthetic fixtures. It requires no environment file, hosted service, database, or credentials. Screenshots are written beneath `test-results/smart-rounding-fixture/`.

Checks cover out-of-order facility responses, required chip selections, sentence preview, retained submitted codes, empty optional notes, a 390px phone viewport, horizontal overflow, and axe WCAG A/AA violations. The caption on each screenshot identifies it as synthetic evidence.

This proves component behavior and layout. It does not prove Next.js routing, authentication, RLS, actual observation writes, or deployed browser behavior; those require the separate Smart Rounding authenticated acceptance suite.

## Actual local app witness

`LOCAL_UI_STORAGE_STATE=/absolute/path/to/local-auth-state.json node tests/smart-rounding-fixture/authenticated-local-witness.mjs` verifies the disposable local app on port4398, synthetic Alpha/Beta fixtures, five tabs, forbidden facility403, screenshots, and zero page/hydration errors. Auth state must come from normal local app login and selecting Fixture Alpha; never commit it. The script cannot target a hosted URL. It is separate from the portable component suite and requires a populated local Supabase stack.

The full-app report in `test-results/smart-rounding-full-app/proof.json` records exact local baseline ACL qualification and an actual caregiver write: create a draft cadence with a window opening now, activate it with `haven.apply_observation_config_activation`, read `facility_current_and_next_shift_observation_windows`, and generate via `record_cadence_observation_tasks`. Capture through normal caregiver login, compare `observation_compliance_for_range` before/after, and verify the saved log. This is local synthetic evidence, not deployed or staff acceptance. (Recorded 2026-09-19, before COL-615 folded the `caregiver` login role into `med_tech`; the floor-app writer is now a Med-Tech.)
