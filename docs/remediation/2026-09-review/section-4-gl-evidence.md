# BUS-003 source verification

Mission alignment: pass. Atomic GL posting preserves accurate financial receipts, existing journal identity, audit history and current authorization.

## Implemented boundary

Migration340 adds `post_source_to_gl(text,uuid)`, a SECURITY INVOKER transaction taking only invoice/payment identity. It locks the current source, validates its entity/facility, locks any existing source journal, resolves the configured account pair in one SQL snapshot, locks the selected accounts and accounting month, writes two lines when safe, then posts with current actor attribution. Active rules precede settings; a deterministic ID tie-break resolves equal creation times. No account-type, invoice-status or refund policy was added, and integer-cent amounts are unchanged.

An existing posted journal succeeds only with matching source organization/entity/facility/date, exactly two source-shaped active lines at the current source amount, valid account entity scope, and posted timestamp/actor evidence. Its account choices need not match today's settings, and historical inactive accounts or a subsequently closed month do not invalidate a genuine prior posting. Source changes after commit remain allowed; a subsequent mismatched retry explicitly fails rather than silently accepting the old amount.

A truly empty existing draft is completed in place only when it has no line history at all. An exact existing two-line draft posts without replacing line IDs. A malformed, changed, voided or deleted-line-history draft fails with its journal UUID and leaves history untouched. No source history cleanup or financial deletion is performed. Existing soft-deleted headers remain governed by the existing live-source unique index.

Two narrowly authorized SECURITY DEFINER helpers are necessary around the invoker command: UPDATE RLS deliberately hides posted headers from SELECT FOR UPDATE, and SELECT RLS hides deleted line history. Helpers check current owner/org_admin authority and organization before inspecting their own live source journals; they neither expose cross-tenant journals nor grant general posted-header mutation. Authority is checked again after waits and before receipt return. Fresh independent review identified that the directly executable history helper also needed its own final check; it now rechecks actor/org/role after account waits before returning any privileged facts. NULL helper input and NULL stored source type explicitly reject rather than relying on NULL-sensitive NOT IN. The SQL probe demonstrates actual actor revocation during an observed account-lock wait.

The shared month advisory key applies both to journal posting and period INSERT/UPDATE/DELETE, including the absent-period race. The post-time trigger checks active same-entity accounts, source-independent journal entity/facility validity, nonzero balance, current period closure and current actor attribution. It preserves legitimate multi-line manual journals and blocks direct posted-header insertion. Parent line guards lock both old and new parents, preventing removal/reparenting of posted lines during concurrent posting. Existing gl_period_closes and gl_posting_rules updated-at triggers assign an absent updated_by field; actual period reopening reproduced the failure, and migration340 adds those nullable actor columns without modifying the shared trigger.

The TypeScript helper is now one RPC with strict receipt shape/error handling and no client-side partial-write cleanup. The invoice detail page had its own false-success path on load, independently treating any source header as posted; it now provides an existing-journal review link and displays success only after the verified RPC receipt. Loading another invoice/role clears stale GL result state. Tests import the canonical `/admin/billing/invoices/[id]` wrapper.

## Fresh verification

- Baseline `npx vitest run src/lib/finance/post-to-gl.test.ts`: failed as expected against the original implementation; first assertion proves an existing draft yielded `{ok:true, alreadyPosted:true}`. Other baseline failures reflect the old multi-request API. See `section-4-gl-baseline.txt`.
- `npx vitest run src/lib/finance/post-to-gl.test.ts 'src/app/(admin)/billing/invoices/[id]/page.test.tsx'`: PASS, 8 tests / 2 files. See `section-4-gl-vitest.txt`.
- `npx eslint src/lib/finance/post-to-gl.ts src/lib/finance/post-to-gl.test.ts 'src/app/(admin)/billing/invoices/[id]/page.tsx' 'src/app/(admin)/billing/invoices/[id]/page.test.tsx'`: PASS, exit0, empty `section-4-gl-eslint.txt`.
- `PG_VERIFY_NATIVE_SOCKET=/Users/brianlewis/.hermes/tmp/agent-runs/haven-s3-20260908-01a080c2 PG_VERIFY_NATIVE_PORT=55443 PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin python3 docs/remediation/2026-09-review/section-4-gl-concurrency.py`: PASS, `section-4-gl-sql.txt`. Creates and drops only its run-owned synthetic database, replaying through340 with local Supabase stubs. Scratch database identifiers are recorded in the run manifest before creation. The shared server is retained.
- Actual SQL tests: invoice/payment defaults and rule priority; exact retry; changed amount; original posted accounts after current settings change; empty/exact draft recovery under authenticated RLS; malformed, balanced-wrong, soft-deleted-history, voided rejection with preserved IDs; injected header/line/audit/final-post failure atomic rollback; inactive account; closed period; source entity mismatch; current inactive actor/role/tenant receipt denial; legitimate three-line manual posting; manual closed-period and direct posted-insert rejection; privileged old-posted-parent line reparent rejection.
- Separate connections: two observed overlapping source posts yield one journal and truthful first/retry flags; concurrent source amount change yields authoritative1200 cents; concurrent account deactivation and existing/absent month closure leave no journal; actor revocation during observed account lock wait denies posting and leaves no journal.
- Fresh review correction rerun: the same full focused SQL/concurrency command passed after the helper change, including direct `haven.source_gl_line_state` invocation observed waiting on an account lock, actor deactivation, and final denial without history facts; NULL RPC/helper input and NULL stored source-type probes also passed. See the refreshed `section-4-gl-sql.txt`.
- `git diff --check`: PASS.

No hosted mutation, browser session, staff UAT, global typecheck/build, segment gates, commit or push was run by this implementation lane. Parent owns fresh independent review, global/UI gates and commit. SQL exercises actual PostgreSQL functions/RLS with synthetic auth stubs and fixture grants; it does not establish hosted Auth/PostgREST behavior. The mutation locks serialize this operation; they do not freeze future source or account changes forever. Configuration is intentionally a pair snapshot, not a global freeze on concurrent configuration writers.

## SHA256 of verified sources

```
f7ed989fa9eca3e5de6197114b0e540e296d90e3414ef57bc8132e20a36c9205  supabase/migrations/340_atomic_source_gl_posting.sql
971d4612f06bc6f1e319299314fb280ec34c49c8f0b5a416da3d3da52f1683ad  supabase/tests/review_section4_source_gl.sql
b43ec59ba427911725eaa01a180b79c5ceae943737e4f21fe94a4616b40d9f37  src/lib/finance/post-to-gl.ts
e6bffe33b8c767626a49d7f937c0c02e791bf0e4195f9a9006d783fa61532994  src/lib/finance/post-to-gl.test.ts
87e5674f51a555c9a77d4aa677f57650976b420393b320dd6fe22b6282aefb2e  src/app/(admin)/billing/invoices/[id]/page.tsx
9548a88043bd7846a0ba930ba265c207183215576f87aa8d1294a37dbd4ad293  src/app/(admin)/billing/invoices/[id]/page.test.tsx
72f7a54012445aee64fb55a71438726b905fce6d5f6b21541159e1a73b6310d6  docs/remediation/2026-09-review/section-4-gl-concurrency.py
```
