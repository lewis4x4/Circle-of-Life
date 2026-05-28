# Handoff — Code‑Review Remediation (`codex/complete-app-cleanup`)

**Date:** 2026-05-28
**Repo:** `/Users/brianlewis/Circle of Life/Circle-of-Life` (Haven · Next.js App Router + TS + Supabase)
**Branch:** `codex/complete-app-cleanup`
**State:** all changes are in the working tree, **uncommitted / unpushed**.

This remediates the `/code-review` findings on commit `f959b58e` ("Make walkthrough cleanup verifiable end to end"). The dominant theme was that the new billing deep‑link prefills (`?residentId=…&invoiceId=…&amount=…`) were trusted without being reconciled against the destination form's own scope; the rest were a facilities query regression, a cache hole, a migration replay hazard, and cleanups.

---

## 1. Status at a glance

**Done + verified locally (all green):** `typecheck`, `lint`, `vitest` 278/278, `migrations:check` (001..261), `migrations:verify:pg` (264 files), `next build` (compile + TS + 375 static pages + admin-shell/memory-care/schema-leak checks).

**Remaining for you (details in §4):**
- **4a — Apply + verify the 3 new migrations against prod** (REQUIRED before/with deploy). I couldn't reach Haven prod from my session.
- **4c — diet_orders:** investigated and intentionally left alone; only act if you want to resolve a documented app-layer inconsistency (optional, separate effort).
- **4d — Browser gate** (`segment:gates --ui`, needs Playwright).

The atomic payment RPC (originally listed as optional "4b") is **now implemented** — see §2 / migration `261`.

---

## 2. Files in this changeset

**Modified**
- `src/app/(admin)/billing/payments/new/page.tsx` — prefill reconciliation (resident cohort + merge-by-id; prefilled invoice validated vs loaded set + submit guard; amount carry-over removed); invoice balance now applied via the `apply_invoice_payment` RPC instead of a client read-modify-write
- `src/app/(admin)/billing/collections/new/page.tsx` — same prefill reconciliation + **facility derived from the resident** on submit (fixes the cross-facility 400)
- `src/app/(admin)/billing/ar-aging/page.tsx` — uses shared link helpers; resync effect returns the same array ref when unchanged (kills the double full-fetch on entry)
- `src/app/(admin)/billing/billing-invoice-ledger.tsx` — uses shared link helpers; removed the duplicate "Mark paid"
- `src/app/(admin)/billing/rates/page.tsx` — hoisted per-row label array to a module const
- `src/app/api/admin/facilities/route.ts` — removed the global `.limit()` on `risk_score_snapshots` (was starving facilities of `survey_readiness_pct`)
- `src/components/common/source-readiness-callout.tsx` — amber literals → semantic `warning` token
- `src/components/residents/AdminResidentsPageClient.tsx` — removed the always-blank `care_note` CSV column, the dead `careSummary` search clause, and the stale placeholder (the field itself is kept)
- `src/components/staffing/AdminStaffingConsolePageClient.tsx` — single-pass compliance counts
- `src/hooks/useFacilities.ts` — `lastFetchAtRef` set on cache hit; `invalidateFacilitiesCache()` export; expired-entry pruning
- `src/hooks/useFacility.ts` — calls `invalidateFacilitiesCache()` on successful update
- `src/hooks/useFacilities.test.tsx` — added cache-invalidation test
- `supabase/migrations/20260514180707_homewood_round2_employee_seed.sql` — removed the `ALTER TYPE … ADD VALUE` block (moved to the earlier migration below)

**New (untracked)**
- `src/lib/billing/billing-links.ts` — shared `collectionActivityHref` / `paymentHref`
- `src/app/(admin)/billing/payments/new/page.test.tsx`, `…/collections/new/page.test.tsx` — prefill reconciliation tests
- `supabase/migrations/20260514180000_staff_role_enum_values.sql` — `staff_role` `ADD VALUE` split out (txn-safe replay)
- `supabase/migrations/260_align_facilities_ahca_expiration_to_date.sql` — guarded `timestamptz→date` convergence
- `supabase/migrations/261_apply_invoice_payment.sql` — atomic payment RPC (`SECURITY INVOKER`, row lock)

