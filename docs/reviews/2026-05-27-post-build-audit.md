# Round 3 Post-Build Audit

**P0: 6 | P1: 29 | P2: 18**

**Date:** 2026-05-27
**Scope:** Surviving findings after Round 1 (`d078ccc9`), Round 2 (`0f1014c6`), P2 cleanup (`49597151`, `7ff29ff2`), plus everything introduced by Settings IA Slices 1–4 (`03d78f98`, `49bd5888`, `27859dbe`, `11b954c0`, `561f251a`) and the audit-action migration (`284`).
**Reviewer:** JARVIS (senior code review pass)
**Lens:** Security, performance, DB integrity, React/TS quality, Edge Functions, UI/UX/a11y.

---

## Context

Three audit waves have already shipped P0/P1 fixes (see the 04-21 → 05-25 commit window). This pass surfaces issues that survived prior rounds OR were introduced by the last ~10 commits — primarily the new admin password-reset endpoint, the Settings hub, phase-1 facility/staff/vendor/compliance migrations (280–283), and the haven-ai-router rewrite in `7ff29ff2`.

Already-fixed items (NOT re-reported): NLQ viewport math, dashboard snapshot LRU cache, parallelized exec refresh, narrowed outbreak detection load, ConversationSidebar perf, NLQ FTS index, soft-deleted session lock fix, NLQ session policy widening, reserve_nlq_ordinals org guard, optimizePackageImports, realtime cleanup catch, Sentry RSC noise filter.

---

## Pre-existing known blockers (carried forward, not re-counted)

- **Pre-existing P1** — `src/hooks/useClientDemoMode.ts:5` — `Cannot find module '@/lib/demo-mode'`. Blocks `npm run typecheck`. Either restore the missing `src/lib/demo-mode.ts` exporting `isClientDemoMode()` or rewrite `useClientDemoMode` to read `process.env.NEXT_PUBLIC_DEMO_MODE` inline.
- **Pre-existing P1** — `supabase/migrations/20260514180707_homewood_round2_employee_seed.sql` references the `staff_role` enum value `'assistant_administrator'`, which is only added by `281_phase1_staff_seed.sql`. Lexicographic sort orders the May-14 file before 281 on a fresh reset, so `migrations:verify:pg` fails. Production was applied chronologically and is unaffected. Fix: rename the seed file to a `285_`-prefixed numeric so ordering matches production application order; or drop the seed and re-issue as `285_homewood_round2_employee_seed.sql`.
- **Pre-existing P2 batch** — ~60 `no-explicit-any` errors across `src/lib/resident-assurance/` (Module 25 WIP per the S0 closeout memo). Tracked separately.

---

# P0 — Security / data loss

## 1. `src/app/api/admin/users/[id]/reset-password/route.ts:50–60` — Privilege escalation: `org_admin` can reset an `owner`'s password ✅ Implemented in 74f4ffeb

**Category:** Security
**Description:** The new route added in `27859dbe` allows both `owner` and `org_admin` to call it (`allowedRoles: ["owner", "org_admin"]`) and then only verifies the target shares the actor's `organization_id`. An `org_admin` can therefore reset the password of any user in the org — including the `owner` — and either receive a temporary password in the response or trigger a recovery email. This is account takeover with full audit attribution to the org_admin (which is the wrong attribution).
**Exact fix:**
```diff
 if (target.organization_id !== actor.organization_id) {
   return NextResponse.json({ error: "Not found" }, { status: 404 });
 }
+if (actor.app_role !== "owner" && target.app_role === "owner") {
+  return NextResponse.json(
+    { error: "Only owners can reset owner passwords" },
+    { status: 403 },
+  );
+}
+if (actor.app_role === target.app_role && actor.id !== target.id) {
+  // Optional: also block peer-on-peer (org_admin ↔ org_admin) takeover.
+  // Drop this branch if the product intentionally allows peer reset.
+  return NextResponse.json(
+    { error: "Cannot reset a peer admin's password" },
+    { status: 403 },
+  );
+}
 if (!target.email) {
```

---

## 2. `src/app/api/admin/users/[id]/reactivate/route.ts:33–38` — Privilege escalation: `org_admin` can reactivate an `owner` account ✅ Implemented in 74f4ffeb

**Category:** Security
**Description:** Same shape as finding #1 in the pre-existing route. `requireAdminApiActor({ allowedRoles: ["owner", "org_admin"] })` followed only by an `organization_id` equality check lets an `org_admin` un-soft-delete an owner that was previously revoked. Pairs with finding #1 to enable a hostile takeover chain: an org_admin disables an owner, reactivates them, then resets their password.
**Exact fix:**
```diff
 if (target.organization_id !== actor.organization_id) {
   return NextResponse.json({ error: "Not found" }, { status: 404 });
 }
+if (actor.app_role !== "owner" && target.app_role === "owner") {
+  return NextResponse.json(
+    { error: "Only owners can reactivate owner accounts" },
+    { status: 403 },
+  );
+}
```

---

## 3. `supabase/functions/resident-assurance-ai/index.ts:183–185` — Clinical/PHI text leak into broadly-visible `exec_alerts.body`

