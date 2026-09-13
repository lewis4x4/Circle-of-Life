# COL-223 receipt history wording proof

Source HEAD `d039c767595de97531d4d9355d14c565b6ebb2f7` plus owned source diff SHA-256 `1a67caa3531e95b3581d75077dcefa27509f04fcb1f574fac89435b329e77c01`; source unchanged across both browser phases. Per-file hashes are retained in the UI reports.

## Changed behavior

The display names current evidence separately from the original immutable receipt state, which is explicitly historical. When current evidence is unavailable, fallback evidence is labeled at recording. It never derives overall completion from evidence alone. Stored values, recorder, times and correction history are unchanged.

## Executed verification

- Red regression: two new component cases failed on the original labels; original evidence/download test passed.
- Green: 33 tests across receipt-history and Site work passed; npm typecheck, targeted ESLint and diff check passed.
- Fresh synthetic actor/site on verified staging `iwcnajanvjvynolltflw`, schema365, through local stage-bound Next app port4323. Existing banned actors were not reused.
- Before upload: authenticated actual History at1440px and375px showed current evidence missing and explicitly historical performed_missing_evidence; zero axe/page/read errors.
- Uploaded a real70-byte PNG via session-scoped signed Storage PUT, then actual application uploaded/finalize endpoints. Checksum verified. `evidence-finalization.json` records backend proof: occurrence status/execution completed, current evidence complete, original receipt evidence missing and completion_state performed_missing_evidence.
- Compared every receipt field before/after, excluding only the designed mutable evidence_status_current/evidence_satisfied_at projection. Immutable hashes match: `de1a578690f2b2b2acbe389b2cec97630483f4a90ae25d7f89bb4377712931e9`. Recorder, recorded/performed times, original state and revision are unchanged.
- After finalization: authenticated History at both widths showed Current evidence: complete and Original receipt state (historical): performed_missing_evidence, with an attached photo and download action. Zero axe/page/read errors. Before/after full-page and receipt-detail screenshots are retained.

## Failed harness attempt

The first before-phase browser run expected a nonexistent No finalized attachments label; actual existing empty-state copy is No attached evidence. Both failures and screenshots were preserved (`before-ui-initial-report.json`, initial log and failed screenshots). Corrected only the test selector and reran successfully. No application failure was inferred and no timeout was increased.

## Boundaries and cleanup

This is real authenticated staging-backed local UI and Storage transport proof, not a production deployment or staff acceptance. No backend data/schema/authority code changed. Parent owns final strict/full gates, independent review and release.

`cleanup.json` verifies the exact fresh actor banned/inactive, zero live grants, synthetic site retired, and owned app port4323 stopped. Finalized evidence/history remain; no source records were deleted. Private credentials/retired session provenance remain in `~/.config/haven-staging/col223-fixture.json`; do not reactivate them.
