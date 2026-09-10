# COL-135 — versioned facility applicability, evidence rules and local procedures

**Implemented, independently reviewed with all actionable findings remediated, and verified locally on the feature branch; see the evidence for the gate artifact.** No hosted migration, deployment, schedule confirmation, requirement approval for any facility, or operating acceptance occurred. Nothing was merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Applicability`; branch `codex/hfo-col135-applicability`, stacked on COL-133 `476f02d1` (catalog 336, current authority 337, gate fixes and review remediations) over origin/main `fad17dcc`. Stacking keeps the HFO migration chain contiguous (336, 337, 338) and lets site-scoped policies and commands use the explicit current-grant helpers; it means COL-135 integrates after COL-133 in the recorded Finance-first order. COL-132 closed as Done on September 10; COL-133 stays In Review awaiting integration.

## Delivered

- Migration `338_hfo_requirement_versions.sql`: `operation_requirement_versions` (central, per activity) and `operation_facility_requirements` (per activity and site) with a draft → published lifecycle where a published row governs only inside its effective window (published is not in force), immutable published rows, strict rule-shape validators for typed inputs, evidence rules and roles, subset rule for local recorder roles, reason and source requirements, independent schedule-confirmation state (draftable with a rule, not publishable until the COL-137 evaluator defines rule shapes), in-force resolvers, immutable occurrence snapshot links on `operation_task_instances` (window, activity and site/central agreement checks; version-backed template-less occurrences carry the version's activity), no direct write path for any client or the service identity, audit and truncate guards, RLS and the invoker view `operation_activity_requirements` (exposes source dispositions, resolving the COL-132 review's deferred finding).
- Six session-only commands (save draft, preview, publish; central and site) with before-and-after authority checks, server-derived versions, approver and timestamps.
- Routes under `/api/admin/operations/requirements` and `/api/admin/operations/facility-requirements` (list, save draft, preview, publish) through the session client with bounded error mapping. No administrator screen is claimed.
- Canonical contract: [applicability](../specs/27-facility-operations-applicability.md). Exact file hashes: [implementation manifest](col135-evidence/implementation-manifest.json).

## Boundaries kept

`needs_confirmation` is an explicit published state, not a default rule; new drafts start from the current published row. No schedule is confirmed here: `schedule_status` defaults to `needs_confirmation` and `confirmed` needs a rule object the COL-137 evaluator will interpret. Q01, Q02, Q07, Q08 and Q10 stay unapproved. Local rules constrain and never widen the central rule or COL-133 authority. Recording actual work remains available with or without a version. No template is bound to a catalog activity; the catalog's approved-bind setting is still unused.

## Evidence

Focused suite (see verification for the exact count), typecheck, lint and native replay of 341 migration files (numbered through 338, plus three retained timestamp files) with 22 probes including the new `review_hfo_applicability.sql` PASS. Two independent reviews found no blocker; the six SQL and three TypeScript should-fix items were all remediated before commit, see [review](col135-evidence/independent-review.json). Strict gate artifact: [verification](col135-evidence/verification.json). Local PostgreSQL uses Supabase stubs and synthetic fixtures; hosted Auth, browser and staff acceptance are not established.

## Resume and rollback

Next dependency-ready issue: COL-137 / HFO-03 (one recurrence and due-date evaluator) depends on this segment; COL-139 also needs COL-133. Do not start either here. Before deployment, rollback is reverting this segment. After application, retain the additive tables and history and use a reviewed forward repair with the requirement routes disabled; never edit or delete a published version to reopen a rule. Mission alignment: **PASS**; hosted and operating readiness: **RISK**.
