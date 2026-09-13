# COL-221 billing shortcut contrast

The one application change removes the opacity suffix from `text-muted-foreground/80` on the invoice hero shortcut helper text. Font size, layout and event handlers are unchanged.

## Criterion evidence

Fresh authenticated staging-backed `/admin/billing/invoices` captures at1440/375 in both supported themes reproduce insufficient contrast before the change:3.496:1 light and4.240:1 dark. After the change, the same computed compositing measurement reports5.249:1 light and6.131:1 dark. All four after cases have zero axe, console or HTTP failures. The shortcut's exact bounds/font size/line height and observed search focus, export download and refresh event behavior match the baseline. Parent inspected all four settled before and four after screenshots; visual verdict98/pass.

Source is bound by before/after manifests at base9f23f382 plus the exact one-line working diff. The manifests include3156 runtime/runner files and differ only in that component. Independent review verified the source binding. Full manifests are retained privately; reports record their exact hashes. Five existing billing tests, source typecheck, targeted ESLint and diff check pass. Final strict UI gate `2026-09-13T05-56-47-314Z-COL-221-BILLING-CONTRAST-FINAL.json` passes all11 mandatory checks, including required native replay368 migrations/48 probes. The initial optional-PG result and interrupted configuration attempt are retained and superseded; neither was an application failure.

## Honest limitations and discovery

Initial screenshots captured loading placeholders and an open mobile theme menu. They are retained in `col221-evidence/initial-before`; the final harness waits for the actual fresh-site200 invoice read and settled UI, and closes the menu through Escape. No product change was made to achieve that settled capture.

The advertised R shortcut produces zero refresh events on the invoices layout while the visible Refresh button produces one. This existing behavior was preserved and filed separately as COL-227. The contrast change does not repair it. COL-224 separately tracks the historical hydration observation; no causal claim is made here.

## Environment and recovery

Source checkout uses migrations through365; authorized staging `iwcnajanvjvynolltflw` includes independently reviewed additive366. No migration, invoice, policy or production write occurred. The fixture's exact actor was banned/deactivated, grants revoked, site/entity retired and owned4341 listener closed. Credentials remain private; no retired fixture is reused.

Main integration and production release remain pending. Production publishing is held for the separately recorded compatible schema/app/Edge transition. Revert only the one-line presentation change if required; retain proof/history. No staff or operating acceptance is claimed.
