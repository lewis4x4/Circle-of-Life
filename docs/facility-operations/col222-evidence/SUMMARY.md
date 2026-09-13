# COL-222 authenticated staging UI proof

Source HEAD: `cf8b97b8da8924c48ec7ac7c624feec392bf9404` with owned source diff SHA-256 `50505c622d5ba62c0def16469f61a34d37158f382e55db13b4a1a65f0c8454e7`. Per-file hashes are in `ui-report.json`; source remained unchanged throughout proof.

Application: local Next.js development server `http://127.0.0.1:4322`, explicitly configured against verified staging `iwcnajanvjvynolltflw`, schema365. This is authenticated staging-backed local UI proof, not a production deployment.

Fresh synthetic owner actor and site were created for this run; no prior banned actors were reused. Published an explicit synthetic requirement with `needs_confirmation` schedule, created two manual occurrences through actual RPCs and recorded one performance for History. No real resident, employee or operational data was created.

## Results

Today and History at1440px and375px all PASS: actual workspace HTTP200, expected actor/site, rendered synthetic task, zero axe violations, all six scoped landmark violations absent, one main and no nested main/banner/contentinfo. Screenshots: `today-1440.png`, `history-1440.png`, `today-375.png`, `history-375.png`.

Keyboard evidence: initial Tab reached the existing `#main-content` skip link; Enter navigated the matching hash; next Tab continued within that target. The existing target is a non-focusable root div: after Enter activeElement is BODY and next focus is the Haven link. This proves preserved navigation/sequence, not direct focus on Site work or bypass of every application navigation control. Root layout was unchanged.

Standalone PageShell semantics are separately covered by component tests (main id `page-shell-main`, banner and contentinfo remain). Browser proof does not replace parent strict/full gates or independent review.

## Retained failed setup attempt

Initial fixture configuration sent `schedule_status=unknown`; PostgreSQL rejected it with HTTP400 /22023 /Facility requirement draft contains an invalid value. Verified zero facility-requirement rows for the exact new activity before retry, cleared only its failed pending checkpoint, and used the existing valid enum `needs_confirmation`. No application code or policy was changed.

## Cleanup

`cleanup.json` verifies actor inactive and banned, zero live grants, exact synthetic site retired, and port4322 closed. Historical fixture records remain. Credentials/session state are private under `~/.config/haven-staging/col222-fixture.json`; retired actors must never be reactivated. No temporary screenshot or source artifact was deleted.