**Category:** Security / PHI
**Description:** When the AI flags a resident insight, the function inserts a row into `exec_alerts` with `body: p.body?.slice(0, 2000)` — i.e. the model's free-form clinical explanation, truncated to 2000 chars. `exec_alerts` is surfaced to executive/owner/org_admin dashboards (and any other RLS arm) and is not gated by a resident-access check the way `resident_observation_logs` is. The body can include resident initials, vitals, observation text, and AHCA-relevant clinical reasoning — i.e. PHI distributed to readers who may not have direct facility-level access to that resident's chart.
**Exact fix:**
```diff
   await admin.from("exec_alerts").insert({
     organization_id: orgId,
     facility_id: r.facility_id,
     severity: p.severity,
     title: p.title?.slice(0, 200),
-    body: p.body?.slice(0, 2000),
+    body: "AI-detected clinical pattern for a resident. Open Resident Assurance for details.",
+    current_value_json: {
+      resident_id: r.id,
+      facility_id: r.facility_id,
+      insight_type: iType,
+      insight_id: insertedInsightId,
+    },
     ...
   });
```
The PHI-bearing detail stays on `resident_safety_scores` / `resident_observation_logs` where the RLS arms enforce per-resident access; the alert becomes a routing pointer, not a record of detail.

---

## 4. `supabase/functions/observation-escalation-engine/index.ts:46–95` — Service-role writes scoped by ID only (cross-org write risk)

**Category:** Security / multi-tenant
**Description:** The scanner pulls overdue tasks across orgs (the for-loop iterates orgs), then for each row issues `UPDATE … WHERE id = r.id` and `SELECT … WHERE observation_task_id = r.id` using the service-role client. Because service-role bypasses RLS, any mismatched/cached `r.id` value (or a future code path that re-uses the same client) writes/reads cross-tenant data without RLS protection. The function is currently safe because the input set is itself service-role-filtered, but it violates the codebase's "every service-role write asserts org scope" rule and is one rebase away from a real leak.

Additionally, the overdue-task query has no `.limit()` and no ordering — a backlog after a cron outage will hammer the DB.

**Exact fix:**
```diff
-  const { data: overdue } = await admin
+  const { data: overdue } = await admin
     .from("observation_tasks")
     .select("id, organization_id, facility_id, resident_id, severity_level, grace_ends_at")
     .eq("organization_id", orgId)
     .eq("status", "pending")
     .lt("grace_ends_at", new Date().toISOString())
-    .is("deleted_at", null);
+    .is("deleted_at", null)
+    .order("grace_ends_at", { ascending: true })
+    .limit(500);
```
And on every write/read within the per-row loop:
```diff
-  await admin.from("observation_tasks").update({ status: "escalated", escalated_at: now }).eq("id", r.id);
+  await admin
+    .from("observation_tasks")
+    .update({ status: "escalated", escalated_at: now })
+    .eq("id", r.id)
+    .eq("organization_id", orgId);
-  const { data: dedupeHit } = await admin.from("exec_alerts").select("id").eq("observation_task_id", r.id);
+  const { data: dedupeHit } = await admin
+    .from("exec_alerts")
+    .select("id")
+    .eq("organization_id", orgId)
+    .eq("observation_task_id", r.id);
-  const { data: watchHit } = await admin.from("resident_watch_instances").select("id").eq("resident_id", r.resident_id);
+  const { data: watchHit } = await admin
+    .from("resident_watch_instances")
+    .select("id")
+    .eq("organization_id", orgId)
+    .eq("resident_id", r.resident_id);
```

---

## 5. `supabase/functions/process-referral-hl7-inbound/index.ts:81–143` — Cron path processes every org's queue when `organization_id` is omitted

**Category:** Security / multi-tenant
**Description:** The cron entry accepts an optional `organization_id`, validates it only if present, and falls through to a `.from('referral_hl7_inbound_queue').select(...)` with NO org filter when `orgId` is null. Under service-role this fans out across every tenant. Every row update inside the loop then writes by `id` only, also without an org guard.
**Exact fix:**
```diff
-  if (orgId && !UUID_RE.test(orgId)) {
+  if (!orgId || !UUID_RE.test(orgId)) {
     return jsonResponse(
-      { error: "organization_id must be a valid uuid" },
+      { error: "organization_id is required and must be a valid uuid" },
       400,
     );
   }
   ...
-  if (orgId) q = q.eq("organization_id", orgId);
+  q = q.eq("organization_id", orgId);
```
Inside the loop:
```diff
   await admin
     .from("referral_hl7_inbound_queue")
     .update({ status, processed_at: now, error_message: msg })
-    .eq("id", row.id);
+    .eq("id", row.id)
+    .eq("organization_id", orgId);
```
If the scheduler genuinely needs all-org processing, expose a separate explicit `all_organizations: true` flag and document the privilege escalation that comes with it.

---

## 6. `supabase/functions/_shared/router-dispatch.ts:300–420` — Caregiver/family see org-wide facility KPI and directory facts via service-role calls

**Category:** Security / multi-tenant (IDOR-by-omission)
**Description:** `haven-ai-router` permits `caregiver` and `family` roles. Three loaders feed the model with org-wide content using only `organization_id`:

- `loadFacilitiesWithName(admin, organizationId)` — every facility name + bed count in the org.
- `loadDirectoryBlock(admin, organizationId)` — every facility fact (addresses, phone, vendor mappings).
- `loadKpiBundle(admin, organizationId)` — portfolio + per-facility KPIs.

Caregivers and family members should see only the facilities they have `user_facility_access` for. The router already computes `facilityIds[]` upstream — it just isn't being passed to these loaders.

