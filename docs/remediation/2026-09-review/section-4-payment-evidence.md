# BUS-001 local evidence

Mission alignment: pass — payment and invoice balances now commit together with current actor authority and auditable financial writes.

## Scope and policy

`docs/specs/16-billing.md` Payment Application requires the payment amount to be applied to the linked invoice. Its COL Alignment Notes do not define overpayment credit/allocation policy. The command rejects an amount above the live balance; it does not clamp, create credits, or invent split allocations. Existing unapplied payments remain supported.

Repository search for `apply_invoice_payment` and payment table writers found the new-payment page as the only application payment INSERT / legacy allocation RPC caller. The other payment references in billing ledger/revenue, family billing, finance forecast/GL, and the knowledge agent are readers. Migration 338 removes authenticated direct INSERT and legacy allocation RPC execution. Existing historical payments and invoice editing permissions remain intact. New receipt-owned payments reject financial identity changes, unlinking, and deletion; deposit/refund metadata and notes remain editable.

## Verification

- `npx vitest run 'src/app/(admin)/billing/payments/new/page.test.tsx'`: 9/9 PASS. Includes ambiguous retry identity, initial definite rollback correction, later denial after ambiguity, incomplete receipt, original actor attribution and account-switch prevention, plus unavailable invoice-intent blocking, direct resolution of a valid requested invoice beyond the first 50 options, and existing time tests. The out-of-page lookup retains invoice/resident/open-status/nondeleted scope and RLS; its regression also verifies the original invoice ID reaches the command.
- Targeted ESLint on the page and its tests: PASS.
- `REQUIRE_PG_VERIFY=1 npm run migrations:verify:pg` with explicitly run-owned native socket, port 55443 and PostgreSQL 17 binaries: PASS, 341 migration files and 22 SQL probes. The test reproduces the old split-write failure using the retained legacy helper and an injected invoice update error. New command proofs include exact/altered request, overpayment, wrong resident, expected caller mismatch, revoked facility, changed tenant/role, recovery after source deletion, and payment/invoice/receipt/audit failure rollback. The final receipt-immutability regression executes as the privileged replay owner: receipt creation succeeds, while direct UPDATE and DELETE each reject with 42501 and preserve the original evidence.
- `section-4-payment-concurrency.py` with the same explicit native environment: PASS. Two overlapping 6000-cent attempts against a 10000-cent invoice produce one commit and one live-balance rejection; amount_paid=6000, balance_due=4000, exactly one payment and receipt. Script creates and drops its own database and never stops the shared server.
- `git diff --check`: PASS.

## Recovery behavior and limits

The request captures actor, facility, request UUID and immutable payment payload before sending. SQL checks expected actor against the current authenticated actor before receipt retrieval or financial writes. A refreshed or newly signed-in session for the SAME actor may retry under current authority. A different actor/facility is blocked. Source eligibility changes do not erase a committed receipt; current role, organization and facility authority remain required.

The first definitive SQL rollback allows correction. Any ambiguous response permanently preserves that attempt's identity even if a later retry receives a definite denial. Success requires the complete matching command receipt. Recovery is in the current open page; no payment payload is persisted in browser storage, and the UI instructs the operator to keep the page open. Hosted verification, independent review, global gates and release remain with the parent task.

## Source hashes (SHA-256)

- `supabase/migrations/339_atomic_payment_recording.sql`: `4fde33aca986e04af11852d9c9ecf9c99bb0b305c9eec1805218a547e93db336`
- `supabase/tests/review_section4_payment.sql`: `58a4c0cbb2b871ab32610d276d237932d04653b97f4f297f93e02737f9997f61`
- `src/app/(admin)/billing/payments/new/page.tsx`: `8074e225af18f1e3c7150962410efe24a4dac0d75da90947a57a706fe22688db`
- `src/app/(admin)/billing/payments/new/page.test.tsx`: `9f424bd8351797ae64a8d668857cf4b48a3e14a70d81614407090b693bc467d1`
- `docs/remediation/2026-09-review/section-4-payment-concurrency.py`: `fc38a5f3db565ca014cd574179309a6d574f688730814c588023a2da63d0064e`

Migration filenames above use the current release numbering; original review-time numbering and unchanged SQL hashes are recorded in [RELEASE-MIGRATION-NUMBERING.md](RELEASE-MIGRATION-NUMBERING.md). Historical execution statements retain their original numbering.
