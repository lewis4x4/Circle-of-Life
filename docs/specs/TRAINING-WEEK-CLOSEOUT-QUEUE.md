# Training-week closeout queue

**Orchestrator:** [training-week-orchestrator.md](../../agents/playbooks/training-week-orchestrator.md)  
**Hunt board:** Cursor canvas `training-week-hunt` (26 Aug 2026).  
**Do not re-open A5.**

| # | Pri | Status | Segment id | Item |
|---|-----|--------|------------|------|
| 0 | chore | done | `track-a-a5-closed` | Ship A5 closeout docs + orchestrator queue. Do not re-open A5. |
| 1 | P0 | done | `rounding-escalate-further-404` | Removed dead **Escalate further** link. Start review / Resolve / Dismiss stay. |
| 2 | P1 | **current** | `flagship-v2-landing-honesty` | V2 rewrites `/admin/executive`, `/standup`, `/rounding`, `/residents` by default. Decide: teach V2, name the landing, or kill-switch — do not silently flip production without owner. |
| 3 | P1 | queued | `executive-role-gate-copy` | `facility_admin` is redirected off Executive overview (standup allowed). Name it in nav/copy so training does not look like a 403. |
| 4 | P1 | queued | `family-portal-create-stubs` | Hide or rewrite + Schedule conference / + Add consent (stub “not wired”). |
| 5 | P1 | queued | `family-messages-short-url` | `/family-messages` 404s; page lives at `/admin/family-messages`. Redirect or drop the short path from shell. |
| 6 | P1 | queued | `billing-settings-dead-end` | `/admin/billing/settings` is a named placeholder linked from the ledger. |
| 7 | P1 | queued | `billing-invoice-cap-200` | Name the invoice hub 200-row fetch ceiling (CSV uses the same cohort). |
| 8 | P1 | queued | `billing-collections-cap-200` | Name collections 200-row log; stop dumping `error.message`. |
| 9 | P1 | queued | `dietary-orders-cap-50` | Name the diet-order hub load ceiling (snack pass already names its cap). |
| 10 | P1 | queued | `standup-eastern-dates` | `toIsoDate()` UTC slice on executive standup. |
| 11 | P1 | queued | `executive-benchmarks-stub-copy` | Benchmarks page calls itself a stub. |
| 12 | P1 | queued | `rounding-live-resident-fallback` | Live board invents “Resident” when the name is missing. |
| 13 | P1 | queued | `flagship-raw-query-errors` | Billing / dietary / rounding / family notes / executive show PostgREST text. Use `formatLiveDataLoadError`. |
| 14 | P1 | queued (ops) | `facility-admin-login-smoke` | Re-run production facility-admin + family login. Code only if the timeout is a product bug. |

**Done when:** every row is `done` or `skipped` with a one-line reason.
