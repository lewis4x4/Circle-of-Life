# COL-225 — canonical database UUID compatibility

Mission alignment: **pass**. Existing Homewood/entity identifiers use valid PostgreSQL UUID text with legacy version/variant bits. Zod's stricter generated-UUID check rejected them before operations RPCs. The operations-scoped `databaseUuidSchema` now validates canonical database identifiers without remapping them. Separate export request and reminder revision-token contracts remain unchanged. No authorization, RLS, schema or policy change.

Verification: 151 focused tests, typecheck and lint passed; full suite **4,514 tests passed**, two existing skips. Final strict UI gate passed all required checks, including 368 migrations and 48 SQL probes. Independent review: **[PROOF PASS — CLEAN]**. Fresh legacy-shaped synthetic entity/site/activity/subject identifiers worked through actual staged requirement, manual-work and export calls; returned IDs were unchanged. Malformed IDs and cross-site/revoked requests were denied. Fixtures were retired and app stopped.

Evidence is in `col225-evidence/`. Its first gate's inherited midnight fixture failure is retained; the fixture was reproduced/repaired without changing application time guards, then the final gate passed. Initial HTTP harness header-casing failure is also retained, followed by successful download and denial proof.

This is a COL-140 prerequisite and adjacent COL-151/shared-operations defect. Production publication remains held; main integration and release must be verified separately. Rollback: revert this bounded input-validation commit; canonical IDs and retained records stay unchanged.
