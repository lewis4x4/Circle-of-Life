# COL-217 — Haven staging setup and integration closeout

Mission alignment: **pass**. Brian authorized the proposed Micro staging project and Codex integration/testing with “Handle it.” and “Please proceed.”

## Delivered

Created **Haven HFO Staging** (`iwcnajanvjvynolltflw`) in the Circle of Life Supabase organization, us-west-2, Micro. Confirmed separate from production. Private credentials remain outside git. No Netlify site, optional add-on, production change or production-data clone was created.

Integrated committed main at `50bc07c4`, Finance at `0d0e7763` and HFO at `b83bf7b5` in the isolated `codex/hfo-col217-staging-integration` branch. Tested application/source revision: **b3e1d819874c942afb737f46eaa632ba54de247c**. Finance precedes HFO authority; all 342 original main migration files remain unchanged. Forward migration 363 fixes an independently discovered audit-export visibility gap; its regression fails before the fix and passes afterward.

Historical source bootstrap required a separate synthetic staging copy: 27 files replace seed identities/contact metadata, omit real-resident workbook data and precommit three existing enum additions. All original/applied hashes are explicit.366 per-file transaction migrations and 46 probes passed; final schema/functions/constraints/policies/grants match canonical source, excluding ownership/comment metadata. The failed initial attempts and guarded clean rebuild of this run-created staging database are retained in [setup summary](col217-evidence/staging/setup-failure-summary.json). Raw old seed logs stay private.

Applied all366 copies through 363 to staging. Confirmed the private operation-evidence bucket, six Storage policies, checksum amendment, current request guard, enabled Auth hook and non-exposure of Storage schema. Signup is disabled and inherited seed logins are banned/inactive.

## Verification

- 4,410 tests passed / two existing skips; typecheck, lint, build, security and chaos gates passed.
- 366 migrations /46 SQL probes; synthetic-copy per-file transaction replay and schema/ACL comparison passed.
- Independent source integration and synthetic-copy reviews passed.
- COL-143 real hosted proof passed four performance flows and negative controls across 164 redacted records. Separate Codex technical review passed. [Result](col143-evidence/hosted-proof/RESULT.md).
- Exactly7 test objects deleted; four fixture actors banned/inactive and grants revoked; two sites and one entity retired.4 receipts, 7 evidence rows and 22 events retained as immutable history.
- All 38 pre-existing worktree heads/statuses and recorded dirty-file hashes were unchanged.

Authenticated Site A Today/History and invoice pages rendered at desktop/mobile widths, with four finalized receipts visible. UI acceptance is **not** green: COL-221 contrast, COL-222 landmarks, COL-223 historical receipt wording, and COL-224 an initial hydration observation are recorded separately. The hydration cause is unverified; two later loads did not reproduce it.

## Operational state and boundaries

Supabase staging persists; the local test app was stopped after verification. The private staging `.env.local` remains in this worktree. Retired test credentials and browser states remain private and cannot be treated as live access. Do not rerun reset scripts against the retained proof history. Future proof uses fresh scoped fixtures and current target/source checks.

No main merge, production deployment, external provider messaging, real staff action or facility acceptance occurred. Previously issued signed-URL expiry/revocation and all MIME/size combinations were not tested; current-request revocation and the bounded photo workflow were proven. Independent technical review is explicitly Codex, not human approval.

## Next

COL-217 is Done as the target/integrator/revision decision and setup prerequisite. Close COL-143 as bounded evidence delivery using the retained actual proof and review, then proceed to COL-149 corporate Facility→Activity→complete History. COL-140 configuration and COL-161 release/acceptance gates remain distinct. Source/evidence branch is reviewable as a draft PR; its final documentation commit does not change the tested app code.