> ⚠️ The untracked `test-results/agent-gates/*.json` files are pre-existing artifacts, **not** part of this work. Don't stage them.

---

## 3. Re-run verification

```bash
cd "/Users/brianlewis/Circle of Life/Circle-of-Life"
npm run typecheck && npm run lint && npm run test
npm run migrations:check && npm run migrations:verify:pg
npm run build
# Browser gate (needs Playwright):
npm run segment:gates -- --segment "code-review-remediation" --ui
```

---

## 4. Remaining work

### 4a. Migrations vs. live prod — **required before deploy**
I could not reach Haven prod (`manfqmasfqppukpobpld`) from my session, so the three new migrations are written **idempotent/guarded** (no-ops where the schema is already correct). Before/with deploy:

**Run these read-only checks on prod** to know what's actually needed:
```sql
-- 1) staff_role values (expect the 14 already present on prod → 20260514180000 is a no-op there)
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
WHERE t.typname='staff_role' ORDER BY e.enumsortorder;

-- 2) is ahca col date or timestamptz? (drives whether 260 does anything)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='facilities'
  AND column_name='ahca_license_expiration';

-- 3) diet_orders shape (context for 4c)
SELECT column_name, data_type, udt_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='diet_orders' ORDER BY ordinal_position;
```

**Apply order** (your normal Supabase deploy / CLI / MCP `apply_migration`):
1. `20260514180000_staff_role_enum_values.sql`
2. `260_align_facilities_ahca_expiration_to_date.sql`
3. `261_apply_invoice_payment.sql`