**Exact fix:**
```diff
 async function loadFacilitiesWithName(
   admin: SupabaseClient,
   organizationId: string,
+  facilityIds?: string[],
 ): Promise<FacilityRow[]> {
-  const { data, error } = await admin
+  let q = admin
     .from("facilities")
     .select("id, name, total_licensed_beds, entity_id")
     .eq("organization_id", organizationId)
     .is("deleted_at", null);
+  if (facilityIds) {
+    if (facilityIds.length === 0) return [];
+    q = q.in("id", facilityIds);
+  }
+  const { data, error } = await q;
   if (error) throw new Error(error.message);
   return (data ?? []) as FacilityRow[];
 }
```
Add the same `facilityIds?: string[]` parameter to `loadDirectoryBlock`, `loadKpiBundle`, and `loadFacilityFacts`, and thread `args.facilityIds` from every dispatcher (`dispatchMetric`, `dispatchMixed`, `dispatchKpiBundle`, directory fallbacks). When `app_role` is `owner` or `org_admin`, pass `undefined` (current behaviour); for `caregiver`/`family`, pass the resolved `facilityIds`.

---

# P1 — Database integrity (migrations 274–284)

## 7. `supabase/migrations/277_p2_cleanup.sql:73–122` — `get_nlq_conversation_context` trusts caller-supplied `p_org_id` / `p_user_id`

**Category:** Security / SECURITY DEFINER hygiene
**Description:** The RPC is `SECURITY DEFINER` and granted only to `service_role`. It scopes by `p_org_id` / `p_user_id` as passed by the caller, with no cross-check that those values match `auth.uid()` or the session's actual ownership. The router currently passes verified values, but defense-in-depth requires the function to derive identity from a trusted source. A single mis-ordered argument in any future caller leaks another user's conversation history.

**Exact fix (drop the trust-parameters pattern):**
```sql
CREATE OR REPLACE FUNCTION public.get_nlq_conversation_context(
  p_session_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_limit int DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_msgs jsonb;
  v_limit int;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 12), 0), 50);

  -- Verify the session truly belongs to (p_org_id, p_user_id) before returning anything.
  SELECT s.message_count, s.rolling_summary_text
    INTO v_session
    FROM public.exec_nlq_sessions s
   WHERE s.id = p_session_id
     AND s.organization_id = p_org_id
     AND s.deleted_at IS NULL
     AND (s.user_id = p_user_id OR s.shared_with_org = true)
     AND EXISTS (
       SELECT 1
         FROM public.user_profiles up
        WHERE up.id = p_user_id
          AND up.organization_id = p_org_id
          AND up.deleted_at IS NULL
     );

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- (rest unchanged)
END;
$$;
```

---

## 8. `supabase/migrations/283_phase1_compliance_skeleton.sql:32,72,128–129` — New FKs missing explicit `ON DELETE`

**Category:** DB integrity
**Description:** `legal_entities.organization_id`, `fl_statutes.organization_id`, `background_screenings.facility_id`, and `background_screenings.organization_id` are declared without an explicit `ON DELETE` clause. Postgres defaults to `NO ACTION`, which makes the behaviour ambiguous against the codebase rule (every FK should be explicit). Compliance tables in particular need `RESTRICT` so a stale org/facility cannot vanish data underneath them.

**Exact fix:**
```sql
ALTER TABLE public.legal_entities
  DROP CONSTRAINT IF EXISTS legal_entities_organization_id_fkey,
  ADD  CONSTRAINT legal_entities_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.fl_statutes
  DROP CONSTRAINT IF EXISTS fl_statutes_organization_id_fkey,
  ADD  CONSTRAINT fl_statutes_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.background_screenings
  DROP CONSTRAINT IF EXISTS background_screenings_facility_id_fkey,
  ADD  CONSTRAINT background_screenings_facility_id_fkey
    FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;

ALTER TABLE public.background_screenings
  DROP CONSTRAINT IF EXISTS background_screenings_organization_id_fkey,
  ADD  CONSTRAINT background_screenings_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
```

---

## 9. `supabase/migrations/283_phase1_compliance_skeleton.sql:148–153` — `background_screenings` missing composite RLS index

**Category:** Performance / DB
**Description:** RLS on `background_screenings` filters by `organization_id` (cheapest), then `facility_id IN (SELECT haven.accessible_facility_ids())`, then `deleted_at IS NULL`. The migration ships an `idx_bg_screenings_facility (facility_id)` partial — but no composite `(organization_id, facility_id)` index. On large tenants the planner has to bitmap-AND two narrow indexes instead of seeking one composite. Standard pattern across the rest of the schema.

**Exact fix:**
```sql
CREATE INDEX IF NOT EXISTS idx_background_screenings_org_facility
  ON public.background_screenings (organization_id, facility_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_background_screenings_org_staff
  ON public.background_screenings (organization_id, staff_id)
  WHERE deleted_at IS NULL;
```

---

## 10. `supabase/migrations/280_phase1_facilities_enhancement.sql:20,24` — New columns lack CHECK constraints

**Category:** DB integrity
**Description:** `pharmacy_vendor` is documented to be one of `BAYA_PHARMACY` / `NORTH_FLORIDA_PHARMACY` / NULL but has no CHECK; `occupancy_pct` is documented as `0.00–1.00` but the column type accepts any numeric. Both will eventually drift.

**Exact fix:**
```sql
ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_pharmacy_vendor_check
  CHECK (
    pharmacy_vendor IS NULL
    OR pharmacy_vendor IN ('BAYA_PHARMACY', 'NORTH_FLORIDA_PHARMACY')
  );

ALTER TABLE public.facilities
  ADD CONSTRAINT facilities_occupancy_pct_check
  CHECK (
    occupancy_pct IS NULL
    OR (occupancy_pct >= 0 AND occupancy_pct <= 1)
  );
```

