# COL-18 — Facility Operations baseline and readiness

September 9, 2026. Scope: reconcile the current source, branches, migrations and runtime for Haven's shared facility-operations application, Homewood first. This is a documentation/evidence segment, not a feature release or a clean bill of health.

**Baseline reconciliation complete; production operating acceptance NOT READY.** Catalog and authorization foundation work may proceed. The failed full gate, current security/dependency findings, Storage transport gaps and named operating acceptance remain explicit below. No application code, schema, provider configuration, operating rule or production record was changed.

## Authority and source

Owner direction and the September 9 planning package supersede older feature sequencing. Read `BUILD-SCOPE.md`, `DELIVERY-ROADMAP.md`, and `LINEAR-INDEX.md` in `/Users/brianlewis/Circle of Life/Haven Admin Roadmap 2026-09-09/`; supporting material is loaded only for the active issue. Published scope: [Build Scope](https://linear.app/jarvislewis/document/haven-facility-operations-build-scope-fa76df5ada21), [Delivery Roadmap](https://linear.app/jarvislewis/document/haven-facility-operations-delivery-roadmap-eab29aa94849).

The product is one shared application for all five facilities: simple staff completion; automatic recorder/time; conditional supporting evidence; authorized corporate activity/history; unresolved problems and follow-up. Extend OCE and existing domain masters. Unknown schedules/applicability remain visible; none are activated by this reconciliation.

| Surface | Current evidence | Meaning |
|---|---|---|
| GitHub main / source baseline | `fad17dcc4bd2dc1deb35400b309c65a047b8de83`; [source.json](evidence/source.json) | Includes Employee Lifecycle release, payroll freshness, current actor enforcement, rounding receipts and resident search. |
| This worktree | `/Users/brianlewis/Circle of Life/Haven Facility Operations`, branch `codex/hfo-col18-baseline`, created from verified main | Isolated from original audit checkout `3dec84bb` and concurrent branches. |
| Production frontend | Netlify `6aa054790bc9d700089b72cb`, ready, published September 8 at 18:33:52Z, same `fad17dcc`; [netlify.json](evidence/netlify.json) | Provider metadata verifies deployment identity; it does not prove the new HFO workflow exists. |
| Production database | `manfqmasfqppukpobpld`, 344 ledger records; 338 source migration files (001–335 plus three retained May timestamp files) | No source migration version missing from ledger. Counts differ for documented August supplemental entries. |
| Recent migration content | All 17 migrations 319–335 exactly match SHA-256 of joined installed statement text; [hosted-schema.json](evidence/hosted-schema.json) | Strong recent ledger/source evidence, not a full live-schema diff. Older split ledger statement formatting does not match whole-file byte hashes. |
| Edge deployment | 37 source entrypoints and 37 deployed slugs, identical sets; deployed status/version/JWT flags retained in [hosted-runtime.json](evidence/hosted-runtime.json) | Slug/config inventory, not byte equality or proof each cron/provider works. |
| Current auth / backup configuration | Custom access-token hook enabled at `public.haven_custom_access_token_hook`; canonical site URL; PITR enabled | Fresh management read. No restore, role login or revocation race executed against production in this segment. |
| Public runtime | Login 200; anonymous OCE tasks API 401; [public-http.json](evidence/public-http.json) | Request IDs and elapsed times retained. Initial redirected login took 14,188 ms, direct login 798 ms; no approved latency threshold inferred. A guessed employee catalog URL returned 404 and is an invalid probe, not a product defect; actual catalog is staff-scoped. |

Production was inspected using read-only SQL transactions with statement/lock timeouts and read-only management/API requests. No test staff/residents or Storage objects were created. The original Employee Lifecycle release's authenticated browser and isolated Auth evidence is historical evidence from September 8, not rerun evidence here. Its positive hosted upload/attach/download gap remains open.

### Migration reconciliation and concurrent work

The six additional ledger versions are `20260814153636`, `20260814200926`, `20260814201004`, `20260814201013`, `20260814201022`, and `20260814201741`. They were already recorded in `docs/remediation/2026-09-review/phase-0-release-parity.json` on September 7. The first five names correspond to source 308–312; the last is `pin_col_discovery_helper_search_path`. These are retained historical supplements, not six newly missing migrations. Exact semantic equality of all historic definitions has not been established; do not delete/repair ledger rows or replay timestamp files based on a count comparison.

[Concurrent migration manifest](evidence/concurrent-migrations.json) records exact hashes and heads. Finance uses 336–342; Insurance 336–337; its receiver adds 338. Remaining Roadmap and Operating Evidence each have a different 335 from released employee 335 and overlap further numbers. **336 is next numerically on main, not reserved or safe across branches.** Before HFO DDL, fetch current main, inventory active branches, reserve/reconcile the selected number and migrate only the intended source. No branches were merged or renumbered here.

Open PRs remain [#461 finance](https://github.com/lewis4x4/Circle-of-Life/pull/461), [#462 insurance](https://github.com/lewis4x4/Circle-of-Life/pull/462), [#463 receiver against insurance](https://github.com/lewis4x4/Circle-of-Life/pull/463), and [#446 resident detail](https://github.com/lewis4x4/Circle-of-Life/pull/446). Their exact heads/bases are in [open-prs.json](evidence/open-prs.json). They are not implicitly core prerequisites or deployed capabilities.

## Readiness disposition

| Requirement / finding | Current disposition | Delivery gate |
|---|---|---|
| Stable catalog, validated subject and current authority | Existing OCE/auth foundations; new HFO contract missing | COL-132 / HFO-01 and COL-133 / HFO-05 are ready after COL-18. |
| Versioned rules, schedule/occurrences, receipts, evidence, corrections, complete history, issue lifecycle, save recovery | Explicit source gaps mapped in [INTEGRATION-MANIFEST.md](INTEGRATION-MANIFEST.md) | Relevant core leaves; complete-loop proof COL-161 / HFO-25. |
| Current Security Advisor | **1 ERROR, 45 WARN, 6 INFO**, 52 total. Remaining error: `public.resident_billable_status` security-definer view. Prior `quality_latest_facility_measures` error no longer appears. Detailed object names/counts retained in hosted-runtime.json. | Existing COL-37 before Homewood release; protect new HFO paths under COL-133. Do not treat every security-definer warning as an unsafe function or revoke all invoker wrappers blindly. |
| Current dependency audit | **FAIL: 1 critical, 2 high, 3 moderate**, six affected-package entries. Raw version/advisory/fix information in [npm-audit.json](evidence/npm-audit.json). Next, sharp and js-yaml are among the high/critical findings. | Release-blocking technical work tracked by this baseline and HFO-25. No blind `audit fix --force`, dependency upgrade or risk waiver performed. Advisory count alone does not establish exploitability on this host. |
| Full local segment gates | **FAIL**, unchanged original artifact retained. Build/lint/sequence/stress and hygiene passed; npm audit and shared all-ref gitleaks failed; first optional native replay failed from scratch encoding. | Not a green release gate. Successful focused reruns do not rewrite the full result. |
| GitHub CI | Release-time segment/UI workflows succeeded; latest nightly `34334505817` failed npm audit and its generic-key detector regression probe; Homewood workflow skipped. [CI snapshot](evidence/main-ci.json), [nightly job](evidence/nightly-jobs.json). | Nightly failure remains unresolved; local detector success is not CI repair. |
| Source/evidence storage | Employee personnel/medical buckets private, 20 MiB with PDF/JPEG/PNG limits; facility documents private, 25 MiB and its listed MIME allowlist. `equipment-photos` public, 20 MiB. Exact live bucket settings retained. | HFO-07 must establish task-specific classified evidence and verified finalization; public equipment storage is not authority for protected task evidence. Positive employee transport remains HFO-20's separate acceptance. |
| A5 / COL-5 discrepancy | Preserve A5 owner-attested PASS (May 11, August 19/26); fresh PITR enabled. COL-5 still Todo with September 4 contrary plan/add-on assertions. | Current PHI-launch BAA/add-on/control confirmation remains separate owner/legal gate under COL-5. This read did not inspect a signed contract/current add-on and cannot resolve that discrepancy. No A5 reopening or COL-5 completion. |
| Homewood devices, HIPAA training, staff walkthrough and first month | COL-19, COL-30, COL-20, COL-21 remain Todo | Prerequisites to real operation, not to building generic catalog/auth foundations. Named tester/role/site/device/deployed SHA required for operating acceptance. |
| Clinical depth UAT and multi-site rollout | A3 and applicable A4/A6 remain per closure record; historical single-site RLS PASS retained | Clinical paths require their own UAT; RLS-02 before Oakridge. No clinical/first-month acceptance inferred from local tests. |
| Released Employee Lifecycle / COL-117–120, COL-123 | Reuse migration 335 and released interfaces; 95 draft source entries are not activated policy. Linear items remain Backlog; do not interpret older descriptions as absent implementation. | HFO-20 adapter and Q20 medication-training count reconciliation; missing forms/applicability approvals remain explicit. |
| Signing / clinical / finance / payroll / providers | Existing released source or separate branch work must be traced per adapter; SYS-005/006 and financial/provider evidence are not generic staff-recording blockers | Affected HFO-19–24 adapters only, unless core actually advertises that capability. External platform remains source of truth; no fabricated transmission or completion. |

The native relation from COL-18 to COL-5 is **related**, not a blocking edge. No incoming blocking edge to COL-18 was found. This distinguishes baseline readiness from actual PHI launch. Existing descriptions/history in Linear were retained.

## Executed verification

* `npm test -- src/app/api/admin/operations src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts`: **8 files / 52 tests PASS**.
* `npm run typecheck`: **PASS**.
* `npm run segment:gates -- --segment COL-18-HFO-BASELINE`: **FAIL**. Artifact: [original full gate](../../test-results/agent-gates/2026-09-09T21-55-49-320Z-COL-18-HFO-BASELINE.json) (repository path `test-results/agent-gates/2026-09-09T21-55-49-320Z-COL-18-HFO-BASELINE.json`). No check downgraded or skipped via override.
* Full gate build, lint, migration sequence, stress and detector regression passed. First native replay failed because the temporary cluster defaulted to SQL_ASCII; migration 333 requires UTF-8. A separately created UTF-8 run-owned cluster replayed **338 migrations and 19 SQL probes PASS**. Supabase services were stubbed; this is not live Auth/Storage proof.
* Full gitleaks scanned shared refs and found three matches in Finance commit `2973ca39e00d2848137ad547463fa3fd13702cac`, not an ancestor of baseline HEAD. Independent inspection proved two matching SHA-256 file fingerprints and one synthetic rollback-only rejection fixture. No secrets printed or allowlists changed. Explicit `--log-opts=HEAD` scan: **1,724 commits, zero findings**. This does not turn the original all-ref gate green.
* Fresh metadata/ledger/API and Linear readbacks are retained alongside [verification.json](evidence/verification.json). Schema content checks were limited as stated; no production state was mutated.

## Handoff and rollback

Next issue: **[COL-132 / HFO-01](https://linear.app/jarvislewis/issue/COL-132)**, stable catalog and all 91 Admin Log mappings. COL-133 is also dependency-ready; select one only. See [HANDOFF.md](HANDOFF.md). Neither issue was started here.

Rollback is documentation-only: revert the COL-18 documentation/evidence commit if needed. No data/schema/application rollback is required. Retain this worktree and evidence. [Cleanup evidence](evidence/cleanup.json) confirms both run-owned PostgreSQL clusters are stopped and 1,968 exact disposable files were removed after Storage Steward manifest validation; no unrelated source, worktree, credentials, evidence or runtime may be deleted. Mission alignment: **PASS for bounded direction and truthful evidence; production readiness remains RISK**.
