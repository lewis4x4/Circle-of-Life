# COL-143 hosted proof execution checklist

Prepared 2026-09-12. Not executed. Authorized staging: `iwcnajanvjvynolltflw`; production excluded. Integrator must signal ready before any fixture, Auth, Storage, or app mutation.

## Gates

- Integrator supplies exact verified integration SHA, local app URL, actual applied migration ledger, database connection identity.
- Auth access-token hook enabled; authoritative request guard enabled; token exposes session_id/auth_claim_version.
- Private operation-evidence bucket (20 MiB, reviewed mime allowlist), six Storage policies, checksum amendment installed.
- Local app uses staging URL/key, no production/provider/real-data access. Service credentials remain exclusively private.
- User approved new billable staging and Codex integration/testing in this task. Synthetic fixtures only. No external messages.

## Proof sequence

1. Re-read ledger, bucket/policies, checksum function definition and current database identity. Record actual numbering, not historical runbook values.
2. Create unique synthetic entity/sites/activity/subject and admin/assistant/corporate/other-site Auth fixtures. Create confirmed Auth users without sending emails; apply profiles and current grants before login.
3. Publish central photo requirement and confirmed site rule through authorized app routes; create today's occurrence via sanctioned service generator.
4. Admin records performance -> missing evidence; save immutable attribution/revision. Prepare -> signed upload -> actual Storage bytes. Inspect owner, owner_id, size, MIME, eTag; digest must match local bytes.
5. Mark uploaded; assert checksum verified. Test wrong-site preparation and Storage writes, corporate unfinalized read, assistant non-uploader uploaded/finalize/fail via routes and RPC, and stale-revision finalize. Refusals must preserve row/event state.
6. Finalize -> occurrence completed; corporate obtains URL and actually downloads bytes into memory; assert SHA-256/MD5, MIME and length. Confirm receipt's original performer/time/revision preserved and list responses hide object paths.
7. Separate assistant performance follows same full authorized path, including receipt completion and corporate actual bytes download.
8. Late evidence uses a separate performance recorded before upload, with timestamp preserved. Verify one performance receipt, original recorder/performed_at/recorded_at/revision unchanged, current evidence status becomes complete.
9. Test immutable finalized object (sign/write denied and bytes unchanged), wrong checksum -> failed row without satisfaction change, revoked site grant mid-flow -> old token refused for finalize/download and uploaded row unchanged. Restore only exact run-owned grant then reauthenticate.
10. Anonymous route/RPC/Storage refusal. Record real observed provider status and body shape; status disagreement is a finding, never silently normalized.
11. Cleanup only run-owned object paths; revoke fixture grants, deactivate profiles, soft-delete sites/entity; retain immutable receipts/evidence/audit. Verify absence of active fixture grants/objects. Parent independent reviewer validates results and redaction before issue closeout.

## Historical runbook corrections verified from current source

- `evidenceResultReply` returns outcome `receipt` for successful transition and `evidence_outcome` `prepared`, `uploaded`, `finalized`. Checksum mismatch returns HTTP 409, outcome `conflict`, evidence_outcome `checksum_mismatch`.
- Checksum amendment is present in current Reminders evidence.ts and migration; applied stack still requires verification.
- Never use historical fixed migration maximum 335/353 as live gate. Parent has integration ownership.
- Never reset the new shared staging project to clean fixtures; keep immutable synthetic audit and deactivate exact run-owned rows.
- Signed URLs and Auth data stay in memory; no unredacted temporary request/response files. Retained object data is digest/length only.

## Resume behavior

`proof.py` checkpoints each draft, publication, generation and record result into the private fixture manifest before the next step. It stores lane activity identity before inserting any row. A pending step without a saved response is an explicit uncertainty stop: inspect the redacted HTTP evidence and exact owned hosted rows, reconcile the result into the private lane checkpoint, then continue. It never automatically retries an uncertain draft creation/publication with a different identity. Prepared evidence identities/paths are persisted before Storage upload; signed URLs are not persisted. The positive lane stores uploaded/negative/finalized/completed checkpoints so completed lanes are skipped on rerun.

For failures after evidence preparation or inside a negative case, call the existing narrow `Proof` methods after login to resume the exact owned row. Do not rerun the full negative sequence: `prepare`, `uploaded`, `finalize`, `inflight_negatives`, `verify_completion` and `download` are independent methods; the private manifest supplies IDs. Any uncertain response requires a current-state read before retry. A new readiness SHA is needed if parent fixes and verifies integrated source.