---

# P1 — API routes (admin user management)

## 11. `src/app/api/admin/users/[id]/route.ts:74–80, 96–100, 171–177, 313–322` — Service-role writes/reads scoped by `id` only ✅ Implemented in 74f4ffeb

**Category:** Security / defense-in-depth
**Description:** GET, PATCH, and DELETE all look up the target user with `.eq("id", id)` then post-fetch verify `organization_id`. Under service-role this means the query plan touches rows outside the actor's org before the application throws them out. The codebase rule (see migrations 273/276/278/279) is "every service-role write asserts org scope at the query level". This is a soft P1 because the post-fetch check still blocks the response, but a future `.select()` widening or accidental return-before-check change becomes a leak.

**Exact fix (apply to every service-role hit in this file):**
```diff
 const { data: target, error } = await admin
   .from("user_profiles")
   .select("…")
   .eq("id", id)
+  .eq("organization_id", actor.organization_id!)
   .maybeSingle();
```
On `user_facility_access` (no `organization_id` column), join through facilities and filter:
```diff
 .from("user_facility_access")
 .select("user_id, facility_id, is_primary, facilities!inner(name, organization_id)")
 .eq("user_id", id)
+.eq("facilities.organization_id", actor.organization_id!);
```

Same pattern in:
- `src/app/api/admin/users/[id]/reset-password/route.ts:50–54` (use `.eq("organization_id", actor.organization_id!)` in the target lookup, then drop the post-fetch `if (target.organization_id !== actor.organization_id)` 404).

---

## 12. `src/app/api/admin/users/[id]/reactivate/route.ts:53–58` — `.select()` returns full row after service-role update ✅ Implemented in 74f4ffeb

**Category:** Security / minimization
**Description:** `.select()` with no projection returns every column on `user_profiles` (including columns intended to be admin-only). The handler then returns `data: updated` to the client. Even though the actor is owner/org_admin, this exposes more than the API contract documents.

**Exact fix:**
```diff
 const { data: updated, error: updateErr } = await admin
   .from("user_profiles")
   .update({ deleted_at: null, is_active: true, updated_at: now })
   .eq("id", targetUserId)
+  .eq("organization_id", actor.organization_id!)
-  .select()
+  .select("id, organization_id, email, full_name, app_role, is_active, deleted_at, updated_at")
   .single();
```

---

## 13. `src/app/api/admin/users/[id]/reset-password/route.ts:28` — URL parameter not validated as UUID ✅ Implemented in 74f4ffeb

**Category:** Security / input validation
**Description:** `targetUserId` from the dynamic param is passed straight into `auth.admin.updateUserById` and the DB filter. Supabase parameterizes the value, so this is not SQL injection; it is a validation gap. Malformed IDs should fail fast at 400 rather than fanning out to two slow backends.

**Exact fix:**
```diff
 const { id: targetUserId } = await ctx.params;
+const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
+if (!UUID_RE.test(targetUserId)) {
+  return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
+}
```

---

# P1 — Edge Functions (handler hygiene + tenant scope)

## 14. `supabase/functions/haven-ai-router/index.ts:1235` — No outer try/catch around the handler body

**Category:** Edge / reliability
**Description:** The handler has inner try/catches around individual steps (auth, profile load, dispatch), but no outer wrapper. An unhandled rejection inside any non-wrapped code path (e.g. `await loadKpiBundle` if `computeKpiForFacilityIds` throws) escapes Deno.serve and surfaces as a generic 500 with no Sentry attribution.

**Exact fix:**
```diff
 Deno.serve(async (req) => {
   const t = withTiming("haven-ai-router");
   const origin = req.headers.get("origin");
+  try {
     ...existing body...
+  } catch (err) {
+    t.log({ event: "unhandled", outcome: "error", error_message: String(err) });
+    captureException(err, { event: "router_unhandled" });
+    return routerFailureResponse(origin, "Internal router error");
+  }
 });
```

Apply the identical wrapper to: `exec-alert-evaluator/index.ts:110`, `exec-nlq-executor/index.ts:214`, `exec-report-generator/index.ts:141`, `resident-assurance-ai/index.ts:25`, `grace-orchestrator/index.ts:204`, `observation-escalation-engine/index.ts:26`, `process-referral-hl7-inbound/index.ts:57`. Each one should `t.log` then `captureException` then return a 500 — verify each function imports `captureException` from `_shared/sentry.ts` (most already do).

---

## 15. `supabase/functions/exec-nlq-executor/index.ts:444–454` — Session update scoped by org, not by user

**Category:** Security / IDOR
**Description:** When the executor records the result of a query, it does `update().eq("id", sessionId).eq("organization_id", organizationId)`. The role gate already restricts callers to owner/org_admin/caregiver/family, but the user_id check is missing — any same-org user who knows or guesses a `session_id` can clobber another user's session row.

**Exact fix:**
```diff
   await admin
     .from("exec_nlq_sessions")
     .update({ status, result_summary_text, updated_at: new Date().toISOString() })
     .eq("id", sessionId)
     .eq("organization_id", organizationId)
+    .eq("user_id", user.id);
```

---

## 16. `supabase/functions/exec-nlq-executor/index.ts:253–254` — `body.facility_id` and `body.role` accepted without verification

