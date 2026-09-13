# COL-143 hosted Storage proof — RESULT

- Staging project: `iwcnajanvjvynolltflw`; production excluded.
- Integration SHA: `b3e1d819874c942afb737f46eaa632ba54de247c`.
- App instance: `http://127.0.0.1:4317` against hosted staging.
- Run ID: `col143-95d3102349`; window: 2026-09-12T23:51:52.348495+00:00 → 2026-09-13T00:00:13.480988+00:00.
- Auth custom access-token hook and authoritative request guard verified by parent; all four fresh actor tokens contained session_id and auth_claim_version.
- Applied ledger and schema are retained in preflight records; checksum amendment present; private 20 MiB operation-evidence bucket with six policies.
- Tester: Codex hosted-proof executor. Independent technical reviewer: separate Codex agent integration_review; final PASS in INDEPENDENT-REVIEW.md. No human staff or release acceptance is claimed.
- Result: all positive flows and authorization/immutability/checksum cases passed. Cleanup completed after parent confirmed UI smoke completion.

## Positive and invariant evidence

| Step | Actual result | Retained evidence |
|---|---|---|
| admin: record → upload → checksum verification → finalize → corporate bytes | PASS; receipt `169955e5-6edb-43dc-9a7d-241ac3833047` completed; original recorder, performed_at, recorded_at and revision unchanged; 70-byte image/png with matching SHA-256/MD5, attachment header | `033-record-admin.json`, `036-prepare-object-admin.json`, `052-attribution-admin.json`, `054-corporate-download-admin-bytes.json`, `115-attribution-admin.json`, `117-corporate-download-admin-bytes.json` |
| assistant: record → upload → checksum verification → finalize → corporate bytes | PASS; receipt `0a30982f-fe32-4c6e-96b1-09c142cbcd73` completed; original recorder, performed_at, recorded_at and revision unchanged; 70-byte image/png with matching SHA-256/MD5, attachment header | `064-record-assistant.json`, `067-prepare-object-assistant.json`, `070-attribution-assistant.json`, `072-corporate-download-assistant-bytes.json` |
| late: record → upload → checksum verification → finalize → corporate bytes | PASS; receipt `28aaf45e-0cf7-4ff1-8659-2a292e0c06e5` completed; original recorder, performed_at, recorded_at and revision unchanged; 70-byte image/png with matching SHA-256/MD5, attachment header | `082-record-late.json`, `085-prepare-object-late.json`, `088-attribution-late.json`, `090-corporate-download-late-bytes.json` |
| Late performance | PASS; explicit late entry records performed_at two hours earlier; later evidence completes the same single performance receipt | `082-record-late.json`, `088-attribution-late.json` |
| Finalized bytes immutable | PASS; overwrite refused and actual corporate download remains byte-identical | `093-neg-finalized-resign.json`–`096-unchanged-after-overwrite-bytes.json` |

## Negative cases — observed provider responses

HTTP status is shown separately from the provider body statusCode. Missing-authorization-header validation is diagnostic only; the additional anonymous request with valid Authorization transport proves an authorization refusal.

| Case | HTTP | Observed body / state | Evidence |
|---|---|---|---|
| neg-siteb-prepare | 404 | Receipt not found | `038-neg-siteb-prepare.json` |
| neg-other-uploader-uploaded | 404 | Evidence not found | `039-neg-other-uploader-uploaded.json` |
| neg-other-uploader-rpc-uploaded | 400 | Evidence belongs to another uploader | `040-neg-other-uploader-rpc-uploaded.json` |
| neg-other-uploader-finalize | 404 | Evidence not found | `041-neg-other-uploader-finalize.json` |
| neg-other-uploader-rpc-finalize | 400 | Evidence belongs to another uploader | `042-neg-other-uploader-rpc-finalize.json` |
| neg-other-uploader-fail | 404 | Evidence not found | `043-neg-other-uploader-fail.json` |
| neg-other-uploader-rpc-fail | 400 | Evidence belongs to another uploader | `044-neg-other-uploader-rpc-fail.json` |
| neg-corp-unfinalized | 404 | Evidence not found | `045-neg-corp-unfinalized.json` |
| neg-corp-storage-sign | 400 | body statusCode=404; Object not found | `046-neg-corp-storage-sign.json` |
| finalize-admin | 409 | Receipt changed since it was read | `047-finalize-admin.json` |
| neg-siteb-sign | 400 | body statusCode=403; new row violates row-level security policy | `048-neg-siteb-sign.json` |
| neg-siteb-write | 400 | body statusCode=403; new row violates row-level security policy | `049-neg-siteb-write.json` |
| neg-finalized-resign | 400 | body statusCode=403; new row violates row-level security policy | `093-neg-finalized-resign.json` |
| neg-finalized-overwrite | 400 | body statusCode=403; new row violates row-level security policy | `094-neg-finalized-overwrite.json` |
| uploaded-admin | 409 | Uploaded object does not match the declared checksum; the evidence has failed and a new preparation is needed; evidence_outcome=checksum_mismatch; evidence.state=failed | `100-uploaded-admin.json` |
| finalize-admin | 401 | Sign in again to continue. | `106-finalize-admin.json` |
| neg-revoked-download | 401 | Sign in again to continue. | `107-neg-revoked-download.json` |
| neg-anon-route | 401 | Not authenticated | `112-neg-anon-route.json` |
| neg-anon-rpc | 401 | permission denied for function prepare_operation_evidence_review | `113-neg-anon-rpc.json` |
| neg-anon-storage | 400 | body statusCode=400; headers must have required property 'authorization'; transport validation only, superseded by valid-transport test below | `114-neg-anon-storage.json` |
| neg-anon-storage-valid-transport | 400 | body statusCode=403; permission denied for function accessible_facility_ids | `124-neg-anon-storage-valid-transport.json` |