**Two gotchas:**
- `20260514180000…` sorts **before** the already-applied `20260514180707…` seed. That ordering is required for fresh replay (the enum values must commit before the seed's transaction uses them). On **prod the values already exist**, so it's a pure no-op there — if your tracker rejects an out-of-order insert, record it as applied/skip on prod; it only matters for fresh-replay/CI.
- `20260514180707…` was **edited** (ALTER TYPE block removed). It's already applied on prod, so it won't re-run. If your tooling checksums applied migrations, expect a "modified" notice — the repo's `MIGRATION-REPLAY-HARDENING` policy sanctions editing historical migrations; confirm your pipeline tolerates it.

### 4b. (DONE) Atomic payment RPC — finding #8
Implemented as `261_apply_invoice_payment.sql` and wired into `payments/new/page.tsx`. The function locks the invoice row (`FOR UPDATE`), clamps against the live balance, and updates `amount_paid`/`balance_due`/`status` atomically. It is `SECURITY INVOKER`, so the caller's RLS on `invoices` still applies (same authorization as the prior client UPDATE) and audit triggers fire. Just apply the migration (4a).

### 4c. diet_orders (finding #1) — intentionally NOT changed
Investigated and skipped on purpose: migration **174 unconditionally `DROP … CASCADE` + recreates `diet_orders`** before 237 runs, so prod and fresh-replay already converge to the same shape — the finding's premise (an 089 enum table surviving to 237) can't occur. Migration 238's own header documents the real residual as an **app-layer enum-vs-int inconsistency** ("the hook layer expects 174 shape, the admin layer expects 089 shape"), deliberately deferred. **Do not** ship a blind enum→int migration — `src/lib/dietary/med-fluid-diet-hints.ts` and `dietary/page.tsx` read `iddsi_food_level` as the enum string and it would break live dietary pages. If you want to close the inconsistency, it's a separate effort: pick the canonical representation and align the dietary admin pages + hooks; confirm prod's actual `diet_orders` shape first (check #3 above).

### 4d. Browser gate
Run `segment:gates --ui` (design-review screenshots + axe). Eyeball the `warning`-token callout (reports / revenue / executive pages, light + dark) and the rewritten staffing console.

---

## 5. Commit / merge / deploy

Per `AGENTS.md` rule #9 (one atomic commit per segment, gate artifact required):

```bash
# 1) finish 4a/4d as needed, then run the gate that writes the artifact:
npm run segment:gates -- --segment "code-review-remediation" --ui   # writes test-results/agent-gates/*.json

# 2) stage ONLY this work (exclude unrelated pre-existing agent-gates json noise)
git add src/ \
        supabase/migrations/20260514180000_staff_role_enum_values.sql \
        supabase/migrations/260_align_facilities_ahca_expiration_to_date.sql \
        supabase/migrations/261_apply_invoice_payment.sql \
        "supabase/migrations/20260514180707_homewood_round2_employee_seed.sql" \
        HANDOFFS/2026-05-28__code-review-remediation-handoff.md
#    plus the new gate artifact this run produced, if your process commits it.

# 3) commit
git commit   # message below

# 4) push + PR → main, then merge per your flow
git push -u origin codex/complete-app-cleanup
```

Suggested commit message:
```
fix(billing,facilities,migrations): remediate code-review findings

- billing forms: reconcile deep-link prefills (resident cohort + merge-by-id,
  invoice validated vs loaded set, collections derives facility from resident),
  drop amount carry-over; apply invoice balance via atomic RPC
- share collection/payment link builders; remove duplicate "Mark paid"
- ar-aging single fetch on entry; facilities snapshot covers all facilities;
  useFacilities cache invalidation + visibility-throttle fix
- residents: drop blank care_note CSV col + dead search clause
- source-readiness callout uses warning token
- migrations: split staff_role ADD VALUE for txn-safe replay; guarded
  facilities.ahca_license_expiration -> date; apply_invoice_payment RPC
```

**Deploy notes:** App deploys via **Netlify** on merge to `main`. **Migrations deploy separately** — apply 4a to Supabase through your normal channel; they are not run by the Netlify build. Apply migrations **before or with** the app deploy (all changes are backward-compatible: the app already expects `date` for ahca, no code depends on the enum split, and the RPC is only called by the updated payments page).

---

## 6. Jarvis Frontend Handoff (backend/migration changes)

1. **Tables/columns:** `facilities.ahca_license_expiration` may change `timestamptz → date` on prod (migration 260, only if currently timestamptz). This **fixes** `src/lib/admin/facilities/license-record-metrics.ts`, which expects bare `YYYY-MM-DD` and was getting `null` from a timestamptz serialization. No frontend change required.
2. **RPC functions:** **new** `public.apply_invoice_payment(p_invoice_id uuid, p_amount_cents int) RETURNS void`. Applies a payment to an invoice atomically (locks the row, clamps to live balance, updates `amount_paid`/`balance_due`/`status`). `SECURITY INVOKER` (RLS enforced). Called from `payments/new`.
3. **TypeScript types:** no regen required for the column change (both `date` and `timestamptz` map to `string | null`). **Do** regenerate `src/types/database.ts` after deploy so `apply_invoice_payment` is typed (the client currently calls it via an `as never` cast); once typed, drop the cast.
4. **New data/UI surfaces:** none — behavior fixes only.
5. **Breaking changes to queries:** none. One output change: the residents CSV export **no longer has a `care_note` column** (it was always blank). If anything parses that export by column index, update it.
6. **Enum/constraint changes:** `staff_role` values are unchanged in effect (already present on prod; the split is replay-only).

---

## 7. Watch-items
- The `20260514180000` out-of-order timestamp + the edited `20260514180707` — handle per 4a if your migration tracker is strict.
- `useFacility.ts` now imports `invalidateFacilitiesCache` from `useFacilities.ts` (hook→hook; no cycle).
- After deploy, regenerate DB types and drop the `as never` cast on the `apply_invoice_payment` rpc call in `payments/new/page.tsx`.
- Decide 4c explicitly so it isn't silently dropped.
