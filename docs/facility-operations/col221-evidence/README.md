# COL-221 guarded before/after billing proof

Preparation only until parent reviews readiness. No migration or invoice mutation.

Run local `python3 -B guard.py manifest --phase before` from this directory or use its repository path. Parent readiness JSON must contain target `iwcnajanvjvynolltflw`, appUrl `http://127.0.0.1:4341`, checkout absolute path, phase `before` or `after`, approved_by_parent true, scope `COL-221 synthetic fixture and browser proof`, and source_manifest `{path, sha256}`. Source manifest includes new runner/runtime files. Rebind the after manifest only after the source agent's reviewed class edit; never bypass a mismatch.

With reviewed before readiness: `PYTHONDONTWRITEBYTECODE=1 python3 fixture.py setup --ready <path>` creates only fresh synthetic actor/entity/site with explicit site grant; `fixture.py serve --ready <path>` starts4341. Stage365 baseline plus independently reviewed additive366 is required exactly; no schema writes occur.

`node browser-proof.mjs <before-ready>` captures light/dark1440/375, composited computed contrast, axe/screenshots, slash search focus, E read-only CSV, R event behavior and refresh-button event behavior. R may already be inert on invoices; record it as a separate candidate, not a COL221 fix.

After parent baseline/visual verdict release and the one-class edit, bind after readiness and run the same browser script. It requires contrast>=4.5, unchanged shortcut geometry/fonts and keyboard behavior; no new axe/page/read errors. Keep failed attempts.

Finish with `fixture.py cleanup --ready <after-ready>` and independently verify actor banned/inactive, grants revoked, exact entity/site retired; stop only owned4341 process. Preserve audit/required fixture provenance. Never reuse retired actors or existing canonical facilities. `source-manifest` files remain untracked/private, not product evidence commits.
