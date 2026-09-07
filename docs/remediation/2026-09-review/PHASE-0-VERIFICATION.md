# Haven Phase 0 verification

Date: 2026-09-07
Branch: `codex/haven-phase-0-verification`
Scope: NAV-002, SYS-005 and DEP-001 only

## Dispositions

| ID | Disposition | Evidence boundary |
|---|---|---|
| NAV-002 | **Verified resolved.** The executive overview's required reads now fail into an explicit Retry state, while optional and partial data remain honestly labeled. | Source inspection and isolated local component/loader tests. No authenticated staff UAT. |
| SYS-005 | **Partially resolved; remaining P1 assigned to Section 4.** The original same-organization cross-facility bypass is corrected. A narrower final-link race remains reproducible. | Actual handler with isolated Supabase/BoldSign transport doubles plus independent Astra High source/test review. No live provider call or hosted revocation test. |
| DEP-001 | **Verified resolved.** The preceding release reconciled local, GitHub, Netlify, hosted migration history and paired authority/Edge metadata without rewriting history. | Fresh Git/GitHub/Netlify/Supabase read-only metadata and prior release records. This is deployment provenance, not hosted bundle equality or operational UAT. |

## NAV-002: executive overview failure and partial-data honesty

`/admin/executive` remains the canonical overview and `/executive` remains an application route through the configured route mirror. The server page no longer waits for a partial SSR result. After current auth resolves, `ExecutiveOverviewPageClient` calls `loadExecutiveOverview(..., { strict: true })` and shows `AdminLiveDataFallbackNotice` with **Retry** when that loader rejects.

The strict loader treats aggregate snapshots, facility snapshots, open alerts, bed census, assurance heatmap and assurance trends as required. A query rejection or returned error is thrown rather than converted to an empty all-clear result. Presence census and facility availability retain bounded optional fallbacks. Existing display regressions keep partial/missing scope explicit:

- `2 of 5 facilities have census posted — occupancy uses posted census only.`
- `3 of 5 KPIs loaded — empty tiles name what is still missing.`
- `No census loaded yet`, `No payroll loaded this period`, `No incident rate yet` and `No survey on file` remain named gaps.

Fresh local command:

```text
npx vitest run src/lib/executive/load-executive-overview.test.ts src/components/executive/ExecutiveOverviewPageClient.test.tsx src/components/executive/ExecutiveOverviewPageClient.startup.test.tsx src/lib/executive/kpi-tile-copy.test.ts src/lib/executive/officer-occupancy-tile.test.ts
Test Files 5 passed (5); Tests 30 passed (30)
```

This proves local loader and rendering behavior with isolated failures. It does not prove a named owner's browser session, production query availability or staff acceptance.

## SYS-005: signing facility boundary

The original finding's static bypass is corrected. The actual `boldsign-send-contract` handler now:

1. resolves a current actor before constructing the service-role client;
2. requires contract organization equality and membership of the contract facility in the actor's current accessible-facility set;
3. revalidates the same actor, organization, role, authorization version and facility before the provider send;
4. revalidates again before local sent-state persistence and before each embedded-link provider request.

The new actual-handler regression replaces all Supabase and BoldSign network transport with synthetic doubles. It proves:

- missing/malformed actors return only `{"error":"Unauthorized"}`;
- disallowed roles, a foreign organization, and disjoint facility access for `facility_admin`, `manager` and `nurse` return only `{"error":"Forbidden"}`, with zero provider calls, zero database mutations and no signing fields;
- facility revocation at pre-send revalidation causes zero provider calls and zero database mutations;
- facility revocation before the embedded-link request prevents the link provider call and returns no signing fields;
- an authorized multi-site nurse retains the legitimate send, local persistence and embedded-link behavior.

Fresh local command and independent Astra High rerun:

```text
deno test --no-lock --cached-only --node-modules-dir=none --allow-env supabase/functions/boldsign-send-contract-handler.test.ts
6 passed; 0 failed
```

### Remaining reproducible P1 gap

The same actual-handler suite characterizes a narrower race at `supabase/functions/boldsign-send-contract/index.ts:201-220`. The handler revalidates before the provider link request. The double then revokes facility access while that final request is in flight. With no revalidation after the response, the handler still returns HTTP 200 with the synthetic `signLink`; the actor RPC count remains four after revocation. This is a local synthetic reproduction and does not call BoldSign or production Supabase.