**Category:** Security / prompt-injection-adjacent
**Description:** Both values flow into the prompt context. `body.role` ends up in the system prompt that decides which dispatchers run; a caregiver claiming `role: "owner"` doesn't pass DB RLS but does shift the model's reasoning. `body.facility_id` becomes a soft filter on KPI selection; if it points at a facility the caller can't access, the model's narrative will reference data the caller still can't fetch — but the framing leaks the existence of the other facility.

**Exact fix:**
```diff
-  const selectedFacilityId = body.facility_id ?? null;
-  const userRole = body.role ?? null;
+  const selectedFacilityId = facilities.some((f) => f.id === body.facility_id)
+    ? body.facility_id
+    : null;
+  const userRole = role; // derived from the verified profile, not the request body
```

---

## 17. `supabase/functions/process-referral-hl7-inbound/index.ts:117,143,170` — Raw DB error text returned in HTTP response

**Category:** Security / info disclosure (low)
**Description:** When a queue row fails, `{ errors: [...] }` is bubbled back to the caller with Postgres `error.message` strings, which can include constraint names, column names, and partial data values. For an internal cron endpoint this is acceptable; if the route is ever exposed via gateway it leaks schema.

**Exact fix:**
```diff
-  if (errors.length) return jsonResponse({ ...summary, errors }, 200);
+  if (errors.length) {
+    t.log({ event: "hl7_queue_partial_failure", outcome: "error", error_count: errors.length });
+    return jsonResponse({ ...summary, error_count: errors.length }, 200);
+  }
```

---

## 18. `supabase/functions/_shared/router-dispatch.ts:304` and `supabase/functions/exec-alert-evaluator/index.ts:140` and `supabase/functions/observation-escalation-engine/index.ts:46–55` — Unbounded org-scoped SELECTs

**Category:** Performance
**Description:** Three loaders return every matching row in the org with no `.limit()` and no ordering. On large tenants (the COL multi-facility demo is the start, multi-LLC operators will eventually be larger), these hit the slow path.

**Exact fix:** add `.order(...).limit(500)` to each:
```diff
   .eq("organization_id", organizationId)
-  .is("deleted_at", null);
+  .is("deleted_at", null)
+  .order("created_at", { ascending: false })
+  .limit(500);
```

---

## 19. `supabase/functions/_shared/router-dispatch.ts:407–422` — Per-facility KPI fan-out (N+1 across facilities)

**Category:** Performance
**Description:** `loadKpiBundle` calls `computeKpiForFacilityIds` once for the portfolio aggregate and then once per facility via `facilities.map(async (f) => computeKpiForFacilityIds(...[f.id]))`. For an org with 5 facilities this is 6 round trips and at 20+ becomes painful. Each dispatch call from the router triggers this.

**Exact fix:** add a batched RPC that returns per-facility KPIs in one shot, e.g. `compute_kpis_by_facility_ids(p_org_id, p_facility_ids[])` returning `(facility_id, kpi jsonb)` rows. Replace the per-facility map with a single RPC call and derive the portfolio aggregate client-side from the same rows. Until that ships, cap fan-out: `facilities.slice(0, 10).map(...)` to bound worst-case latency.

---

## 20. `supabase/functions/resident-assurance-ai/index.ts:75–80` — Clinical reads filter only by `resident_id` under service-role

**Category:** Security / defense-in-depth
**Description:** `resident_observation_logs`, `incidents`, `emar_records`, `resident_safety_scores`, `assessments` all carry `organization_id` and `facility_id` columns. The function reads them with `.eq("resident_id", r.id)` only — service-role bypasses RLS so this works, but the codebase rule is to assert org/facility scope on every service-role read.

**Exact fix (apply to each read):**
```diff
   await admin
     .from("resident_observation_logs")
     .select("…")
-    .eq("resident_id", r.id)
+    .eq("organization_id", orgId)
+    .eq("resident_id", r.id);
```

---

# P1 — Front-end (Settings IA + admin user mgmt)

## 21. `src/components/admin/users/UserEditSheet.tsx:278–326` — Modal has `aria-modal` but no focus trap, no focus restore, no Escape handler

**Category:** UI-a11y
**Description:** The hand-rolled sheet declares `role="dialog" aria-modal="true"` but keyboard users can Tab to elements behind the overlay, focus is not moved into the dialog on open, and focus is not restored to the trigger on close. Escape doesn't close it either.

**Exact fix:** swap the hand-rolled `<div role="dialog">` for the codebase's `<Dialog>` primitive (`@/components/ui/dialog`), which handles all three:
```tsx
import { Dialog, DialogContent } from "@/components/ui/dialog";

return (
  <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent
      aria-labelledby="edit-user-title"
      className="h-[100dvh] w-full max-w-2xl overflow-y-auto p-0 sm:ml-auto sm:rounded-none"
    >
      {/* existing header/tabs/content */}
    </DialogContent>
  </Dialog>
);
```

---

## 22. `src/components/admin/users/UserEditSheet.tsx:331,365,524` — Error messages are color-only, no `role="alert"`

**Category:** UI-a11y
**Description:** `<div className="… text-destructive">{error}</div>` triggers nothing for SR users. After a failed save / failed password reset, SR users see no feedback at all.

**Exact fix:**
```diff
-{error && <div className="rounded-md border border-destructive/30 bg-destructive/10 …">{error}</div>}
+{error && (
+  <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
+    {error}
+  </div>
+)}
```

Same fix on `resetPasswordError` (line 524).

---

## 23. `src/components/admin/users/UserEditSheet.tsx:312–327` — Tab buttons missing `role="tab"`, `aria-selected`, `type="button"`

