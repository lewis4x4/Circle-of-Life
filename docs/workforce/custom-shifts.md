# Custom schedule times — COL-756

A draft schedule cell cycles Off → configured shifts (normally Day, Night) → Custom → Off. Custom opens labeled start/finish time controls. Apply stages the change; Save changes persists it. Cancel preserves the previous cell. Earlier finish times mean the following day; equal or missing times cannot be applied. Custom cells include Edit times, retain actual hours on reload/copy/publish, and become read-only after publishing.

Migration503 extends the existing atomic bulk-save and copy RPCs. Explicit custom times are distinct from Off; preset plus custom overrides are rejected. Existing assignment IDs, metadata, scope/RLS, version and overlap guards remain intact. No payroll rules are changed. The Custom dialog loads on demand; final app build and all bundle budgets pass without raising limits.

Verification: 15 focused UI/helper tests; canonical typecheck; independent source review; desktop/390px phone browser interaction and axe proof; full segment gate `COL-756-CUSTOM-SHIFTS` (506 migration files,123 SQL probes,7 acceptance suites,105 parity cases); rolled-back hosted staging probe and migration-ledger verification. Screenshots and receipts are in `custom-shifts-evidence/`.

The same SQL probe fails against the previous routines and passes with503. The exact schema rollback is `custom-shifts-rollback.sql`; its original-schedule probe passes, and restoring503 makes the custom probe pass again. Prefer reverting the app while retaining the backward-compatible migration; database rollback does not erase saved custom assignments.

Current release evidence, deployment revision and hosted verification are recorded on [COL-756](https://linear.app/jarvislewis/issue/COL-756). This source receipt is pre-merge verification, not staff acceptance or a claim that a production schedule was edited.
