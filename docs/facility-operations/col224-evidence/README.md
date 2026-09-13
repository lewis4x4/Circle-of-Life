# COL-224 guarded browser proof

Prepare only until parent readiness review. Scripts use exact source/runner hashes, fresh management identity, private0600 staging config and NoRedirect transport. No invoice, rule or schema mutations; fresh actor/entity/site fixture only. Staging ledger must exactly match local migrations through366, including known timestamp versions.

After source agent's fix is stable, run local-only `python3 -B guard.py manifest --phase proof`. Parent readiness JSON needs target `iwcnajanvjvynolltflw`, appUrl `http://127.0.0.1:4342`, exact checkout, phase `proof`, approved_by_parent true, scope `COL-224 synthetic fixture and browser proof`, source_manifest `{path,sha256}`. Source snapshot includes newly added files. No drift waivers.

With readiness: `python3 -B fixture.py setup --ready <path>`, then `fixture.py serve --ready <path>` and `node browser-proof.mjs <path>`. Capture authenticated375px initial/reload plus1440px initial/reload, a populated clock after hydration, actual manual Refresh event and valid clock display, full untruncated pageerror message/stack/cause and console errors, settled empty synthetic billing scope, axe/screenshots. Browser time remains real; no clock freeze or error suppression. A formatted minute need not visibly change during a short successful refresh.

The deterministic current-component minute-boundary regression is separate local evidence. `original-error-reference.json` preserves the historical collector's exact stored truncated error and original report hash; it cannot prove the historical event's cause or reconstruct its missing component/stack data.

Finish exact fixture cleanup under the same readiness and stop owned4342. Assert ban/inactive/0grants/site+entity retirement before declaring cleaned. Preserve records/provenance. Use `-B`/`PYTHONDONTWRITEBYTECODE=1`; no source bytecode artifacts. Manifests stay untracked/private.