**Category:** UI-a11y
**Description:** SR users get no selected state; the buttons would also accidentally submit if this sheet is ever moved into a form. Active state is also indicated by `text-teal-600` only — color-only signal.

**Exact fix:**
```tsx
<div role="tablist" aria-label="Edit user sections" className="flex border-b px-6">
  {TABS.map(({ key, label, icon: Icon }) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={activeTab === key}
      aria-controls={`edit-user-panel-${key}`}
      id={`edit-user-tab-${key}`}
      onClick={() => setActiveTab(key)}
      className={cn(
        "flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        activeTab === key
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  ))}
</div>
```

---

## 24. `src/components/admin/users/UserEditSheet.tsx:319` — Hardcoded `text-teal-500`/`text-teal-600`/`border-teal-500`

**Category:** UI-a11y / design tokens
**Description:** The active tab uses raw teal palette classes. The design system rule (`no-raw-color` ESLint plugin) requires `text-primary` / `border-primary` etc. through tokens. This is also why the active state collapses when the theme switches.

**Exact fix:** see the snippet in finding #23 — `border-primary text-primary`.

---

## 25. `src/components/admin/users/UserEditSheet.tsx:280` — Backdrop is a `<div onClick>` (no role / no keyboard)

**Category:** UI-a11y
**Description:** Clickable non-button div without keyboard support. Fixed automatically if you adopt the `<Dialog>` primitive (finding #21). If keeping the hand-rolled sheet:
```tsx
<button
  type="button"
  aria-label="Close edit user sheet"
  className="absolute inset-0 bg-black/30"
  onClick={onClose}
/>
```

---

## 26. `src/components/admin/users/UserEditSheet.tsx:301–308` — Close button below 44×44 tap target

**Category:** UI-a11y / WCAG 2.5.5
**Description:** `p-1` + 16px icon = ~24×24px. Below WCAG 2.5.5 minimum.
**Exact fix:**
```tsx
<button
  type="button"
  onClick={onClose}
  aria-label="Close edit user sheet"
  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
  <X aria-hidden="true" className="h-4 w-4" />
</button>
```

---

## 27. `src/components/admin/users/UserEditSheet.tsx:529–540` — Temporary password rendered as plaintext

**Category:** Security / privacy
**Description:** The temp password is the single most sensitive payload in this flow. It's intentionally returned once to the initiating admin, but it's shown in plaintext by default — over-the-shoulder leak risk, screenshot risk, screen-share risk.

**Exact fix:**
```tsx
const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);

<div className="flex items-center gap-2">
  <input
    readOnly
    type={showTemporaryPassword ? "text" : "password"}
    value={temporaryPassword}
    aria-label="Temporary password"
    className="min-w-0 flex-1 select-all break-all rounded-md bg-background px-3 py-2 font-mono text-sm"
    onFocus={(event) => event.currentTarget.select()}
  />
  <button
    type="button"
    onClick={() => setShowTemporaryPassword((v) => !v)}
    aria-label={showTemporaryPassword ? "Hide temporary password" : "Show temporary password"}
    className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
  >
    {showTemporaryPassword ? "Hide" : "Show"}
  </button>
  <button
    type="button"
    onClick={handleCopyTemporaryPassword}
    aria-label="Copy temporary password to clipboard"
    className="inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
  >
    {copiedTemporaryPassword ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
    {copiedTemporaryPassword ? "Copied" : "Copy"}
  </button>
</div>
```

---

## 28. `src/app/(admin)/admin/settings/SettingsHubClient.tsx:55–63` — Hub shows "Search tools" to roles that can't access the subpage

**Category:** UI-a11y / permission gating
**Description:** The hub card uses `ADMIN_ELIGIBLE_ROLES` (which includes `maintenance_role`) but the `/admin/settings/search-tools` subpage gates on `<PermissionGuard feature="reports" level="view">`, and `reports.view` does not include `maintenance_role`. A maintenance user lands on the card, clicks it, and bounces back with "Access denied." This violates the Slice 4 spec: "unauthorized cards must be hidden."

**Exact fix:** narrow the hub card roles to the actual `reports.view` set:
```tsx
{
  key: "search-tools",
  title: "Search tools",
  description: "Manage search indexing, scope, and synonyms used across Haven.",
  href: "/admin/settings/search-tools",
  icon: Search,
  roles: [
    "owner",
    "org_admin",
    "facility_admin",
    "manager",
    "coordinator",
    "nurse",
    "admin_assistant",
  ],
},
```
(Validate against the actual `PermissionGuard` matrix; the list above is illustrative — pull the canonical set from `src/lib/security/permissions.ts` or wherever `reports.view` is defined and reuse it.)

---

## 29. `src/app/(admin)/admin/settings/notifications/page.tsx:137,294,302,309,317` — `as never` casts hide schema drift

**Category:** React-TS
**Description:** Five `.from("notification_routes").update(... as never)` / `.insert(... as never)` casts silently bypass the `Database` generic. If the column set drifts, the call still type-checks but blows up at runtime. The codebase otherwise treats `as never` as a smell.

**Exact fix:** regenerate `src/types/database.ts` so `notification_routes` is included, then drop the casts:
```tsx
import type { Database } from "@/types/database";
const supabase = useMemo(() => createClient<Database>(), []);

await supabase
  .from("notification_routes")
  .update({
    name: routeName.trim(),
    facility_id: routeFacilityId || null,
    severity_min: routeSeverity,
    channels,
    staff_role_targets: roles.length > 0 ? roles : null,
    is_active: routeActive,
  })
  .eq("id", editingId)
  .eq("organization_id", organizationId)
  .is("deleted_at", null);
```

---

## 30. `src/app/(admin)/admin/settings/notifications/page.tsx:365–375` — Async error/success messages not announced

**Category:** UI-a11y
**Description:** Same shape as finding #22 — `<p className="text-destructive">{err}</p>` / `<p className="text-success">{msg}</p>` with no `role`/`aria-live`. SR users get no feedback when notification routes save or fail.
**Exact fix:**
```tsx
{err && (
  <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
    {err}
  </p>
)}
{msg && (
  <p role="status" aria-live="polite" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
    {msg}
  </p>
)}
```

---

## 31. `src/app/(admin)/admin/profile/page.tsx:221–279` — Profile tab targets below 44×44

**Category:** UI-a11y / WCAG 2.5.5
**Description:** The profile tablist nav is `h-9`, tabs are `h-7`. Both below WCAG 2.5.5 minimum.
**Exact fix:**
```tsx
<nav
  ref={tablistRef}
  role="tablist"
  aria-label="Profile sections"
  onKeyDown={handleTablistKeyDown}
  className="inline-flex min-h-11 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/50 p-1"
>
  {/* tabs: */}
  className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium", ...)}
</nav>
```

---

## 32. `src/app/(admin)/admin/profile/page.tsx:176–190` — Password-change success only signaled by toast

**Category:** UI-a11y
**Description:** Error path uses `role="alert"`, pending state is announced — but success only fires `toast.success("Password updated")`. Users on the page who Tab past the toast lose the only feedback that anything happened.
**Exact fix:**
```tsx
const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

// inside success branch:
setPasswordSuccess("Password updated.");
toast.success("Password updated");

// in JSX:
{passwordSuccess ? (
  <p role="status" aria-live="polite" className="text-sm text-success">{passwordSuccess}</p>
) : null}
```

---

## 33. `src/components/haven-insight/ConversationSidebar.tsx:320–336` — Thread fetch missing `organization_id` predicate

**Category:** Performance / defense-in-depth
**Description:** The realtime subscription filter (added in `7ff29ff2`) is org-scoped, but the initial `.from('exec_nlq_sessions').select(...)` fetch is not. RLS will filter the result, but the query plan still scans wider than necessary, and a future widening of the SELECT policy creates a leak.
**Exact fix:**
```diff
+if (!orgId) return; // gate the fetch until the org is resolved
 let query = supabase
   .from("exec_nlq_sessions")
   .select("id, title, last_message_at, message_count, last_intent, pinned, shared_with_org, deleted_at, user_id")
   .eq("user_id", userId)
   .is("deleted_at", null)
+  .eq("organization_id", orgId)
   .order("last_message_at", { ascending: false });
```
(Add `orgId` to the effect deps and the closure.)

---

## 34. `src/app/(admin)/executive/nlq/page.tsx:258–264` — Message hydration missing `organization_id` predicate

**Category:** Performance / defense-in-depth
**Description:** Same shape as #33 — `.from("exec_nlq_messages").select(...).eq("session_id", sessionId)` with no org filter. RLS catches it; the query plan is wider than necessary.
**Exact fix:** gate the effect on `organizationId`, then add `.eq("organization_id", organizationId)` to the chain.

---

## 35. `src/app/(admin)/executive/nlq/page.tsx:716–719` — Message list key includes array index

**Category:** Performance / React-TS
**Description:** `key={\`${msg.id}-${index}\`}` destabilizes reconciliation on insert/reorder. Streaming responses re-mount instead of re-rendering, costing token-level paints.
**Exact fix:**
```diff
-key={`${msg.id}-${index}`}
+key={msg.id}
```
If client-optimistic msg.id collisions are a real concern, generate UUIDs at message creation rather than indexing.

---

# P2 — Polish, copy nits, deferred quality

| # | File:line | Category | Issue | Suggested fix |
|---|---|---|---|---|
| 36 | npm audit | Security/deps | 5 moderate CVEs (postcss <8.5.10 XSS via stringify, uuid <11.1.1 buffer bounds, qs 6.11.1–6.15.1 DoS, transitively under @sentry/webpack-plugin and next 16.2.6). Production impact low (server-side, controlled inputs). | Run `npm audit fix` for qs/uuid; the next/postcss path is gated on a Next 9.3.3 major downgrade per npm's resolution graph — wait for Next 16.x patch or accept the advisory and document. |
| 37 | `src/app/(admin)/admin/settings/users/page.tsx:65–69` | UI-a11y | "Settings" back link rendered at `text-[10px]` (below 12px floor). | Bump to `text-[12px]`. |
| 38 | `src/app/(admin)/admin/settings/search-tools/page.tsx:20–24` | UI-a11y | Same — back link `text-[10px]`. | Bump to `text-[12px]`. |
| 39 | `src/app/(admin)/admin/profile/page.tsx:240` | UI-a11y | "Soon" badge `text-[10px]`. | Bump to `text-[12px]`. |
| 40 | `src/components/layout/AppShell.tsx:460` | UI-a11y | All-sections menu label `text-[11px]`. | Bump to `text-[12px]`. |
| 41 | `src/components/layout/AppShell.tsx:88–89` | UI-a11y | Workspace kbd pill `text-[10px]`. | Bump to `text-[12px]`. |
| 42 | `src/components/layout/UserMenu/UserMenu.tsx:18–19` | UI-a11y | Kbd shortcut pill `text-[10px]`. | Bump to `text-[12px]`. |
| 43 | `src/components/layout/AppShell.tsx:415–420` | UI-a11y | Retry button missing `type="button"`. | Add `type="button"`. |
| 44 | `src/app/(admin)/admin/settings/users/page.tsx:85–91` | UI-a11y | "Add User" button missing `type="button"`. | Add `type="button"`. |
| 45 | `src/components/admin/users/UserEditSheet.tsx:356,373,445,455` | UI-a11y | Several internal buttons missing `type="button"`. | Add to each. |
| 46 | `src/app/(admin)/admin/settings/notifications/page.tsx:117` | React-TS | `loadRoutes` async sequence updates multiple states with no abort guard. | Wrap in `AbortController`; bail before each `setX` when `signal.aborted`. |
| 47 | `src/components/admin/users/UserEditSheet.tsx:105,132` | React-TS | `fetchUser` + audit fetch update state after unmount. | Same AbortController pattern. |
| 48 | `src/lib/audit/user-management-audit.ts:51` | Edge / logging | `console.error("[user-audit] …", error.message)` may leak Postgres detail/constraint names. | Log `error.code` only; route through `@/lib/observability/logger`. |
| 49 | `instrumentation-client.ts:20` | React-TS | `isKnownBenignNoise` matches by message + mechanism only. | Tighten — also require a frame in `react-server-dom-turbopack-client.browser.production.js` before dropping. |
| 50 | `supabase/functions/_shared/router-dispatch.ts:186,201` | Edge / logging | Raw `console.log/error` instead of structured `t.log`. | Pass `t` from caller, route through structured logger. |
| 51 | `supabase/functions/haven-ai-router/index.ts:1285,1394,1681` | Edge / privacy | Logs include user_id, org_id, session_id verbatim. | Hash before logging via `_shared/sha256.ts`. |
| 52 | `supabase/migrations/283_phase1_compliance_skeleton.sql:167` | DB | `legal_entities` table created in 283 but left empty (per the legal-entities-seed.md issue). | Tracked separately in `docs/issues/legal-entities-seed.md` — owner needs to confirm 3 of 5 LLC→facility mappings before seeding. |
| 53 | `supabase/functions/grace-orchestrator/index.ts:277` | Edge / privacy | Classifier failure logs include raw provider error text. | Log status only, not body. |

---

## What was NOT audited (intentional skips)

- **Anything in `Cadence/` and `facility-launch-center/`** — sibling repos / sub-workspaces with their own audit cadence. Not in scope for the Haven monorepo audit.
- **`prompt-exports/`, `HANDOFFS/`, `docs/`** — non-runtime documentation surfaces.
- **`scripts/` outside of `scripts/agent-gates/`** — utility one-shots, low-risk by inspection. The new `scripts/apply-pending-migrations.py` was given a manual once-over (uses Management API with explicit User-Agent, talks only to `/database/query`, handles "already applied" gracefully) but not exhaustively reviewed.
- **Visual / pixel polish on routes that didn't change** — the round-2 audit (`docs/reviews/2026-05-24-…`) covered the NLQ, profile, ConversationSidebar, UserMenu chrome. Items from that report not yet implemented (e.g. text-[11px] sub-floors on citation chips, P0-4 silent typing indicator, P1-7 collapsed sidebar tooltip) remain valid — see that report for the fixes; not re-listed here.
- **Module 25 (Resident Assurance) `src/lib/resident-assurance/`** — ~60 `no-explicit-any` errors per the S0 closeout memo. Module is WIP; deferred until S1.
- **CSV / .ics export routes added under Track D (D6–D85+)** — not in this commit window, last touched before `d078ccc9`. Audit them in a future Track-D-specific pass.
- **`facility-launch-center` Next sub-app** — separate Next build under the same monorepo; would need its own pass.
- **i18n / RTL** — Haven is en-US only today; out of scope.
- **Playwright e2e under `tests/` and `test-results/`** — out of scope (these are the gate outputs, not source under audit).
- **`AGENTS.md` Rule #2 (audit triggers)** — verified that `tr_*_audit AFTER INSERT OR UPDATE OR DELETE` is the established convention in 274/283; the suggestion in one of the explore probes to switch to `BEFORE` is non-canonical and was dropped.
- **`legal_entities.facility_id` denormalization** — initially considered for inclusion; rejected because `legal_entities` (LLCs) are a 1:N parent of `facilities` (the FK is on `facilities.entity_id`), so denormalizing `facility_id` onto `legal_entities` is wrong by data model.

---

## Suggested dispatch grouping

A follow-up implementation pass could group these by commit:

1. **Security hardening — admin user mgmt** (#1, #2, #11, #12, #13) — single commit touching the three routes + adding the privilege-boundary helper.
2. **Edge function tenant scoping** (#3, #4, #5, #6, #15, #16, #20) — single commit per function or one sweeping commit; each adds org/user filters and the missing handler-wide try/catch (#14).
3. **DB hardening migration 285** (#7, #8, #9, #10) — single new migration `285_round3_hardening.sql`.
4. **Settings IA polish** (#28, #29, #30) — single commit on the Settings hub + notifications page.
5. **UserEditSheet a11y rewrite** (#21, #22, #23, #24, #25, #26, #27) — single commit replacing the hand-rolled sheet with `<Dialog>` and tightening keyboard/SR surface, plus the temp-password show/hide toggle.
6. **NLQ surface tightening** (#33, #34, #35, #19) — single commit on sidebar + page + router-dispatch.
7. **P2 sweep** (#36–#53) — one larger commit cleaning text floors, `type="button"` adds, AbortController patterns, and structured logging.
