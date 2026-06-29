<!-- Auto-generated data-fetch performance audit. 2026-05-28 -->
---

# Page Data-Fetch Performance — Remediation Report

## 1. TL;DR — Why every data page feels slow

Three root causes, in plain English:

1. **Nothing is remembered between pages.** The app fetches data in the browser *after* the page loads, and there is no shared cache (no React Query / SWR). So every time you click into a page — even one you saw 5 seconds ago, even hitting Back — it throws away what it had and re-runs all its database calls from a blank spinner. This is the single biggest reason navigation feels slow.

2. **Every page logs you in again before it shows data.** On each navigation the app makes a *network* call to the auth server to re-verify who you are (`getUser()`), plus 1–2 profile/org lookups — and it does this in the app-wide shell, again in the page, and again in the API route. That's the same identity check, paid 2–3 times, *before* the real data even starts loading. (Notably, the middleware was already fixed to avoid this — but the client and API layers reintroduce it.)

3. **The data calls run one-at-a-time instead of together.** Inside each page, queries are chained (`await` A, then B, then C…). Heavy pages do 5–17 sequential round-trips that mostly *don't* depend on each other, so the spinner time is the sum of all of them instead of the slowest one.

Everything else (over-fetching with `select('*')`, missing DB indexes, big JS bundles) makes it worse, but fixing the three above is where 80% of the perceived speed-up lives.

---

## 2. TOP FIXES (the 80/20)

| Rank | Fix | Why slow now | Impact on perceived nav speed | Effort | Files / Areas |
|---|---|---|---|---|---|
| 1 | **Add a shared client cache (React Query/SWR) at the `(admin)` layout; migrate the ~37 heaviest pages to `useQuery` with stable keys + `staleTime` 30–60s** | 195+ client pages re-fetch on every mount with zero dedupe/reuse; Back/forward and tab-switches re-run every query from a cold spinner | **Very high** — repeat navigations & Back become near-instant cache hits; in-flight duplicates collapse | Large | `src/lib/supabase/client.ts`, `src/app/(admin)/layout.tsx`, `admin/admissions`, `incidents/[id]`, `referrals`, residents pages |
| 2 | **Make `HavenAuthProvider` the single source of truth for identity; delete per-page `auth.getUser()` and per-page `load*RoleContext()` calls — read `{user, appRole, organizationId}` from `useHavenAuth()`** | 77 pages + the role-context loaders (`load-finance-context` et al.) re-run a *network* `getUser()` + `user_profiles` SELECT the provider already did, serialized before data | **Very high** — removes 1–2 auth-server round-trips (~300–1500ms each) from the front of most navigations | Medium | `src/contexts/haven-auth-context.tsx`, `src/lib/finance/load-finance-context.ts` (+risk/reports/operations/rounding), `src/hooks/useAuth.ts` |
| 3 | **Fix the auth bootstrap itself: drop `getUser()` for `getSession()` in the provider, and collapse the two serial `user_profiles` → `organizations` queries into one join** | The app-shell gates first paint on getUser (network) + 2 *sequential* DB queries; `onAuthStateChange` re-runs the whole chain on every token refresh | **High** — every cold navigation/refresh into the shell loses a full auth RTT + one DB round-trip; shell renders sooner | Medium | `src/contexts/haven-auth-context.tsx`, `src/components/layout/AppShell.tsx`, `src/lib/supabase/middleware.ts` (reference) |
| 4 | **Parallelize page waterfalls: `Promise.all` independent reads; use PostgREST nested selects / one RPC for multi-table pages** | 129 client pages run ≥4 serial awaits (incidents/[id] ~10–14, admissions/new 14, residents/[id] deep chain); each is a full browser→Supabase RTT | **High** — collapses 5–17 serial RTTs to ~2–3 on the worst pages | Medium | `incidents/[id]/page.tsx`, `residents/[id]` overview loader, `admissions/new`, `payroll/[id]`, `finance/journal-entries/[id]` |
| 5 | **Narrow the middleware matcher to the 7 shells; exclude `/api/*` and static assets** | The catch-all matcher builds a Supabase client + decodes/JSON-parses chunked auth cookies on *every* API call, RSC navigation, and `.css/.js/.json` fetch | **Medium-High** — removes per-request client construction + cookie decode from every API call and asset on a data-heavy page | Small | `src/proxy.ts` (matcher + short-circuit), `src/lib/supabase/middleware.ts`, `src/lib/auth/*-shell.ts` |
| 6 | **Move the hottest list/detail pages to Server Components (fetch via `src/lib/supabase/server.ts`, pass props to a thin client island)** — adopt the existing `V2ListPage`/`CeoDashboardPageClient` pattern fleet-wide | 239 client pages fetch after hydration: download JS → hydrate → auth → query → render, so users always see an empty shell first; only 19 pages use the server client | **Medium-High** — data arrives in first paint; also lets pages drop the browser supabase + chart bundles | Large | `src/lib/supabase/server.ts`, `src/components/v2/V2ListPage.tsx`, `CeoDashboardPageClient.tsx`, admissions/incidents/exec pages |
| 7 | **Bound + project list queries: replace `select('*')` (95 occurrences) with explicit columns, add `.limit()/.range()`; push client-side SUM/bucket loops into SQL aggregates/RPC** | Insurance/vendor/billing lists pull whole tables + every column to the browser and aggregate in JS (vendors/spend, ar-aging, TCoR); inflates every uncached fetch | **Medium** — smaller payloads, less serialization, enables covering indexes; compounds with #1 | Small–Medium | `insurance/claims|renewals|coi|loss-runs/page.tsx`, `vendors/contracts|spend/page.tsx`, `src/lib/insurance/compute-tcor.ts`, `billing/ar-aging/page.tsx` |

