# COL-143 — attach documents, screenshots and photos through scoped verified evidence (source portion)

**Source portion implemented, independently reviewed and verified locally on the feature branch; the issue stays In Progress in Linear until the hosted Storage proof exists.** No hosted migration, deployment, byte transfer, real upload, download or operating acceptance has occurred. Nothing is merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Occurrences`; branch `codex/hfo-col143-evidence`, stacked on COL-144 (`89ed6aca` over `f97fb50f`). COL-132, COL-133, COL-135, COL-137, COL-139, COL-142 and COL-144 are Done in Linear as reviewed, gated, unmerged source; COL-143 integrates after COL-144 in the recorded Finance-first order.

## The blocker, precisely

Acceptance item 3: an authorized administrator or assistant performs a real upload, finalize, completion and corporate download, and positive hosted Storage HTTP proof is retained. That needs the hosted Supabase project's Storage (bucket creation, signed upload and download over HTTP, object metadata written by the Storage API) and a signed-in browser or HTTP client. Source-only work proves the same flow with `storage.objects` rows inserted directly in the local replay as stand-ins. The owner or integrator completes item 3 after the migrations are applied to the hosted project; the steps are listed under "Hosted proof to retain" below.

## Delivered

- Migration `343_hfo_verified_evidence.sql` (provisional): `operation_evidence` (classified immutable identity, owned object path, declared type/size/checksum, forward-only states, linked native records), `operation_evidence_events`, bucket `operation-evidence` with 335-pattern object policies and `haven.operation_evidence_storage_access`, commands `prepare`, `mark_uploaded`, `finalize`, `fail` (each `*_operation_evidence_review`, uploader-only for in-flight rows) under the owner-secret token and the work-authority lock taken on the occurrence before the receipt (so overlapping uploads serialise instead of deadlocking), linked records checked against the receipt's subject and authority class, the satisfaction transition on the receipt and occurrence, and the 341 receipt guard and verification bodies replaced in place.
- Library `src/lib/operations/evidence.ts` and routes for prepare (with a session-signed upload URL), uploaded, finalize, fail, list and download; receipts carry their current evidence status.
- Canonical contract: [evidence](../specs/27-facility-operations-evidence.md). Settled engineering contracts: `col143-evidence/engineering-contracts.md`.

## Acceptance

1. Wrong-site/subject/unowned/unfinalized objects cannot satisfy evidence; restricted files cannot leak through task metadata: probe (wrong kind, unknown rule, wrong-site path, foreign or unowned object, prepared row without its object, failed row, linked records of another employee, another class or another site all refuse or count for nothing; another recorder cannot write the uploader's path nor read an unfinalized object; no receipt or task column carries a path).
2. Required upload failure leaves performed/evidence-incomplete; optional failure never appears attached; retries deduplicate: probe (failed required upload leaves `performed_missing_evidence`; a failed supplementary row is never attached; a retry finalizes once; the same declared checksum after finalization is refused naming the existing evidence).
3. Real hosted upload → finalize → completion → corporate download with positive Storage HTTP proof: **open** (blocker above; steps below).
4. A valid retry after failure satisfies the same performance once through appended evidence history; concurrent correction conflicts safely; original attribution and times unchanged: probe (one `satisfied` event, immutable receipt facts and occurrence attribution byte-identical before and after) and the three-case race script (two finalizations of one evidence, a finalization racing a receipt revision change, two finalizations overlapping on the occurrence row).

## Hosted proof to retain (for the owner or integrator, after apply)

1. Sign in as a Homewood facility administrator or assistant with a current site grant and `can_record` where the subject is protected.
2. Record a photo-required activity through `POST /api/admin/operations/occurrences/[id]/record` and confirm `performed_missing_evidence`.
3. `POST /api/admin/operations/evidence` for the photo rule; upload the file with the returned signed URL (HTTP 200 from Storage); `POST …/evidence/[id]/uploaded`; `POST …/evidence/[id]/finalize` with the receipt revision; confirm the occurrence is `completed` (or `awaiting_verification`) and the receipt's current evidence status is `complete`.
4. As a corporate user with the site grant, `GET …/evidence/[id]/download` and fetch the signed URL (HTTP 200; the object's size and type match). Retain the request and response logs (no object bytes) under `col143-evidence/hosted-proof/`.

Differences between the local stand-in and hosted Storage that the proof must confirm (recorded by the SQL review): the hosted Storage API writes the uuid `owner` column only when the token's owner is a uuid (and always writes the text `owner_id`), so the proof must show `owner` non-null for a signed-upload-URL upload, otherwise nothing finalizes and the command must be switched to `owner_id`; the metadata keys `size`, `mimetype` and `eTag` match the Storage API; the signed upload URL is authorized against the insert policy at signing time while the PUT itself runs as the Storage service, so a row failed between signing and upload leaves a harmless orphan object that finalize refuses; the `storage.objects` policies rely on the same hosted privileges as migration 335.

## Boundaries kept

`reading` rules and corrections (HFO-08) are out of scope; linked records stay under their own access; Q10 and Q23 open. Five engineering policies are listed for confirmation in `OWNER-DECISIONS.md` (3f).

## Evidence

Focused suite, typecheck, lint, native replay of 346 migration files with 27 probes including `review_hfo_verified_evidence.sql` (126 assertions), the three-case race script, independent SQL and TypeScript reviews with dispositions and the SQL re-verification, strict gate artifact: see [verification](col143-evidence/verification.json) and [review](col143-evidence/independent-review.json). Local PostgreSQL uses Supabase stubs, synthetic fixtures and directly inserted `storage.objects` rows; hosted Storage, Auth, browser and staff acceptance are not established.

## Resume and rollback

After the source segment: live Linear offers no further dependency-ready HFO issue that source-only work can close (COL-140 needs owner answers; COL-145, COL-146 and COL-148 wait on this issue's hosted proof). Before deployment, rollback is reverting this segment. After application, drop the two tables, the four commands, the storage access function and policies, and the empty bucket; restore the two 341 bodies. Mission alignment: **PASS** for the bounded foundation; hosted and operating readiness: **RISK**.