Assign this gap to **Section 4, financial transactions and signing delivery, GPT-6 Astra High**. The remediation must revalidate after each link response and before disclosing any signing link, then convert this characterization into a denial regression. Provider-send recovery, idempotency and webhook ordering remain SYS-006 work in the same section and are not claimed by this Phase 0 test.

Because this residual can disclose a link after facility authority changes, SYS-005 remains conservatively open as `partially_resolved_section_4_assigned`; only its original cross-facility trigger is verified corrected.

## DEP-001: release parity

Fresh read-only evidence is recorded in `phase-0-release-parity.json`:

- Local HEAD, `origin/main` and GitHub `main` were all `624e77120f1a7f5f6717a0981891d3b02cef80b1` before the Phase 0 documentation/test branch.
- Netlify site `circleoflifealf` published production deploy `6a9ee9e122df6a00087d0ce3` at the same commit; state was `ready`, published at `2026-09-07T16:46:39.986Z`.
- Hosted migration history had 338 entries and local source had 332 files. Every local version exists hosted. Six hosted-only August timestamp entries are historical and remain preserved.
- Migrations 319 through 329 match hosted names and raw content exactly. Versions 317 and 318 match their correct historical names and all statement lines; local files additionally contain outer `BEGIN`/`COMMIT` wrappers and blank lines, so their raw hashes are correctly recorded as different.
- The RPC signatures originally reported missing (`save_journal_draft`, `payroll_export_snapshot`, `save_inservice_session`) are present with the expected arguments and results.
- The custom access-token hook is enabled at `pg-functions://postgres/public/haven_custom_access_token_hook`; PostgREST pre-request, lifecycle browser-denial and shell-actor contract checks are true.
- The preceding GitHub release log records 37 deployed Edge functions, including `boldsign-send-contract`. The old workflow's root test-file selector false failure is retained; the corrected selector workflow succeeded at `624e7712`.
- Active Edge metadata records `boldsign-send-contract` version 11 with JWT verification enabled. No application, Edge or migration source changed between the main SYS-001 release commit and the deployment-selector-only follow-up.

The prior `hosted-token-probe.json` remains historical evidence from the release, not fresh Phase 0 authenticated UAT. Read-only Edge metadata plus the release log establish provenance; they do not establish downloaded hosted-body equality, a live provider transaction or clinical/customer acceptance.

## Fresh verification

- Focused NAV-002 Vitest: **30 passed, 0 failed** across 5 files.
- Focused SYS-005 actual-handler Deno: **6 passed, 0 failed**; independent Astra High rerun also **6 passed, 0 failed**.
- Full application Vitest: **3,148 passed, 2 existing skips, 0 failed** across 521 files.
- Edge Deno: **93 typechecked tests passed**, plus the existing Knowledge Agent test passed once with its documented `--no-check` exception; total **94 passed, 0 failed**. The all-at-once typecheck still reports six pre-existing Knowledge Agent type errors and is not represented as passing.
- Native PostgreSQL 17 replay through an exact run-owned scratch cluster: **332 migration files and 14 SQL probes passed**. No personal Docker or application database was used.
- Canonical strict segment gate: `test-results/agent-gates/2026-09-07T18-03-19-781Z-HAVEN-PHASE-0-VERIFICATION-FINAL.json` reports **PASS**. Required environment, tracked-secret, dependency audit, 1,877-commit gitleaks, lint, migration sequence, native PostgreSQL replay, production build and stress checks all passed. UI/design/axe checks were optional skips because Phase 0 changes no UI/runtime behavior.
- Superseded gate: `test-results/agent-gates/2026-09-07T17-56-12-394Z-HAVEN-PHASE-0-VERIFICATION.json` retained the first scratch-cluster setup error as optional-failed because that new cluster lacked the runner's expected `postgres` role. The role was added, the standalone replay passed, and the canonical strict replacement above records the replay as required and passing.

## Acceptance limits and next bounded task

No production record, user, role, message, signing invitation, provider action or clinical/financial operation was created or changed. No named-user signing UAT, live provider sandbox transaction, production revocation race test or customer/staff acceptance is claimed. Those evidence levels remain separate from source and isolated-handler proof.

Mission alignment: **risk**. Phase 0 improves the auditability and truthfulness of Haven's release state without weakening role or facility controls, but the reproduced final-link revocation race prevents signing integration readiness until Section 4 resolves it.

Recommended next bounded task only: **Section 4 / SYS-005 final-link disclosure remediation with GPT-6 Astra High**, followed by the exact negative handler regression and provider-contract review. Phase 0 does not start that work or any other roadmap section.
