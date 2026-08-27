# Training-week closeout queue

**Orchestrator:** [training-week-orchestrator.md](../../agents/playbooks/training-week-orchestrator.md)  
**Hunt board:** Cursor canvas `training-week-hunt` (26 Aug 2026).  
**Do not re-open A5.**

| # | Pri | Status | Segment id | Item |
|---|-----|--------|------------|------|
| 0 | chore | done | `track-a-a5-closed` | Ship A5 closeout docs + orchestrator queue. Do not re-open A5. |
| 1 | P0 | done | `rounding-escalate-further-404` | Removed dead **Escalate further** link. Start review / Resolve / Dismiss stay. |
| 2 | P1 | done | `flagship-v2-landing-honesty` | V2 stays on. Mounted rounding + executive hub navs on rewritten landings. Residents subtitle names the current roster. |
| 3 | P1 | done | `executive-role-gate-copy` | Facility admin Command nav goes to Standup; overview/reports hidden. Role gate unchanged. |
| 4 | P1 | done | `family-portal-create-stubs` | Removed hub CTAs. Leftover create URLs redirect to the Family Connections hub. |
| 5 | P1 | done | `family-messages-short-url` | `/family-messages` now redirects to `/admin/family-messages`. |
| 6 | P1 | done | `billing-settings-dead-end` | Dropped “Pilot placeholder.” Page names that invoice scheduling is not live and keeps overview / opening balance / rates links. |
| 7 | P1 | done | `billing-invoice-cap-200` | Named the 200-row invoice hub fetch. CSV uses the same loaded cohort. |
| 8 | P1 | done | `billing-collections-cap-200` | Named the 200-row activity log. Load errors use `formatLiveDataLoadError`. |
| 9 | P1 | **current** | `dietary-orders-cap-50` | Name the diet-order hub load ceiling (snack pass already names its cap). |
| 10 | P1 | queued | `standup-eastern-dates` | `toIsoDate()` UTC slice on executive standup. |
| 11 | P1 | queued | `executive-benchmarks-stub-copy` | Benchmarks page calls itself a stub. |
| 12 | P1 | queued | `rounding-live-resident-fallback` | Live board invents “Resident” when the name is missing. |
| 13 | P1 | queued | `flagship-raw-query-errors` | Billing / dietary / rounding / family notes / executive show PostgREST text. Use `formatLiveDataLoadError`. |
| 14 | P1 | queued (ops) | `facility-admin-login-smoke` | Re-run production facility-admin + family login. Code only if the timeout is a product bug. |

**Done when:** every row is `done` or `skipped` with a one-line reason.
