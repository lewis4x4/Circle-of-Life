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
| 9 | P1 | done | `dietary-orders-cap-50` | Named the 50-row diet-order hub fetch. CSV stays a separate 500-row export. |
| 10 | P1 | done | `standup-eastern-dates` | Standup today + Monday week window use the Eastern calendar, not a UTC date slice. |
| 11 | P1 | done | `executive-benchmarks-stub-copy` | Cross-operator card names the missing peer feed. No “stub” copy. |
| 12 | P1 | done | `rounding-live-resident-fallback` | Live board names a missing resident join instead of inventing “Resident.” |
| 13 | P1 | done | `flagship-raw-query-errors` | Flagship hub loads use `formatLiveDataLoadError` instead of PostgREST text. |
| 14 | P1 | skipped | `facility-admin-login-smoke` | No signed-in production session in this agent. Owner must re-run facility-admin + family login. |

**Done when:** every row is `done` or `skipped` with a one-line reason.
