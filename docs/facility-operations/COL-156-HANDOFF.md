# COL-156 employee operations source handoff

## Implemented scope

Twenty source items map to 22 components and 14 Employee File fields. `col156-evidence/source-map-plan.md` preserves the complete mapping. The task-bound panel reads authorized native employee requirements, records and signature metadata, reuses `assessEmployeeFile`, and offers explicit snapshot reconciliation. It records no administrative performance, duty clearance, roster transmission or employment action.

E01 reads hire date; E06 uses TRN-24 CPR; E08 uses TRN-12 food manager; E10 uses TRN-21 annual Alzheimer update; E11 uses TRN-07 course evidence; E12 uses applicable approved training/orientation. W06/A11 provide file context. Latest retired requirements do not revive older approval.

E02 assignment, E03 undefined 90-day review, E09 exact two-hour medication update, E13 AHCA transmission, and E14 manager update remain unknown. E04 disease statement and E05 PPD referral/result retain medical context without asserting that referral equals result or resolving TRN-25/26 classification conflicts. E07 screening packet documents do not prove final clearance/expiry. D13 daily screening differs from a certificate; D15/A10 calendar scope, W02/A11 roster delivery and LMH/cart training questions remain unresolved. No draft policy or schedule is activated.

## Authority and history

Medical data requires both current HFO medical scope and the native medical grant, including sensitive codes labeled training. Filtering occurs before hashes, dates and history. The native invoker reads and final authority checks remain operative after waits. Missing hire date remains unknown.

Migration 368 adds only HFO source snapshots and request history. SQL owns actor, time, source hashes and transition order. Unchanged refresh/replay does not append; A → B → A preserves all three transitions. Medical history is hidden after medical access loss. No native HR/clinical trigger or write path is added.

## Verification and delivery state

- Parent full suite: 636 files, 4,613 tests passed, two existing skips. Two added edge regressions were separately included in the final 12-test backend run.
- Native primary, expiry, malicious sequence override, medical authority/history, and two actual concurrent wait cases passed. Supported typecheck and lint passed.
- First mandatory gate failed an inherited dietary probe's late fault-trigger DDL racing autovacuum. Exact server evidence is retained. The probe now takes its required audit-table lock before fixture writes; audit-failure assertions are unchanged.
- Final mandatory gate passed all 11 required checks: 371 migrations / 51 SQL probes, build, lint, design and axe. Exact result: `col156-evidence/strict-gate-final.json`; final source matches `gate-source-manifest.json` captured before that run.

Authenticated staging transport/browser proof is pending. Guarded runners are prepared for fresh synthetic native personnel/medical upload, attach, review, download and revocation tests. No source-only result claims hosted, production, provider or staff acceptance. Production release obligations and unresolved policy decisions remain separately routed.
