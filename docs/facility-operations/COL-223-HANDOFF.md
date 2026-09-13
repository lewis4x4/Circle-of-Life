# COL-223 — current evidence versus historical receipt state

Mission alignment: **pass**. Receipt history now labels current evidence separately from the original receipt state, which is explicitly historical. If a current projection is unavailable, it labels the fallback as evidence at recording. No completion is inferred from evidence alone; no stored data, attribution or timestamps changed.

Verification: two meaningful red regressions reproduced the old ambiguity. All 33 focused tests, typecheck and targeted lint passed. Full suite: **4,504 tests passed**, two existing skips. Strict UI gate passed all required checks, including 368 migrations and 48 SQL probes. Independent review returned **[PROOF PASS — CLEAN]**.

A fresh authorized staging fixture recorded work with missing evidence, uploaded a real 70-byte PNG through scoped Storage, and finalized it through the application. Every immutable receipt field retained the same hash; only current-evidence/satisfied-at projections changed. Before/after History at 1440/375 passed all four cases with zero axe, console or HTTP failures. Parent inspected final receipt images. Original fixture-selector failure and its harness-only correction remain recorded.

Fresh actor banned/deactivated, grants revoked, site retired, app stopped; retained receipt/evidence history was preserved. Evidence is under `col223-evidence/`. This proves source and synthetic UI/Storage against staging, not production or staff acceptance. Rollback is reverting this display-only commit.

Continue overnight source integration and held production release; next core work is COL-140's provenance-bearing profile foundation with unknown rules retained.
