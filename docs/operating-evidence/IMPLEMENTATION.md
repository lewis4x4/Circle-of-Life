# Operating evidence implementation

Requested 8 September 2026. Source: the user's “Haven and COL: operating requirements from weekly evidence”, HCOL-01–28. Proposal IDs remain proposal IDs.

## Baseline and sequence

Isolated branch `codex/haven-operating-evidence`, based on `origin/main` at `9db72d2d`. Main home/login checkout and the active Remaining Roadmap checkout are preserved. Remaining Roadmap's unmerged migrations 334–339 and active financial changes are separate work; migration numbering must be reconciled before integration.

1. HCOL-02/03/05: eliminate destructive CSV replacement; validate and preview before writes; one atomic import with expected versions, duplicate receipts, immutable prior evidence, and honest coverage.
2. HCOL-01/03: versioned approved definitions, source health and complete live aggregation. Financial and census semantics require domain decisions; do not invent them.
3. HCOL-06/07/08/12: referral identity, stage, next actions and truthful absence communication/recovery.
4. Subsequent delivery follows the supplied register, reusing active admission, reservation, financial, clinical-assignment and lifecycle repairs.

## First segment contract

The normalized aggregate CSV importer defaults to a read-only review plan. Publication explicitly supplies that plan, a definition-review reference and a correction reason where a week already exists. Unsupported workbook-style layouts reject before writes. The original historical January file is not operational seed data.

All file rows validate before publication. The database commits all affected weeks together, checks preview versions under a lock, preserves original metric/header evidence, and records fingerprint provenance. Missing expected facility/metric cells reduce coverage; uploaded blanks remain null. Calculation time does not imply source freshness. This segment does not claim approved equivalence between source labels and Haven live formulas.

Synthetic acceptance: duplicate upload; invalid final row; corrected week; stale preview; cross-organization facility; ambiguous numeric value; duplicate row; unknown layout; incomplete facility coverage; explicit zero; denied RPC; original revision retrieval. Independent review and a segment gate are required before completion.

## Boundaries

No real prospect import, production mutation, external notification, policy activation, or Front Office feed authorization is inferred. Named staff/device acceptance remains separate. No new dependencies.

## Completed bounded segment: reviewed CSV

Independent review APPROVE. Twelve CLI tests passed with no skips. Native PostgreSQL replay passed 337 migration files / 18 SQL probes. Actual CLI → local PostgREST 14.4 → PostgreSQL workflow verified dry-run, publication, duplicate receipt, correction and original retrieval. Supported typecheck and strict segment gate PASS: `test-results/agent-gates/2026-09-08T14-26-15-527Z-hcol-reviewed-csv.json`. `CSV-REVIEW.json` pins reviewed source hashes and test evidence.

The first gate failed because an isolated-worktree dependency symlink fell outside Turbopack's filesystem root. Replacing it with a local copy of the same dependencies fixed the environment; no versions or acceptance thresholds changed. Keep the failed artifact as honest evidence.

Simplification: CSV publication now uses one atomic RPC instead of per-week DELETE/PATCH/POST sequences. Missing data and uncertain definitions remain visible. Full HCOL-02/03/05 includes further workbook, UI, non-import publication, definition and source-health work.

Mission alignment: pass for this bounded engineering segment. Full HCOL implementation is not yet complete. No deployment or staff UAT claimed.