---

## 3. Quick Wins vs Structural

### Quick wins (< 1 day each)
- **Matcher narrowing in `src/proxy.ts`** (Fix #5) — scope to the 7 shells, exclude `/api/*` and `\.(css|js|mjs|json|txt|map|woff2?|ttf|ico)$`; add a `needsShell` short-circuit before `updateSession()`. Small, high blast radius.
- **Swap `getUser()` → `getSession()`** in `HavenAuthProvider` and join the profile+org query (the network-vs-local half of Fix #3). One file, removes a full auth RTT.
- **Add `.limit()` + explicit columns** to the unbounded `select('*')` insurance/vendor list pages (part of Fix #7). Pure query edits, no architecture change. Pattern already exists (`vendors/payments` uses `.limit(50)`).
- **`Promise.all` the obvious independent pairs** on the top offenders (resident-name-then-data, care-plan resident+plans) — mechanical, per-page (subset of Fix #4).
- **Kill the `auth.users` full-table scan** on the users list route: drop `adminGetAuthSnapshotsByIds` and trust `user_profiles.last_login_at` (already selected). `src/app/api/admin/users/route.ts:192`. O(total_users) → O(0).
- **DB index/predicate fixes** (small, high-value): the rounding-insights job filters `incidents.created_at`, `resident_observation_logs.observed_at`, `assessments.created_at` but the indexes are on *other* timestamp columns. Either change the filter to the indexed column (`occurred_at`/`entered_at`/`assessment_date`) or add the matching partial index. `src/app/api/admin/rounding/insights/run/route.ts`.
- **Drop redundant per-`[facilityId]` re-fetch**: the access check already proves the facility exists/scope — remove the second `facilities` SELECT or fold it into the data query's WHERE. `src/app/api/admin/facilities/[facilityId]/*`.
- **Memoize the service-role client** as a module-level singleton (it's cookie-free); stop building 3–4 clients per AI/report request. `src/lib/supabase/service-role.ts`.

### Structural (multi-day → multi-week)
- **Shared cache layer (Fix #1)** — `QueryClientProvider` + migrate pages to `useQuery`. This is the headline structural change and the highest ROI; do it first among the structural items.
- **Identity consolidation (Fix #2)** — refactor `load*RoleContext` to accept the resolved context (or read JWT claims via `getAppRoleFromClaims`) instead of re-querying; have `useAuth` read the provider.
- **Server-Component migration (Fix #6)** — convert hot list/detail routes to RSC fetch-then-props; optionally hydrate React Query from server data so the first interaction stays warm.
- **N+1 / set-based authorization** — replace the per-facility access loop in `rounding/plans` with one `listActorAccessibleFacilityIds` set check or `.in('facility_id', accessibleIds)`.
- **Server-side aggregation RPCs/views** — TCoR and per-vendor spend become single aggregate responses instead of whole-table transfers + JS reduces.
- **Per-request RLS tax** — push `app_role`/`organization_id` into the JWT claims so the STABLE `SECURITY DEFINER` helpers stop re-selecting `user_profiles` per query; biggest payoff once round-trips-per-page drop (Fix #1/#4).
- **Bundle/hydration** — dynamic-import `recharts` chart components and the heaviest `>1,000`-line client pages (admissions/new 2,300 lines, incidents/[id] 1,504); delete dead `AdminShell.tsx` (843 lines, 104 icons, zero route refs).

---

## 4. Prod measurement checklist — queries to `EXPLAIN ANALYZE`

Run each as the authenticated role where RLS applies (`SET request.jwt.claims = '{"sub":"<auth_uid>"}'`) and prefer `EXPLAIN (ANALYZE, BUFFERS)`.

| # | Table / columns | What to check | Call site |
|---|---|---|---|
| 1 | **incidents** — `resident_id = ANY($1)`, `created_at >= now()-'7 days'`, `deleted_at IS NULL` | Index/predicate mismatch: indexes are on `occurred_at`. Compare same query on `occurred_at` (uses `idx_incidents_resident`) vs `created_at` (heap filter). Decide column or add `(resident_id, created_at DESC) WHERE deleted_at IS NULL` | `src/app/api/admin/rounding/insights/run/route.ts:198-203` |
| 2 | **resident_observation_logs** — `resident_id = ANY($1)`, `observed_at >= now()-'7 days'`, `deleted_at IS NULL` | Indexes are on `entered_at` only; high-write table. Confirm scan width; add `(resident_id, observed_at DESC) WHERE deleted_at IS NULL` | `…/insights/run/route.ts:193-197` |
| 3 | **assessments** — `resident_id = ANY($1)`, `created_at >= now()-'7 days'`, `deleted_at IS NULL` | `created_at` unindexed; `assessment_date` is. Switch filter or add `(resident_id, created_at DESC) WHERE deleted_at IS NULL` | `…/insights/run/route.ts:219-223` |
| 4 | **emar_records** — `facility_id=$1, is_prn=true, status IN ('given','self_administered'), actual_time IS NOT NULL, deleted_at IS NULL` | Partial index `idx_emar_status` is `WHERE status='scheduled'` → ineligible here. Test broadening the partial or adding a PRN-given partial index. Runs on every caregiver shift load | `src/lib/caregiver/shift-brief.ts:97-105` |
| 5 | **risk_score_snapshots** — `organization_id=$1, facility_id = ANY($2), deleted_at IS NULL ORDER BY computed_at DESC` (no limit) | Unbounded sort across all page facilities. Compare to `DISTINCT ON (facility_id) … ORDER BY facility_id, computed_at DESC`; want index `(facility_id, computed_at DESC)` | `src/app/api/admin/facilities/route.ts:165-172` |
| 6 | **vendor_payments** — `SELECT vendor_id, sum(amount_cents) … WHERE organization_id=$1 AND deleted_at IS NULL GROUP BY vendor_id` | Validate the SQL-aggregate replacement for the client-side JS sum; index `(organization_id, deleted_at)` covering `vendor_id, amount_cents` | `src/app/(admin)/vendors/spend/page.tsx:30-53` |
| 7 | **insurance_claims** — `organization_id=$1 AND deleted_at IS NULL ORDER BY date_of_loss DESC` | Currently `select('*')` unbounded list. Confirm index `(organization_id, deleted_at, date_of_loss DESC)` and effect of column projection + `.limit()` | `src/app/(admin)/insurance/claims/page.tsx:34-39` |
| 8 | **user_facility_access** — `(user_id, facility_id, organization_id) WHERE revoked_at IS NULL` (`maybeSingle`) | Called per-facility in an N+1 loop. Verify composite index `(user_id, facility_id)`; also `facilities(id, organization_id)` for owner/org_admin branch | `src/lib/supabase/service-role-facility-access.ts:23-30` (from `rounding/plans/route.ts:64`) |
| 9 | **user_profiles + organizations** — `SELECT app_role, organization_id, full_name, avatar_url, organizations(name) FROM user_profiles WHERE id=$1` | Confirm PK lookup on `user_profiles.id` and FK index to `organizations.id`; validates the join that collapses the two serial auth queries | `src/contexts/haven-auth-context.tsx:66,86` |
| 10 | **residents** (RLS helpers) — `WHERE organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids())` | Count how many times `user_profiles`/`facilities` sub-scans appear and their cumulative time — quantifies the per-request RLS tax | any RLS read via `src/lib/supabase/server.ts` |
| 11 | **incident_followups / resident_watch_instances / resident_observation_tasks / resident_observation_escalations** — by `incident_id` / `triggered_by_id` / `watch_instance_id` / `task_id` | Verify FK indexes exist on each before parallelizing the incident-detail waterfall | `src/app/(admin)/incidents/[id]/page.tsx:1143,1192,1211,1254` |
| 12 | **facilities** — `name ILIKE '%term%' OR city ILIKE '%term%'` | Confirm Seq Scan today; re-EXPLAIN after `pg_trgm` GIN indexes. Low priority but a reused search template | `src/app/api/admin/facilities/route.ts:108-110` |

---

## 5. Suggested rollout order

**Phase 0 — Quick wins, ship this week (low risk, immediate relief)**
1. Narrow `proxy.ts` matcher + exclude `/api` and static assets (Fix #5).
2. Provider `getUser()` → `getSession()` + profile/org join (Fix #3, quick half).
3. Kill the `auth.users` full-table scan on the users route; remove redundant `[facilityId]` re-fetch; memoize the service-role client.
4. Land the index/predicate fixes for #1–#5 in the EXPLAIN table (after confirming plans on prod).
5. `.limit()` + explicit columns on the unbounded insurance/vendor lists.

**Phase 1 — Highest-ROI structural change: the cache layer (Fix #1)**
6. Add `QueryClientProvider` at the `(admin)` layout. Migrate the ~37 heaviest pages first (admissions, incidents/[id], referrals, residents profile, reports) to `useQuery` with stable keys + `staleTime`. Add route-level `loading.tsx` so navigation streams a shell instead of a full-page spinner.

**Phase 2 — Identity consolidation + waterfall collapse (Fixes #2 & #4)**
7. Refactor `load*RoleContext` and `useAuth` to consume `useHavenAuth()` / JWT claims; delete the 77 redundant per-page `getUser()` calls.
8. `Promise.all` + nested-select / RPC the top waterfall pages (incidents/[id], residents overview, finance/journal-entries detail).

**Phase 3 — Server-Component migration + DB hardening (Fixes #6 & #7 deep)**
9. Move hot list/detail routes to RSC fetch-then-props (extend the `V2ListPage` pattern); optionally hydrate React Query from server data.
10. Server-side aggregation RPCs (TCoR, vendor spend); set-based authorization in `rounding/plans`; push role/org into JWT claims to shed the per-request RLS tax.
11. Bundle work: dynamic-import `recharts` + the >1,000-line client monoliths; delete dead `AdminShell.tsx`.

**Re-measure after Phase 1.** The cache layer alone should change the *feel* of navigation more than anything else; Phases 0 and 2 remove the fixed auth/round-trip cost that sits in front of every page, and Phase 3 reduces the cost of the fetches that do run.

---

# Appendix A — Prod ground-truth (measured directly against Haven prod, 2026-05-28)

These numbers were captured live via the us-west-2 session pooler and **reframe the priorities**: the database is *not* the bottleneck.

## Table sizes (largest first)
| Table | Est. rows | Size |
|---|---|---|
| audit_log | 10,364 | 15 MB |
| audit_log_entries | 1,545 | 592 kB |
| resident_safety_scores | 365 | 656 kB |
| staff | 36 | 160 kB |
| residents | 34 | 240 kB |
| invoices / payments / incidents | < 34 each | small |

Key tables are already well-indexed: residents (8 indexes), invoices (8), incidents (9), staff (8), payments (6), care_plans (5), diet_orders (6).

## EXPLAIN ANALYZE — real DB execution time
| Query | DB exec time |
|---|---|
| residents list (LIMIT 50) | **3.5 ms** |
| invoices list | **1.8 ms** |
| payments list | **0.7 ms** |
| incidents list | **0.4 ms** |
| audit_log recent (LIMIT 100, biggest table) | 60 ms |
| audit_log count(*) | 226 ms (full count) |

## Implication for the fixes above
- **De-prioritize the DB-index work (report §4 checklist + most db-index candidates).** On 34-row tables, an index/predicate mismatch is still sub-millisecond. These matter only as data grows (revisit when any table passes ~50k rows), or where a pattern is **O(total)** regardless of filters — e.g. the `auth.users` full scan and `audit_log count(*)`.
- **The perceived slowness is round-trip count × network latency, not query time.** A page doing 2–3 serial `getUser()` auth calls (~100–300 ms each) + 5–17 serial data round-trips pays ~1–3 s of *network* time while the DB does ~4 ms of work.
- Therefore the ranked fixes that matter for *felt* speed are, in order: **#5 proxy matcher, #2/#3 auth round-trips, #1 client cache, #4 waterfalls** — all round-trip reducers. Query tuning is a distant secondary.

---

# Appendix B — Raw candidate queries (26) from the diagnostic agents
For traceability. Most are low-priority per Appendix A; included so nothing is silently dropped.

1. **42 client pages query with select('*'), inflating payload bytes on every uncached fetch**
   - files: /Users/brianlewis/Circle of Life/Circle-of-Life/src/app/(admin)/admin/executive/entity/[id]/page.tsx, /Users/brianlewis/Circle of Life/Circle-of-Life/src/app/(admin)/admin/residents/[id]/medications/page.tsx
   - For each .select('*') call site, identify table+filters and run EXPLAIN (ANALYZE, BUFFERS) on prod for the filtered form, e.g. supabase.from('incidents').select('*').eq('facility_id', $1).is('deleted_at', null) and supabase.from('residents').select('*').eq('facility_id',$1).is('deleted_at',null) — compare select * vs explicit columns and check indexes on (facility_id, deleted_at).
2. **Profile/org lookup uses two sequential queries (.select narrowed but split) and broad .select('*') appears in ~68 files — RSC payload and round-trip bloat**
   - files: src/contexts/haven-auth-context.tsx, src/app/(admin)/admin/admissions/[id]/page.tsx
   - EXPLAIN ANALYZE the HavenAuth path: SELECT app_role, organization_id, full_name, avatar_url FROM user_profiles WHERE id = '<auth-uid>'  (and) SELECT name FROM organizations WHERE id = '<org-uuid>' — call sites src/contexts/haven-auth-context.tsx; confirm PK/index usage and consider a single joined view vw_user_profile_with_org.
3. **95 unbounded .select('*') queries pull full rows on data pages, inflating payload + serialization on every nav**
   - files: src/app/(admin)/executive/reports/page.tsx
   - EXPLAIN ANALYZE on table=exec_saved_reports, columns/filter: organization_id = $org AND deleted_at IS NULL ORDER BY updated_at DESC — call site src/app/(admin)/executive/reports/page.tsx:218-224 (supabase.from('exec_saved_reports').select('*')). Want an index on (organization_id, deleted_at, updated_at DESC).
4. **N+1 facility access check in a loop on GET /api/rounding/plans**
   - files: src/app/api/rounding/plans/route.ts, src/lib/rounding/auth.ts, src/lib/supabase/service-role-facility-access.ts
   - user_facility_access (user_id, facility_id, organization_id, revoked_at) — site: src/lib/supabase/service-role-facility-access.ts:23-30 (called per-facility from rounding/plans/route.ts:64). EXPLAIN ANALYZE the maybeSingle filter on (user_id, facility_id, organization_id) WHERE revoked_at IS NULL; verify composite index on user_facility_access(user_id, facility_id) (and facilities(id, organization_id) for the owner/org_admin branch at lines 14-20).
5. **incidents range-filtered by created_at, but only occurred_at is indexed (index/predicate mismatch)**
   - files: src/app/api/admin/rounding/insights/run/route.ts, supabase/migrations/021_incident_reporting_schema.sql
   - Table incidents, columns (resident_id IN (...), created_at >= now()-7d, deleted_at IS NULL). Call site: src/app/api/admin/rounding/insights/run/route.ts:198-203. EXPLAIN ANALYZE: SELECT resident_id, category, severity FROM incidents WHERE resident_id = ANY($1::uuid[]) AND created_at >= now() - interval '7 days' AND deleted_at IS NULL;  -- compare to same query using occurred_at to see idx_incidents_resident kick in.
6. **resident_observation_logs range-filtered by observed_at, but indexes are on entered_at**
   - files: src/app/api/admin/rounding/insights/run/route.ts, supabase/migrations/098_resident_assurance_schema.sql, supabase/migrations/107_resident_assurance_indexes_rls_patch.sql
   - Table resident_observation_logs, columns (resident_id IN (...), observed_at >= now()-7d, deleted_at IS NULL). Call site: src/app/api/admin/rounding/insights/run/route.ts:193-197. EXPLAIN ANALYZE: SELECT resident_id, quick_status, exception_present FROM resident_observation_logs WHERE resident_id = ANY($1::uuid[]) AND observed_at >= now() - interval '7 days' AND deleted_at IS NULL;
7. **Per-request RLS tax: STABLE SECURITY DEFINER helpers re-query user_profiles/user_facility_access/facilities on every page fetched via the user client**
   - files: supabase/migrations/004_haven_rls_helpers.sql, supabase/migrations/013_resident_profile_rls.sql, supabase/migrations/099_resident_assurance_rls.sql
   - Functions haven.app_role()/haven.organization_id()/haven.accessible_facility_ids() over user_profiles + user_facility_access + facilities. Call path: any RLS-protected SELECT via lib/supabase/server.ts. EXPLAIN ANALYZE a representative resident list AS the authenticated role: SET request.jwt.claims = '{"sub":"<auth_uid>"}'; EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM residents WHERE organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids());  -- inspect how many times the user_profiles/facilities scans appear and their cumulative time.
8. **assessments range-filtered by created_at, but indexes are on assessment_date / (resident_id, assessment_type, assessment_date)**
   - files: src/app/api/admin/rounding/insights/run/route.ts, supabase/migrations/011_resident_clinical_assets.sql
   - Table assessments, columns (resident_id IN (...), created_at >= now()-7d, deleted_at IS NULL). Call site: src/app/api/admin/rounding/insights/run/route.ts:219-223. EXPLAIN ANALYZE: SELECT resident_id, assessment_type, total_score FROM assessments WHERE resident_id = ANY($1::uuid[]) AND created_at >= now() - interval '7 days' AND deleted_at IS NULL;
9. **emar status/PRN queries can't use the partial indexes (idx_emar_status is WHERE status='scheduled' only)**
   - files: src/lib/caregiver/shift-brief.ts, src/app/(caregiver)/prn-followup/page.tsx, supabase/migrations/016_resident_medications_emar.sql
   - Table emar_records, columns (facility_id, is_prn=true, status IN ('given','self_administered'), actual_time NOT NULL, deleted_at IS NULL, prn_effectiveness_checked). Call site: src/lib/caregiver/shift-brief.ts:97-105. EXPLAIN ANALYZE: SELECT count(*) FROM emar_records WHERE facility_id = $1 AND is_prn = true AND status IN ('given','self_administered') AND actual_time IS NOT NULL AND deleted_at IS NULL AND (prn_effectiveness_checked IS NULL OR prn_effectiveness_checked = false);
10. **Admin facilities list does a fan-out of 5 .in(facility_id) aggregate queries per page; incidents/staff/risk legs lean on facility_id indexes but risk_score_snapshots has no global limit**
   - files: src/app/api/admin/facilities/route.ts
   - Table risk_score_snapshots, columns (organization_id, facility_id IN (...), deleted_at IS NULL, ORDER BY computed_at DESC, no limit). Call site: src/app/api/admin/facilities/route.ts:165-172. EXPLAIN ANALYZE: SELECT facility_id, computed_at, summary_json FROM risk_score_snapshots WHERE organization_id = $1 AND facility_id = ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY computed_at DESC;  -- also EXPLAIN the DISTINCT ON rewrite and check for an index on (facility_id, computed_at DESC).
11. **Facility search uses leading-wildcard ILIKE on name/city with no trigram (pg_trgm) index**
   - files: src/app/api/admin/facilities/route.ts
   - Table facilities, columns (name ILIKE '%term%' OR city ILIKE '%term%'). Call site: src/app/api/admin/facilities/route.ts:108-110. EXPLAIN ANALYZE: SELECT id FROM facilities WHERE (name ILIKE '%oak%' OR city ILIKE '%oak%') AND deleted_at IS NULL;  -- expect Seq Scan; re-EXPLAIN after creating pg_trgm GIN indexes.
12. **Incident detail page runs ~10 SERIAL Supabase round-trips in the browser**
   - files: src/app/(admin)/incidents/[id]/page.tsx
   - EXPLAIN ANALYZE the followups+watch chain: incident_followups WHERE incident_id=$1 AND deleted_at IS NULL (verify index on incident_followups(incident_id)); resident_watch_instances WHERE triggered_by_id=$1 (verify index on triggered_by_id); resident_observation_tasks WHERE watch_instance_id IN(...) and resident_observation_escalations WHERE task_id IN(...) (verify indexes on those FKs). Call sites: src/app/(admin)/incidents/[id]/page.tsx:1143,1192,1211,1254.
13. **Resident profile page (most-navigated) fetches a deep waterfall client-side after hydration**
   - files: src/app/(admin)/residents/[id]/page.tsx, src/components/residents/ResidentDetailOverviewClient.tsx, src/lib/residents/resident-detail-overview-load.ts
   - EXPLAIN ANALYZE the nested resident read: residents WHERE id=$1 AND deleted_at IS NULL with beds!fk_beds_resident→rooms→units (verify FK indexes beds(current_resident_id), rooms(unit_id)); plus the per-resident logs: daily_logs/adl_logs/behavioral_logs/condition_changes/assessments WHERE resident_id=$1 AND facility_id=$2 (verify composite index on (resident_id, facility_id, deleted_at)). Call sites: src/lib/residents/resident-detail-overview-load.ts:~308 and the Promise.all at ~398.
14. **App-wide auth bootstrap (HavenAuthProvider) blocks every /admin page with serial getUser + profile + org queries**
   - files: src/contexts/haven-auth-context.tsx, src/app/(admin)/admin/layout.tsx, src/components/layout/AppShell.tsx
   - EXPLAIN ANALYZE user_profiles WHERE id=$1 with organizations(name) join (verify PK on user_profiles.id and index on organizations.id). Call sites: src/contexts/haven-auth-context.tsx:66 and :86.
15. **Care-plan page does a 3-step serial client waterfall with an artificial resident→plan dependency**
   - files: src/app/(admin)/residents/[id]/care-plan/page.tsx
   - EXPLAIN ANALYZE care_plans WHERE resident_id=$1 AND deleted_at IS NULL (verify index on care_plans(resident_id)); care_plan_items WHERE care_plan_id=$1 AND is_active AND deleted_at IS NULL ORDER BY sort_order (verify index on care_plan_items(care_plan_id)). Call sites: src/app/(admin)/residents/[id]/care-plan/page.tsx:138,155.
16. **Resident medications & assessments sub-pages each run a needless serial resident-name fetch before the real query**
   - files: src/app/(admin)/admin/residents/[id]/medications/page.tsx, src/app/(admin)/admin/residents/[id]/assessments/page.tsx
   - EXPLAIN ANALYZE resident_medications WHERE resident_id=$1 AND deleted_at IS NULL ORDER BY medication_name (verify index on resident_medications(resident_id)); assessments WHERE resident_id=$1 AND facility_id=$2 AND deleted_at IS NULL (verify composite index (resident_id, facility_id)). Call sites: src/app/(admin)/admin/residents/[id]/medications/page.tsx:59; src/app/(admin)/admin/residents/[id]/assessments/page.tsx:83.
17. **No shared client cache/dedupe: every navigation and tab switch refetches from scratch**
   - files: src/components/residents/ResidentDetailOverviewClient.tsx, src/app/(admin)/residents/[id]/care-plan/page.tsx, src/app/(admin)/admin/residents/[id]/medications/page.tsx
   - N/A — architectural caching change, not a single query to EXPLAIN.
18. **Data-loading helpers default to the browser anon client even when called server-side**
   - files: src/lib/residents/load-residents.ts, src/lib/incidents/load-incidents.ts, src/lib/residents/resident-detail-overview-load.ts
   - N/A — client-provenance/auth-binding issue, not a query plan.
19. **Unbounded SELECT('*') list queries pull every row and every column for client rendering**
   - files: src/app/(admin)/insurance/claims/page.tsx, src/app/(admin)/insurance/renewals/page.tsx, src/app/(admin)/insurance/coi/page.tsx
   - insurance_claims (organization_id, deleted_at, date_of_loss) — EXPLAIN ANALYZE the call at insurance/claims/page.tsx:34: select * from insurance_claims where organization_id=$1 and deleted_at is null order by date_of_loss desc; confirm an index on (organization_id, deleted_at, date_of_loss desc) exists.
20. **Client-side aggregation: whole tables pulled to the browser and summed/bucketed in JS instead of SQL**
   - files: src/app/(admin)/vendors/spend/page.tsx, src/lib/insurance/compute-tcor.ts, src/app/(admin)/insurance/page.tsx
   - vendor_payments (organization_id, deleted_at, vendor_id, amount_cents) — EXPLAIN ANALYZE: select vendor_id, sum(amount_cents) from vendor_payments where organization_id=$1 and deleted_at is null group by vendor_id; verify index on (organization_id, deleted_at) and consider covering vendor_id, amount_cents.
21. **staff_certifications main list query lacks a composite index matching filter+sort+soft-delete (eq facility_id, is deleted_at null, order expiration_date)**
   - files: src/app/(admin)/certifications/page.tsx, supabase/migrations/024_staff_management_schema.sql
   - Table staff_certifications; columns/predicate: WHERE facility_id = $1 AND deleted_at IS NULL ORDER BY expiration_date ASC LIMIT 500. Supabase call site: src/app/(admin)/certifications/page.tsx:530-540 fetchCertificationsFromSupabase(). EXPLAIN (ANALYZE, BUFFERS) SELECT id, staff_id, certification_type, certification_name, issuing_authority, issue_date, expiration_date, status, deleted_at FROM staff_certifications WHERE facility_id = '<real_facility_uuid>' AND deleted_at IS NULL ORDER BY expiration_date ASC LIMIT 500;
22. **Org-level KPI rollup pulls every matching row across the wire and counts them in JS instead of using DB aggregates**
   - files: src/lib/executive/load-executive-kpi-bulk.ts
   - residents filtered by facility_id IN (org facility ids) AND deleted_at IS NULL AND status IN ('active','hospital_hold','loa'); invoices by organization_id + facility_id IN (...) AND deleted_at IS NULL AND voided_at IS NULL AND balance_due>0 — both via load-executive-kpi-bulk.ts scope() at lines 105-120. EXPLAIN ANALYZE these on prod to confirm index usage vs seq scan.
23. **Wide select('*') with embedded joins on list/detail loads ships excess columns over the wire**
   - files: src/app/(admin)/admin/dietary/page.tsx, src/app/(admin)/insurance/policies/[id]/page.tsx, src/app/(admin)/residents/[id]/page.tsx
   - diet_orders: index on (facility_id, deleted_at, updated_at DESC) — supports src/app/(admin)/admin/dietary/page.tsx:230-235 supabase.from('diet_orders').select(...).eq('facility_id',...).is('deleted_at',null).order('updated_at',{ascending:false}).limit(50); EXPLAIN ANALYZE on prod with a real facility_id.
24. **Meds eMAR page: 7 sequential round-trips with a redundant residents refetch (residents already returned by the join)**
   - files: src/app/(caregiver)/meds/page.tsx
   - EXPLAIN ANALYZE the emar_records day-window scan at src/app/(caregiver)/meds/page.tsx:153 — table emar_records, columns (facility_id eq, scheduled_time gte/lte startUtc/endUtc, deleted_at is null); verify a composite index on emar_records(facility_id, scheduled_time) WHERE deleted_at IS NULL exists.
25. **Resident profile + shift-log pages: serial residents→beds→rooms hops, then an extra serial query after the parallel block**
   - files: src/lib/caregiver/resident-profile.ts, src/app/(caregiver)/resident/[id]/page.tsx, src/app/(caregiver)/resident/[id]/log/page.tsx
   - EXPLAIN the residents-by-id lookups (resident-profile.ts:145-155 and log/page.tsx:107) and the daily_logs/adl_logs ordered-by-date scans (log/page.tsx:137-154) — tables daily_logs/adl_logs filtered by (resident_id, facility_id, deleted_at IS NULL) ordered by log_date/log_time; confirm composite indexes on (resident_id, facility_id, log_date).
26. **schedules page uses select('*') and a serial getUser → context → staff → shift_assignments chain**
   - files: src/app/(caregiver)/caregiver/schedules/page.tsx
   - EXPLAIN the shift_assignments range query at src/app/(caregiver)/caregiver/schedules/page.tsx:76 — table shift_assignments, columns (staff_id eq, facility_id eq, shift_date between start..end, deleted_at IS NULL); verify composite index shift_assignments(staff_id, facility_id, shift_date).

---
*Generated by a 18-agent audit (96 raw findings, 3 verification lenses) + JARVIS prod measurement. 2026-05-28.*
