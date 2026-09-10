# Facility operations verified evidence — COL-143

Status: PARTIAL — HFO-07 source portion. September 10, 2026. Extends the [receipts](27-facility-operations-receipts.md) contract under BUILD-SCOPE section 5 ("Evidence"; "Evidence supplied after performance") in the Storage pattern of the employee file lifecycle (migration 335). This is source implementation with local stand-ins for uploads: no byte is transferred, no hosted bucket is proven, and the issue's third acceptance item (a real upload, finalize, completion and corporate download with positive hosted Storage HTTP proof) remains open until that proof is retained.

## Evidence is metadata first

`operation_evidence` is the immutable identity of one piece of evidence for one performance receipt: the receipt's site, subject and authority class, the kind (`document`, `photo`, `signature`, or `linked_record`), the governing evidence rule it is meant to satisfy (or none, for supplementary material that never counts and never blocks), the owned object path `<facility>/<evidence id>/<filename>` in the private bucket `operation-evidence`, the declared type and size (four allowed types, twenty mebibytes), an optional declared checksum recorded but not verified locally, the uploader, and a state that only moves forward: `prepared` → `uploaded` → `finalized`, or `prepared`/`uploaded` → `failed`. Every write goes through the commands under the owner-secret token; every transition is an event in `operation_evidence_events`. A `linked_record` points at a native protected record (`facility_documents`, `employee_file_records`) under that record's own access and is finalized at preparation when the caller can read it; nothing is copied into a broad bucket.

## Wrong, unowned or unfinished objects satisfy nothing

Only a finalized row with a matching rule label counts toward a rule. Finalization requires the storage object at the owned path, owned by the uploader, with the declared size and type; a wrong-site path, a foreign object, a prepared row without its object or a failed row cannot satisfy a rule. The Storage policies admit a write only to the uploader's own prepared path and a read only of finalized objects (or the uploader's own in-flight object) by someone who can read the task; there is no client update or delete; corporate download is a signed URL from the session, so the same policy decides. Task lists, receipts and issue reads never carry object paths or filenames of restricted files; the evidence list shows another uploader's row only once it is finalized.

## Failure stays truthful; retries deduplicate

A required upload that fails or is never finalized leaves the receipt in `performed_missing_evidence` and the occurrence in progress; a failed supplementary upload never appears attached. A retry is a new preparation: a request key replays exactly, and a finalized row with the same declared checksum on the same receipt is reported instead of duplicated.

## Later evidence satisfies the same performance once

When every applicable required rule has enough finalized evidence, finalization appends a `satisfied` event and sets the receipt's current evidence status and satisfied instant; the receipt's original missing-evidence list, performer, performed-at and recorded-at stay untouched, no second performance is created and no second completion click is needed. The occurrence then moves from `performed_missing_evidence` to `completed`, or to `awaiting_verification` when the rule requires review (the COL-142 verification now treats evidence as present when the current status is complete). Finalization carries the expected receipt revision, so a correction that moved the receipt (HFO-08) makes the finalization conflict instead of silently attaching to a superseded performance.

## API

`POST /api/admin/operations/evidence` (prepare; returns the evidence and a signed upload URL from the session), `POST …/evidence/[id]/uploaded`, `POST …/evidence/[id]/finalize`, `POST …/evidence/[id]/fail`, `GET …/evidence?receipt_id`, `GET …/evidence/[id]/download` (finalized only). Replies carry the server-authoritative outcome class.

## Verification

1. `npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts`
2. `npm run typecheck`; `npm run lint`; `npm run segment:gates -- --segment COL-143-HFO-EVIDENCE --ui`
3. Native replay executes `supabase/tests/review_hfo_verified_evidence.sql` (with `storage.objects` rows inserted directly as upload stand-ins) and `scripts/facility-operations/test-evidence-concurrency.py` observes two concurrent finalizations and a finalization racing a receipt revision change on the run-owned PostgreSQL 17 cluster.

## Migration and rollback

`343_hfo_verified_evidence.sql` (provisional number) follows this branch's unapplied 336–342 and replaces in place the 341 receipt guard (two token-gated columns) and the 341 verification body (evidence present when the current status is complete). Numbers are branch-local; integrate after COL-144 in the recorded Finance-first order and re-read the hosted ledger before assigning final numbers. Before application, rollback is reverting this segment. After application, drop the two tables, the four commands, the storage access function and its policies, and the bucket only if it is empty; restore the two 341 bodies; the receipt columns are additive.

Open: acceptance item 3 (hosted proof), Q10, Q23; `reading` rules and corrections (HFO-08). Engineering policies recorded for confirmation in `docs/facility-operations/OWNER-DECISIONS.md` (3f). Mission alignment: PASS for the bounded foundation. Operating readiness: RISK.
