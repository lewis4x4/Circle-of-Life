# Guarded COL-140 staging profile proof

Prepared only. No script creation starts a runner or changes staging.

Before any hosted step, parent must commit all source and these runner scripts, provide a clean exact-source gate and independent review, then run the local-only source manifest command:

```
python3 docs/facility-operations/col140-evidence/hosted-profile/guarded.py manifest
```

`source-manifest.json` covers runtime src/supabase/scripts, root application config/package files and every new hosted-profile runner. It discovers tracked and untracked source; readiness refuses any runtime/runner file that remains uncommitted or differs from its recorded hash.

Parent readiness JSON shape:

```
{
  "target": "iwcnajanvjvynolltflw",
  "sourceSha": "<committed HEAD>",
  "checkout": "/Users/brianlewis/Circle of Life/Haven Homewood Profile",
  "appUrl": "http://127.0.0.1:4340",
  "source_manifest": {"path": "<absolute source-manifest.json>", "sha256": "<hash>"},
  "gate": {"path": "<absolute gate JSON>", "sha256": "<hash>", "sourceSha": "<same HEAD>"},
  "review": {"path": "<absolute review JSON>", "sha256": "<hash>"}
}
```

Gate must contain PASS and all required checks passed. Review must contain the same sourceSha, independent:true and result `[PROOF PASS — CLEAN]`.

Execution order after readiness:

1. `apply-staging.py inspect --ready <path>` verifies target and ledger without changing schema.
2. `apply-staging.py apply --ready <path>` applies only366 and its ledger row in one locked transaction; no historical seed replay. Existing366 must match the reviewed full ledger statement exactly.
3. Start `fixture-proof.py serve --ready <path>` on4340 with explicit staging environment.
4. `fixture-proof.py setup --ready <path>` creates fresh actor/entity/two sites, grants Site A only, logs in with the current hook, and creates an unapproved synthetic operator draft only on a catalog component with no existing requirement. No existing draft is overwritten; if no untouched component exists, stop for a safe alternative.
5. `fixture-proof.py exercise --ready <path>` reads persisted91-source/110-component coverage, prepares missing drafts, checks zero-new retry and bytewise hashes of all pre-existing central/site rows. No rule is published; unknowns remain.
6. `node browser-proof.mjs <ready-path>` verifies authenticated profile, actual safe repeat action, screenshots and axe at1440/375.
7. `fixture-proof.py deny-cleanup --ready <path>` verifies cross-site/revoked denial, bans/deactivates the exact fresh actor and retires its sites/entity. Retain required draft/audit history. Stop only the owned4340 app and verify the listener closed.

Use fresh `~/.config/haven-staging/col140-profile-fixture.json`, mode0600. Never reactivate retired actors. Runtime/runner source drift invalidates readiness; do not silently refresh the guard or waive a failure. Native55519 is unrelated and is not used by these scripts.
