# Independent Codex technical review — PASS

Reviewer: separate Codex agent `/root/integration_review`, acting as technical code/evidence reviewer. This is not human staff acknowledgement, clinical acceptance, facility acceptance or release approval.

Reviewed 2026-09-13 UTC. Target: `iwcnajanvjvynolltflw` only. Canonical integration source: `b3e1d819874c942afb737f46eaa632ba54de247c`, with separately recorded synthetic staging migration variants. Application HTTP ran through the local application against real hosted Supabase Auth, PostgreSQL and Storage; this does not establish a deployed public application.

## Evidence and result

Read the harness, COL-143 handoff and retained HTTP/SQL records 001–164. Independently checked cross-record identities, revisions, attribution and digests, rather than relying only on harness success. The retained configuration (`../staging-isolation.json`, `../config-after.json`) exposes only `public,graphql_public`, excluding Storage metadata from PostgREST.

- Administrator, assistant and late-entry flows: real signed uploads; Storage owner and owner_id match the uploader; observed size/MIME/version and plain MD5 eTag match uploaded bytes. Finalization completes one original performance receipt. Its recorder, performed_at, recorded_at and revision remain unchanged. Corporate signed downloads return matching MD5/SHA-256 and 70-byte length. GET response headers and downloaded-byte digests establish the object checks; a separate HEAD request was not run.
- Wrong site and other uploader: application routes refuse access; direct RPCs explicitly report another uploader; Storage returns RLS AccessDenied. Corporate unfinalized reads are refused. Stale receipt revision returns conflict. The in-flight evidence remains uploaded with zero forbidden finalized/failed events.
- Finalized signing/overwrite: Storage refuses both; subsequent corporate download bytes remain identical.
- Checksum failure: required-photo extension 136–151 proves failed evidence leaves the receipt missing, occurrence in progress, and zero satisfaction events. A distinct valid replacement completes the same original performance, with unchanged attribution/revision and matching corporate download bytes.
- Revoked grant: existing session is refused for new finalize/download requests; in-flight evidence remains uploaded. Anonymous route/RPC and valid-transport Storage requests are refused. Record 114 is a malformed-header diagnostic and is excluded from authorization evidence; record 124 establishes anonymous AccessDenied.

## Cleanup and redaction

Independently compared record 152 deletion request and response names against the private creating-run manifest: exactly seven owned object paths, no others. Records 158–159 establish zero owned objects, active profiles, active grants, live fixture sites or live fixture entities; four receipts, seven evidence rows and 22 evidence events remain. Records 160–163 are successful Auth GET readbacks for the four exact fixture actors with future bans.

Independently scanned all 164 numbered records against actual private staging credentials and fixture passwords, and checked JWT patterns: no matches. Signed URLs and authorization headers are redacted.

## Limits

PASS applies to the written bounded COL-143 hosted upload/finalize/completion/download positives and negative controls above, including required-evidence retry and fixture cleanup. Synthetic facility-scoped photo fixtures were used; no real Homewood staff acted. Separate browser/UI evidence was not reviewed here. Previously issued signed-URL expiry/revocation, every MIME/size combination, production, provider integration and human operating acceptance are not established. No hosted mutation or Linear closeout was performed by this reviewer.