## Provider facts established

- Signed upload returned HTTP 200 with an object path response; stored owner and owner_id matched each authenticated uploader.
- Storage eTag was a quoted plain MD5 matching the uploaded bytes. Application stored checksum_verified=true and checksum_method=storage_etag_md5.
- Wrong-site and finalized-write Storage requests returned HTTP 400 with row-level-security refusal text; corporate unfinalized signing returned HTTP 400 Object not found.
- Revocation refused the same actor session with HTTP 401 Sign in again to continue. The in-flight row remained uploaded; restoring the exact fixture grant required fresh login.
- Anonymous valid-transport Storage request returned HTTP 400 while JSON statusCode was 403, error Unauthorized, message permission denied for function accessible_facility_ids. This is an authorization denial, separate from the missing-header validation diagnostic.
- Successful application transitions use outcome=receipt and evidence_outcome=uploaded/finalized. Checksum mismatch uses HTTP 409, outcome=conflict and evidence_outcome=checksum_mismatch.

## Retention and cleanup

- Object payloads and signed URLs stayed in memory. Retained download evidence contains only headers, byte count and digests; credentials/passwords remain private.
- `REDACTION-AUDIT.json`: PASS across 164 numbered files.
- Private Playwright admin/corporate states refreshed after the revoked-grant case for parent UI smoke.
- Cleanup PASS: exactly seven manifest-owned objects deleted; four fixture profiles inactive, all owned site grants revoked, two sites and one entity soft-deleted, four Auth users independently read back as banned. Immutable evidence/receipt/audit history retained.
- No production, external provider, customer, clinical or facility acceptance claimed. Hosted proof is synthetic against the new staging project.

## Aborted or unexpected

- No application defect, source change or weakened guard was required.
- One intentionally anonymous request without Authorization triggered provider header validation. Added a correctly formed anonymous bearer request and observed authorization denial. Both retained.

## Review

- All 164 records, including required-evidence retry and exact-owned cleanup, independently reviewed PASS by the separate Codex integration_review agent; see INDEPENDENT-REVIEW.md. This is technical review, not human staff or release acceptance.
- Revoked grants were tested against new finalize/download requests. Revocation or expiry of previously issued signed bearer URLs was not tested.

## Required checksum failure and retry extension

- Additional receipt `bbdb39be-9fc8-4690-9fb4-d73d4100718c` started with required photo evidence missing.
- Wrong declared MD5 uploaded real bytes but returned HTTP409 conflict/checksum_mismatch and evidence.state=failed.
- SQL read immediately afterward confirmed evidence_status_current=missing, occurrence in_progress/performed_missing_evidence, and zero satisfied events.
- A fresh required-photo upload with the correct digest finalized and completed the same single performance receipt. Original recorder, performed_at, recorded_at and revision remained unchanged. Corporate actual bytes download matched 70-byte PNG digests.
- All additional records are retained below. Seven exact run-owned objects were subsequently deleted during authorized cleanup.

- `125-login-admin.json`
- `126-claims-admin.json`
- `127-login-corp.json`
- `128-claims-corp.json`
- `129-create-activity-required-mismatch.json`
- `130-draft-required-mismatch.json`
- `131-publish-required-mismatch.json`
- `132-site-draft-required-mismatch.json`
- `133-site-publish-required-mismatch.json`
- `134-generate-required-mismatch.json`
- `135-occurrence-required-mismatch.json`
- `136-record-required-mismatch.json`
- `137-required-mismatch-required-mismatch.json`
- `138-required-mismatch-storage-put-required-mismatch.json`
- `139-required-mismatch-object-required-mismatch.json`
- `140-uploaded-required-mismatch.json`
- `141-required-checksum-still-missing.json`
- `142-required-replacement-required-mismatch.json`
- `143-required-replacement-storage-put-required-mismatch.json`
- `144-required-replacement-object-required-mismatch.json`
- `145-uploaded-required-mismatch.json`
- `146-finalize-required-mismatch.json`
- `147-attribution-required-mismatch.json`
- `148-corporate-download-required-mismatch-sign.json`
- `149-corporate-download-required-mismatch-bytes.json`
- `150-corporate-list-required-mismatch.json`
- `151-receipts-required-mismatch.json`

## Cleanup executed

- Parent confirmed authenticated UI smoke finished and authorized exact-owned cleanup.
- Verified zero owned Storage objects, zero active profiles/grants, zero live sites/entities; Auth readback confirms all four actors banned.
- Retained history: four performance receipts, seven evidence rows, 22 evidence events.
- No source, other seed rows, project reset or guard changes.

- `152-cleanup-owned-objects.json`
- `153-deactivate-owned-fixtures.json`
- `154-ban-fixture-admin.json`
- `155-ban-fixture-assistant.json`
- `156-ban-fixture-corp.json`
- `157-ban-fixture-siteb.json`
- `158-cleanup-verify.json`
- `159-cleanup-final-sites-and-history.json`
- `160-verify-auth-banned-admin.json`
- `161-verify-auth-banned-assistant.json`
- `162-verify-auth-banned-corp.json`
- `163-verify-auth-banned-siteb.json`
- `164-cleanup-final-verdict.json`

## Execution closeout

The local test application was stopped after proof and authenticated read-only smoke. Supabase staging remains provisioned. No production source merge or deployment occurred. UI findings COL-221 through COL-224 remain separate; authenticated page rendering succeeded but UI accessibility acceptance did not pass.
