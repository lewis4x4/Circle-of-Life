# BUS-002 source verification

Mission alignment: pass. Atomic creation and caller-bound recovery preserve financial identity, current authorization, later legitimate draft editing and receipt history.

## Implemented boundary

`create_purchase_order` derives organization and actor from current Haven authority, requires the expected caller, serializes caller/request retries, validates live same-tenant references and exact decimal quantities/integer cents, invokes the existing number allocator, and commits the draft header, initial lines and immutable creation receipt together. Exact retries return the original creation snapshot without overwriting later edits. A changed payload rejects. Current actor/tenant/facility/vendor visibility is checked before receipt disclosure. Creation retains the form's preexisting vendor-facility link requirement for all permitted roles; owner/org_admin receipt recovery can access historical creation after unlinking, whereas facility_admin still requires the original PO facility/vendor link. This is PO-specific visibility from migration046 purchase_orders_select (lines831–852), not merely visibility of the vendor through any accessible facility. No COI, vendor-status or category policy was invented.

The sole application header creator now uses one RPC with a narrow local command/request/receipt TypeScript signature. Authenticated direct header INSERT is revoked; later UPDATE and line-edit permissions are retained. The existing line updated_at trigger assigned `NEW.updated_by` despite that column being absent: an actual receiving update failed during the first SQL run. Migration339 adds the missing nullable auth.users FK and initial actor attribution; receiving and draft edits pass thereafter. No global trigger was changed.

The canonical new-PO page preserves its mounted request and payload after an ambiguous response, blocks changed callers, permits the same caller's renewed session, and keeps a later definite denial locked after earlier ambiguity. Initial definite SQL rollback allows correction. A synchronous ref suppresses duplicate submits. Quantity/cents checks and half-cent rounding use exact decimal integer arithmetic. Parent gate caught TS2737 for BigInt literal syntax under the existing TypeScript target; literals were replaced with BigInt constructors without changing arithmetic, tsconfig or dependencies. Focused tests and ESLint passed again; parent owns the final typecheck/build gate rerun. The page navigates only after a complete matching receipt.

Recovery is limited to the mounted page, including rerenders and lookup state changes. There is no financial payload storage and no full browser reload recovery claim.

## Fresh evidence

- `npx vitest run 'src/app/(admin)/vendors/purchase-orders/new/page.test.tsx'`: PASS, 15 tests importing the canonical `/admin` wrapper. `section-4-po-vitest.txt`.
- `npx eslint 'src/app/(admin)/vendors/purchase-orders/new/page.tsx' 'src/app/(admin)/vendors/purchase-orders/new/page.test.tsx'`: PASS, exit0; empty `section-4-po-eslint.txt`.
- `PG_VERIFY_NATIVE_SOCKET=/Users/brianlewis/.hermes/tmp/agent-runs/haven-s3-20260908-01a080c2 PG_VERIFY_NATIVE_PORT=55443 PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin python3 docs/remediation/2026-09-review/section-4-po-concurrency.py`: PASS; `section-4-po-sql.txt`. The script creates and drops its own database on the explicitly run-owned PostgreSQL17 server, replays the migration chain through339 with local Supabase stubs, runs the actual SQL regression, then overlaps two identical caller/request transactions. Both return the identical receipt; exactly one header, two initial lines, one receipt and one allocator increment remain. The shared server is not stopped.
- SQL regression proves injected header, line, receipt and audit failure roll back header/lines/receipt/audit and allocator state. Tests include exact/altered retries; quantity precision/zero/negative/NaN and fractional/negative/overflow cents; wrong expected caller; current actor deactivation, role and tenant changes; cross-tenant facility/vendor references; deleted vendor; facility/link revocation; an explicit two-facility case where vendor SELECT stays allowed through the other accessible facility but original PO SELECT and receipt replay both remain denied; renewed session recovery; immutable receipt update/delete denial; direct header INSERT denial; later draft edits and receiving updates; preserved facility_admin approval denial.
- `git diff --check`: PASS.

No hosted migration, production financial action, global build/typecheck, segment gates, commit or push was performed by this implementation lane. Parent owns independent review and required gates. Vitest is rendered component proof; SQL uses local auth stubs with actual Haven authorization helpers and is not hosted Supabase/Auth/PostgREST verification or staff UAT.

## SHA256 of verified sources

```
1688eaae91e58b73e992eb97ae42a790e96e774976adb9b24da66b8f99f907d4  supabase/migrations/339_atomic_purchase_order_creation.sql
572426b80b866a28704c0ec91410e567de1df826efdb7f470a1cf15751246954  supabase/tests/review_section4_purchase_order.sql
dd5e754cf682ac17053719e1f922bceb361d1c6ae2ca91291a851ad14ed25f4e  src/app/(admin)/vendors/purchase-orders/new/page.tsx
935c921a27fa6eb1bd71c014b0c896646ee4ac072db7a41461719bba1c838b2b  src/app/(admin)/vendors/purchase-orders/new/page.test.tsx
c2969fa7b7e9cd56cd59d6633342005f00b71053aed7e91628becc368bea4e1b  docs/remediation/2026-09-review/section-4-po-concurrency.py
```
