# COL-222 — Site work landmark composition

Mission alignment: **pass**. The Site work page previously nested PageShell main/banner/contentinfo inside the application shell. An explicit embedded mode now uses neutral containers there while preserving standalone PageShell defaults, identifiers, content, classes and controls. The existing root skip-link behavior is retained; this change does not claim to improve its focus behavior.

Verification: the original Today/History semantic regressions failed before the fix; 45 focused tests and typecheck passed afterward. Full suite: **4,502 tests passed**, two existing skips. Final strict UI gate passed all 11 required checks, including 368 migration files/48 SQL probes. Independent review: **[PROOF PASS — CLEAN]**.

Four authenticated staging-backed local UI cases (Today/History at 1440/375) passed with zero axe, console and HTTP failures. Actual workspace actor/site responses, source hashes and screenshots are retained in `col222-evidence/ui-report.json`. Parent visually inspected all four images. The fresh synthetic actor was banned/deactivated, grants revoked, site retired and local app stopped. The fixture's first invalid enum was rejected without a row and corrected to the existing contract; that attempt remains recorded.

Scope: source plus synthetic UI using hosted staging Auth/DB. No production deployment or staff/operating acceptance. No migration, permission, data or visual styling change. Revert the bounded source commit for rollback; retain preceding export and receipt history.

Inherited main integration and production release continue under the overnight run ledger. Next dependency-ready defect: COL-223, original receipt versus current evidence wording.
