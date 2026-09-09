# Native Auth and API evidence

This is isolated engineering evidence. It does not establish hosted deployment, provider, business or final release acceptance, and it does not complete the interrupted migration342 dynamic security review.

## Runtime and provenance

The run uses real Supabase Auth2.188.1 built from pinned commit `f3425cf742c69ad663776105e0363d81c5d4d731`, the verified PostgREST14.10 macOS ARM64 release, and a separate PostgreSQL17.9 cluster. These match the service versions reported by the installed Supabase CLI. They are local test runtimes, not changes to application dependencies or production services. Primary sources: [Supabase Auth](https://github.com/supabase/auth/tree/f3425cf742c69ad663776105e0363d81c5d4d731), [PostgREST14.10 release](https://github.com/PostgREST/postgrest/releases/tag/v14.10).

The private run is `~/.hermes/tmp/agent-runs/hfa-20260908-01a08335/native-services`. PostgreSQL listens only on its Unix socket/port55448, database `hfa_native_01a08335`. Core HTTP services listen only on loopback: gateway59831, PostgREST59832, Auth59833. Standalone Deno59835 executes the actual audit handler and forwards only local Auth/REST paths. This proxy is not the deployed Supabase Edge JWT gateway.

GoTrue applied its actual migrations; no native replay auth/session stubs were imported into this cluster. The auth.uid/auth.jwt/auth.role helper definitions came from verified read-only hosted function metadata. Public/haven schema and grants came from the run-owned345-migration source replay, with no table data copied. Normalized schema-only dumps matched exactly before and after the independent API failure injections: SHA256 `9e4c0f09b5e47ab6acdb3235d768c1745b5fcf92d2cde980856658a38c899da0`. Normalization removes random pg_dump restrict tokens and the documented bootstrap-only IF NOT EXISTS on public schema creation.

The shared runtime guard checks fixed target/configuration, loaded executable hashes and commands, process-specific loopback listeners, gateway source hashes, and the actual PostgreSQL data directory/system identifier. The independent reviewer additionally checked private Auth/REST target consistency, real migration/session tables and pinned downloads. HTTP probes reject redirects. Credentials, signing keys, browser profiles, raw schema dumps and runtime configuration remain private; repository evidence contains safe hashes, metadata and synthetic assertion results.

## Executed engineering evidence

- 26 audit API checks: real sign-ins/sessions, actual1000-row REST cap, complete2505-row immutable export with independently computed membership/checksum, source-change-stable retrieval, scope denials and session revocation.
- 25 finance API checks: concurrent identical payments, content conflicts, independently observed source balances, final-receipt rollback, cancellation and current facility revocation.
- 12 actual Deno HTTP checks: complete byte-identical CSV, checksum/no-store/CORS, retries, missing/invalid/service/other-organization denial and revoked signed-session denial.
- 29 independent runtime/provenance checks.
- 34 additional checks: existing completed B/all-organization exports cannot be processed/read by an A-only actor through RPC or Deno; allocation-write failure after payment insertion leaves all six complete organization table hashes/counts unchanged and no failed-command rows. Exact injection trigger/function removed; subsequent schema parity remains exact.

The final independent verdict and case-level results are in `test-results/finance-integration/native-auth-api/acceptance-review.json`. Paired with the unchanged reviewed336/337 SQL probes and executed replay, this supports engineering PASS for HFA-007 and HFA-012. HFA-008–011 and HFA-059 retain their specific open scope; no full F01/F09 phase is claimed.

Earlier native reports remain unchanged with explicit errata. The first native setup omitted GoTrue's authenticated default group; fixing local configuration resolved that401 without changing application authorization. The initial command label and HTTP target guard were then corrected before independent reruns. Counts changed when per-service checks were consolidated; the separate29-check independent runtime report preserves that coverage.

## Browser follow-up and limits

The first browser pass proved only the route shell and is not a completed journey. It exposed absent platform SELECT grants in the vanilla test fixture. Root verified the exact hosted authenticated SELECT metadata and restored only those read privileges plus referenced RLS-policy dependencies locally. No RLS policy, application authorization rule, financial write privilege or production database changed. This browser fixture overlay is later than the exact-schema API proof above and must be recorded separately; do not claim the current overlaid fixture is byte-identical to the earlier native ACL baseline.

Real routed browser/a11y journeys, broader current-authority and financial command matrices, platform-wide audit coverage, actual Vault/key operation,342 worker issuer/gateway behavior, provider integrations, recovery and named business cycles remain open.
