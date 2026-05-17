# KB-NEXT — Knowledge Base & AI Surface Roadmap

**Status:** Draft for owner approval
**Author:** Plan synthesis (4 parallel readonly audits — AI surfaces, KB infra, structured data + RLS, governance + UX)
**Created:** 2026-05-17
**Owner sign-off required:** corpus list (Phase 3), tool whitelist (Phase 1 §KB-NEXT-02), token budget per org (Phase 1 §KB-NEXT-03)

---

## Why this exists

A pilot operator (CEO) asked Haven Insight **"Who runs Homewood?"** and got back "I don't have that information." The answer literally exists in the database — `facilities.administrator_name = 'Charlene Elmore'`, set by migration `179_update_col_admin_contacts.sql` lines 13–14. The bug is architectural, not factual:

1. **Two disconnected AI surfaces.** `exec-nlq-executor` (Haven Insight) sees only KPI numbers; `knowledge-agent` (Grace / KB chat) sees only KB chunks. Neither can reach the other's data.
2. **No structured-data tool layer.** Neither surface can query `facilities`, `staff`, `residents` as a tool call — both are stateless prompt-stuffers.
3. **The KB is starved of content.** Only seed/getting-started docs are published; no facility cards, no policies, no org chart.
4. **Retrieval is weak.** `retrieve_evidence` falls back to keyword only when semantic returns nothing — no Reciprocal Rank Fusion, no metadata filters, no reranker beyond an LLM JSON reorder.
5. **Governance is partial.** `knowledge-agent` does not write to `ai_invocations`; rate limits don't cover KB/Grace; `search_audit_log.query_text` is sanitized but not PHI-redacted.

This roadmap takes the KB **and** the AI router from "two thin demos" to **one unified, auditable, citation-first AI brain** that meets Haven's mission gate (resident safety, regulatory readiness, auditability — `AGENTS.md` mission).

---

## Principles (binding)

1. **RLS is the security boundary, not the LLM.** Every tool call enforces caller's `organization_id` + `accessible_facility_ids()` via `haven.*` helpers (`supabase/migrations/004_haven_rls_helpers.sql`). Tools may use `SECURITY DEFINER` for stable signatures but **must** re-assert tenant/facility predicates inside the function body.
2. **No answer without provenance.** Every AI response cites tables (with row IDs) or KB chunks (with `{title, facility, page, chunk_id, score}`). Unsourced answers refuse with "I don't know — log this gap."
3. **PHI is metered at the policy layer.** `ai_invocation_policies.allow_phi` (`supabase/migrations/068_ai_invocation_framework.sql:1–8`) gates every model call. Every model call writes `ai_invocations` with `prompt_hash` + `response_hash`. No silent calls.
4. **One brain, many surfaces.** Haven Insight, Grace, KB chat, and `/admin/executive/nlq` all call the same `haven-ai-router` Edge function. Single tool registry, single retrieval layer, single audit story. No more two-surface schism.
5. **The KB knows what it doesn't know.** Every miss creates a `knowledge_gaps` row with frequency tracking (`supabase/migrations/130_kb_security_and_schema_reconciliation.sql:19–27`). A coverage dashboard tells operators what's missing **before** users ask.

---

## Decision drivers

1. **Trust > breadth.** A KB that confidently makes things up is worse than the current KB. We optimize for refusal and citation before we optimize for coverage.
2. **PHI governance is non-negotiable.** Pilot is Florida ALF with real residents; Pro plan / signed BAA / PITR are gate items (`AGENTS.md` Track A blockers). No surface ships without role gating, redaction, and audit logging on by default.
3. **Shippable in bounded segments.** Repo runs on `npm run segment:gates -- --segment "<id>"` with atomic commits. Every segment lands a user-visible improvement **or** a critical gate — never both halves of a half-shipped feature.

---

## Options considered (ADR)

### Option A — Tactical fact-pack only
Inject facility/staff directory text into Haven Insight's system prompt. Seed a few KB docs. Done.
- **Pros:** 1–2 segments, fast, answers tonight's question.
- **Cons:** Doesn't solve the two-surface schism. No audit parity. No hybrid retrieval. Same wall hits on the 5th question. **Rejected as the full plan but adopted as Phase 0.**

### Option B — Unified router + retrieval upgrade *(chosen)*
Build `haven-ai-router` as the single AI entrypoint. Migrate Haven Insight, Grace, Exec NLQ to it. Add structured tool layer with whitelisted `SECURITY DEFINER` RPCs. Upgrade retrieval to RRF hybrid + rerank with citation anchors. Close governance gaps. Seed corpus + freshness + gaps loop.
- **Pros:** Solves root cause. World-class trajectory. Reuses every existing governance primitive instead of replacing.
- **Cons:** 12 segments across 5 phases. ~3–5 weeks of focused work. Requires sequencing discipline.

### Option C — Vendor RAG (Glean, Vectara, etc.)
Buy enterprise RAG and integrate.
- **Pros:** Capability fast.
- **Cons:** BAA risk with new vendor; ~$200K/yr at our scale; cannot run structured tool calls against Haven schema; doesn't understand FL AHCA / 1823 / Baya context. **Rejected.**

### Decision
**Option B.** Phase 0 (fact-pack) ships tonight as the bounded first slice; the rest sequences over 3–5 weeks.

### Why chosen
- Inherits all existing governance primitives (`ai_invocation_policies`, `_shared/redact-pii.ts`, `haven.*` helpers, `audit_log` triggers, `knowledge_gaps`) instead of replacing.
- Each segment ships user value (Phase 0 answers questions; Phase 1 ends the schism; Phase 2 makes answers grounded; Phase 3 makes them comprehensive; Phase 4 closes the loop).
- Reversible: router is additive; old endpoints remain until cutover.

### Consequences
- `haven-ai-router` becomes Tier-1 critical infra. Needs ownership, SLO, fallback to direct-call legacy endpoints if router fails.
- Tool whitelist becomes a permanent governance artifact requiring owner sign-off for additions.
- Per-org token budget enforcement requires Pro plan headroom and an alerting story.
- Adds ~$200–500/mo in incremental LLM spend (rerank + tool loops + more usage) — small at pilot scale, must monitor at multi-tenant scale.

### Follow-ups
- Quarterly red-team eval against owner-curated Q/A pairs.
- Vendor reassessment in 6 months once we know true cost basis and operator demand.
- Potential router move to dedicated serverless if Supabase Edge timeouts become a constraint at scale (>50 req/min sustained).

---

## Pre-mortem — three failure scenarios

### Scenario 1: PHI leak via tool layer
A whitelisted `SECURITY DEFINER` RPC has a bug that returns cross-org rows when called by the router with service-role bypass. CEO at facility A sees resident data from facility B. **Mission alignment: fail.**

**Mitigations baked in:**
- Every RPC body **must** include `WHERE organization_id = haven.organization_id()` (or equivalent via `haven.accessible_facility_ids()`); no exceptions.
- Integration test per RPC asserts cross-org calls return **0 rows** when caller is in different org (test fixture seeds two orgs).
- All RPCs `SET search_path = public` (per `006_audit_triggers.sql:46–50` pattern).
- Security-review subagent gate **before** exposing any RPC to the router (KB-NEXT-02 acceptance).
- `audit_log` rows for every router invocation, including the tool name and bound args (KB-NEXT-03).

### Scenario 2: Hallucinated citations
Reranker scores a low-quality chunk as highly relevant; LLM cites it confidently; user (nurse) trusts it; clinical decision is made on a wrong policy doc. **Mission alignment: fail.**

**Mitigations baked in:**
- Minimum confidence threshold (configurable per intent class) below which router refuses with "I don't have a high-confidence source — please check directly" + auto-log to `knowledge_gaps`.
- Clinical/medication/regulatory intents require **two corroborating sources** OR a structured-data answer; classifier in KB-NEXT-01 flags these.
- Eval suite (KB-NEXT-12, post-launch but seeded during KB-NEXT-11) — owner curates 50 Q/A pairs; CI fails if accuracy drops > 5 pts.
- Thumbs-down auto-logs a `knowledge_gaps` row tagged `low_confidence` for triage (KB-NEXT-11).
- Every clinical citation links to the underlying doc in the `/admin/knowledge` review page with the **exact** chunk highlighted.

### Scenario 3: Cost blowout
Hybrid retrieval + reranker + tool loops triple per-question token cost. Rate limits aren't on Grace/KB (current `knowledge-agent` has no `isRateLimited` call — governance G3). One user fans out 1,000 questions via a script; $5K burned in an hour.

**Mitigations baked in:**
- Rate limits extended to **every** AI edge function: per-user + per-org sliding window. Defaults: 20 req/min user, 200 req/min org (KB-NEXT-03).
- Per-org **daily token budget** enforced **before** model call; budget configurable per org tier. Soft alert at 80%, hard refusal + Sentry alert at 100%.
- Rerank uses Claude Haiku (`claude-3-5-haiku-latest`, $0.80/1M in, $4/1M out) — ~10× cheaper than Sonnet.
- Tool loops capped at 5 turns; structured output (JSON schema) for tool args to prevent retry storms.
- Sentry edge SDK on router emits `org_token_spend_daily` metric; alert at $50/day/org.

---

## Roadmap shape

```
Phase 0 — Tonight's Win              (1 segment, ~3 hrs)
   │
Phase 1 — Unification & Governance   (3 segments, ~1 week)
   │
Phase 2 — Retrieval Excellence       (3 segments, ~1 week)
   │
Phase 3 — Corpus & Ingestion         (3 segments, ~1–2 weeks)
   │
Phase 4 — Trust, Gaps, Freshness     (2 segments, ~1 week)

Optional follow-up:
Phase 5 — Red-team & Evals           (1 segment, post-launch)
```

Total: **12 mandatory segments**, ~3–5 weeks for one engineer; ~2 weeks with two engineers running independent lanes (lanes marked below).

---

## Phase 0 — Tonight's Win (1 segment)

**Goal:** Answer "Who runs Homewood?" by end of session. Zero architectural change.

### KB-NEXT-00 — Facility & org fact-pack injection
**Size:** S (3 hrs) · **Lane:** sequential (prerequisite) · **Risk:** low

**Files to create / modify**
- `supabase/functions/_shared/facility-facts.ts` — new shared helper. Returns per-facility "fact card":
  - `name`, `administrator_name` (from `facilities`), `assistant_administrator_name` (from `staff` where `staff_role = 'assistant_administrator'`), `licensed_beds`, `address`, `phone`, `email`, `entity_name` (join `entities`), `medicaid_provider_count` (from `facility_medicaid_providers`).
  - Citations: `supabase/migrations/179_update_col_admin_contacts.sql:3–22` (admin names), `supabase/migrations/102_phase1_staff_seed.sql:23` (AA enum), `supabase/migrations/217_col_v2_status_and_medicaid_provider_foundation.sql:203–210` (medicaid providers).
- `supabase/functions/exec-nlq-executor/index.ts` — modify `buildSystemPrompt` (current location `100–176`) to include a `FACILITY DIRECTORY` section above `PORTFOLIO SUMMARY`.

**Acceptance criteria** (testable)
- AC-00.1: Hitting `/admin/executive/nlq` with `"Who runs Homewood?"` returns a response containing `"Charlene Elmore"`.
- AC-00.2: Hitting `"Who is the administrator at each facility?"` returns all five names from migration `179`.
- AC-00.3: Hitting `"How many Medicaid providers do we have at Oakridge?"` returns a non-null count.
- AC-00.4: Existing KPI questions ("What's our occupancy?") still answer correctly — no regression.

**Gate:** `npm run segment:gates -- --segment "kb-next-00-facility-facts"` PASS (typecheck, lint, build, migrations:check). No UI changes → no `--ui`.

**Mission alignment:** **pass** — read-only enhancement to existing audit-logged surface.

---

## Phase 1 — Unification & Governance Foundation (3 segments)

**Goal:** One AI brain. Every model call audited. No surface without rate limits. PHI gate enforced at router.

### KB-NEXT-01 — `haven-ai-router` Edge function
**Size:** L (1.5 days) · **Lane:** A (router) · **Risk:** medium · **Depends on:** KB-NEXT-00

**Files to create / modify**
- `supabase/functions/haven-ai-router/index.ts` — new. Single entrypoint.
- `supabase/functions/_shared/router-intent.ts` — new. Claude-Haiku classifier returning one of:
  `metric` | `directory` | `policy` | `clinical_record` | `regulatory` | `historical` | `mixed` | `chitchat` | `refuse`.
- `supabase/functions/_shared/router-dispatch.ts` — new. Dispatches:
  - `metric` → existing `exec-kpi-snapshot` data path.
  - `directory` → KB-NEXT-02 tool layer (`facility_directory`, `staff_directory`, `org_chart`).
  - `policy` / `regulatory` → KB retrieval (KB-NEXT-04 hybrid).
  - `clinical_record` → role-gated tool calls (resident, care plan, meds).
  - `historical` → `audit_log` query (admin-only).
  - `mixed` → fan-out, merge.
- `supabase/config.toml` — register `[functions."haven-ai-router"]` with `verify_jwt = true` (sits between admin JWT and tools).
- `src/components/haven-insight/HavenInsightContext.tsx:75–88` — point `authorizedEdgeFetch` at `haven-ai-router` instead of `exec-nlq-executor`. Keep `exec-nlq-executor` mounted as fallback (router header `X-Fallback: exec-nlq-executor` if router 5xx).
- `src/lib/grace/api.ts` — same swap for Grace KB calls.

**Acceptance criteria**
- AC-01.1: Router classifies 20 hand-curated test questions correctly (≥ 85% accuracy on first pass).
- AC-01.2: Router returns the same shape both surfaces consume today (`{ answer, citations[], session_id, tokens_used }`) — UI requires zero changes beyond endpoint URL.
- AC-01.3: Router fallback works: kill the router temporarily, Haven Insight still answers via `exec-nlq-executor`.
- AC-01.4: Every router invocation writes one `ai_invocations` row with `prompt_hash`, `response_hash`, `metadata_json.intent`, `metadata_json.tools_used[]`.
- AC-01.5: Router enforces `ai_invocation_policies.allow_phi = true` before any `clinical_record` branch executes; returns 403 otherwise.

**Gate:** `segment:gates --segment "kb-next-01-router" --ui` PASS (UI integration). Include router-classifier accuracy as a measured stat in the segment handoff (target ≥ 85%).

**Risks**
- **Router latency.** Add one classifier call (~300ms Haiku) per question. Mitigate with intent cache (5min TTL on `(user_id, normalized_question)`) and parallel speculative dispatch to top-2 intents when classifier confidence < 0.7.
- **Cutover regression.** Mitigate via feature flag `NEXT_PUBLIC_AI_ROUTER_ENABLED` (default ON in staging, opt-in in prod for 48hr).

**Mission alignment:** **pass** — consolidates governance surface; no clinical workflow change.

### KB-NEXT-02 — Tool layer v1 (Tier-1 RPCs)
**Size:** L (2 days) · **Lane:** B (tools — parallelizable with KB-NEXT-01 after RPC contracts agreed) · **Risk:** medium-high (security) · **Depends on:** KB-NEXT-01 contract

**Files to create**
- `supabase/migrations/234_ai_tool_layer_v1.sql` — defines 13 `SECURITY DEFINER` read-only RPCs grouped by domain. Each `SET search_path = public`, returns JSON, enforces `organization_id` + (where applicable) `accessible_facility_ids()` internally.

  Tier-1 list (final order):
  1. `ai_tool_facility_directory(p_facility_id uuid default null)` → org + entity + facility join + admin name. Source: `002_core_hierarchy.sql:59–85`, `179`.
  2. `ai_tool_staff_directory(p_facility_id uuid, p_role text default null)` → name, role, hire/term dates only. Excludes DOB/SSN/hourly_rate (`024_staff_management_schema.sql:3–41`).
  3. `ai_tool_org_chart()` → org tree (organization → entities → facilities → administrators).
  4. `ai_tool_resident_summary(p_resident_id uuid)` → name, room, primary diagnosis, payer, advance directive flag. Role-gated: refuses if caller is `family` and not linked via `family_resident_links`.
  5. `ai_tool_med_orders(p_resident_id uuid)` → active `resident_medications` (`016_resident_medications_emar.sql`). Role-gated to clinical.
  6. `ai_tool_incident_summary(p_facility_id uuid, p_days int default 30)` → counts by severity + last 5 titles. RLS via `022_incident_reporting_rls.sql:5–13`.
  7. `ai_tool_compliance_status(p_facility_id uuid)` → open deficiencies + POC status (`039_compliance_engine.sql:228–255`).
  8. `ai_tool_ar_aging_by_facility(p_facility_id uuid)` → buckets (current/30/60/90+). **Reads `invoices` directly**, **not** the matview (see KB-NEXT-03 matview fix).
  9. `ai_tool_facility_medicaid_providers(p_facility_id uuid)` → MCO list (`217:203–210`).
  10. `ai_tool_active_alerts(p_facility_id uuid default null)` → `exec_alerts` open in last 30d (already used by `exec-nlq-executor:318–331`).
  11. `ai_tool_certifications_expiring(p_facility_id uuid, p_days int default 30)` → staff certs nearing expiry.
  12. `ai_tool_open_followups(p_facility_id uuid)` → incident follow-ups overdue.
  13. `ai_tool_pilot_facility_snapshot(p_facility_id uuid)` → meta-tool returning a 1-page situational summary (occupancy + incidents + AR + cert risk + alerts). Useful for "Tell me about Oakridge" intent.

- `supabase/functions/_shared/tool-registry.ts` — TypeScript schema definitions (Zod) matching each RPC. Each entry: `{ name, description, input_schema, role_gate, phi_class }`.
- `supabase/functions/haven-ai-router/tools.ts` — router-side tool dispatch with Claude tool-use loop.

**Acceptance criteria**
- AC-02.1: For each of 13 RPCs, a Vitest integration test seeds two orgs and asserts caller in org A receives **zero rows** when calling with org B's facility_id (cross-org isolation).
- AC-02.2: For each RPC marked `phi_class = phi`, calling with `allow_phi = false` policy returns `{ error: "phi_blocked" }`, not data.
- AC-02.3: For each RPC marked `role_gate = clinical`, calling as `family` returns `{ error: "role_denied" }`.
- AC-02.4: Question "Tell me about Oakridge" routes to `ai_tool_pilot_facility_snapshot` and returns a response touching all 5 KPI domains.
- AC-02.5: Question "Is anyone overdue on certs at Plantation?" routes to `ai_tool_certifications_expiring` with `p_facility_id` bound; answer cites row IDs.
- AC-02.6: `ai_tool_ar_aging_by_facility` does **not** read `ar_aging_facility_daily` matview (gap KB-Infra-#5 deferred to KB-NEXT-03 matview wrap).

**Gate:** `segment:gates --segment "kb-next-02-tool-layer"` PASS. Add a **mandatory** security-review subagent pass before merge — security reviewer asserts each RPC body re-enforces tenancy.

**Risks**
- **RLS bypass via tool composition.** LLM chains tool A → tool B and leaks across facilities. Mitigate: every RPC takes facility_id explicitly, no implicit "all facilities"; router rejects tool call if `p_facility_id` not in caller's accessible set.
- **Tool sprawl.** Hold Tier-1 to 13 RPCs in this segment. Tier-2 expansion in Phase 4 with separate owner sign-off.

### KB-NEXT-03 — Governance closeout
**Size:** M (1.5 days) · **Lane:** A · **Risk:** low-medium · **Depends on:** KB-NEXT-01

Closes governance subagent gaps **G1, G2, G3, G4, G5, G8, G10** and KB infra **#5** (compliance_knowledge_repository RLS), structured-data red flags **#2 (ar_aging matview)** and **#3 (role_permissions SELECT)**.

**Files to create / modify**
- `supabase/migrations/235_ai_governance_closeout.sql`:
  - Add `ai_invocations` writer for `knowledge-agent` (G1). New migration not needed if just adding `ai_invocations.insert()` call in function; this migration handles the schema:
  - Tighten `role_permissions` SELECT — `122_role_permissions_audit_log.sql:71–74` from `USING (true)` to `USING (organization_id = haven.organization_id() OR organization_id IS NULL)` (structured-data red flag #3).
  - Add RLS policies to `compliance_knowledge_repository` (KB infra gap #5, `136_kb_compliance_integration.sql`). SELECT for clinical/admin roles + org scope.
  - Wrap `ar_aging_facility_daily` matview in a `security_invoker = true` view `vw_ar_aging_facility_daily_safe` that re-checks invoice access; `REVOKE SELECT ON ar_aging_facility_daily FROM authenticated` (structured-data red flag #2).
  - Add `ai_token_budgets` table: `(organization_id uuid PK, daily_limit_usd numeric NOT NULL DEFAULT 50, soft_threshold_pct int DEFAULT 80, daily_usage_usd numeric DEFAULT 0, reset_at timestamptz)`.
- `supabase/functions/knowledge-agent/index.ts` — add `ai_invocations` row insert at request completion (G1). Pattern from `exec-nlq-executor:384–409`. Also fix `resident-assurance-ai/index.ts:159–166` `created_by` from nil UUID to actual `request_actor_id` or new `service` literal (G5).
- `supabase/functions/_shared/rate-limit.ts` — extend to support per-org keys in addition to per-user. New `isOrgRateLimited(orgId, limit)` (G3).
- `supabase/functions/knowledge-agent/index.ts` and `grace-orchestrator/index.ts` — add `isRateLimited(user.id)` + `isOrgRateLimited(orgId)` checks (G3 closes).
- `supabase/functions/_shared/redact-pii.ts` — extend regex with FL Medicaid MCO member IDs (numeric 9–13 digits with prefixes), DEA numbers (regex `[A-Z]{2}\d{7}`), NPIs (10 digits). Centralize.
- `supabase/functions/knowledge-agent/index.ts:769–774` — replace `sanitizeSearchQuery` with `redactString` for `search_audit_log.query_text` (G4).
- `supabase/functions/_shared/sentry-edge.ts` — new. Thin wrapper around Sentry's Deno SDK. Initialize in every existing edge function entrypoint; default `sendDefaultPii: false`, strip auth/cookies (mirror `instrumentation-client.ts:3–22`). (G8.)
- `supabase/functions/_shared/audit-log-ai.ts` — new helper writing `audit_log` rows on AI-triggered structured queries (G10) so AI actions cross-link with operation history.
- Router (`haven-ai-router/index.ts`) — call `ai_token_budgets` check **before** any model call; refuse with 429 + Sentry alert when daily usage > 100%.

**Acceptance criteria**
- AC-03.1: Every model invocation in `knowledge-agent` / `grace-orchestrator` writes exactly one `ai_invocations` row (assertion via integration test).
- AC-03.2: `grace-orchestrator` rate limit triggers 429 at 11th request inside 60s per user.
- AC-03.3: Inserting a question containing `"SSN 123-45-6789"` into Grace results in `search_audit_log.query_text` = `"SSN [REDACTED]"`.
- AC-03.4: `SELECT * FROM ar_aging_facility_daily` as `authenticated` returns 0 rows (revoked); `SELECT * FROM vw_ar_aging_facility_daily_safe` returns only invoices caller can see.
- AC-03.5: When `ai_token_budgets.daily_usage_usd >= daily_limit_usd`, router responds with 429 + body `{ error: "org_budget_exceeded" }`.
- AC-03.6: Sentry receives a structured error event when `haven-ai-router` throws (verify in Sentry dashboard).

**Gate:** `segment:gates --segment "kb-next-03-governance"` PASS. Include `migrations:verify:pg` PASS for the new migration.

**Mission alignment:** **pass** — strengthens audit posture, no functional regression to clinical workflows.

---

## Phase 2 — Retrieval Excellence (3 segments)

**Goal:** Hybrid retrieval. Metadata-aware filters. Real citations with page anchors.

### KB-NEXT-04 — RRF hybrid retrieval
**Size:** M (1 day) · **Lane:** C (retrieval) · **Risk:** low · **Depends on:** KB-NEXT-01

Closes KB infra gap **#1** (no RRF) and **#2** (retrieval ignores metadata, partially — full metadata in KB-NEXT-05).

**Files to create / modify**
- `supabase/migrations/236_retrieve_evidence_hybrid.sql`:
  - New `retrieve_evidence_hybrid(p_query_text text, p_query_embedding vector, p_workspace_id uuid, p_user_role text, p_match_count int default 8, p_facility_ids uuid[] default null)` RPC.
  - Implements Reciprocal Rank Fusion: parallel CTEs for vector search (existing logic from `130:68–92`) and BM25 (`plainto_tsquery`, existing FTS index `idx_kb_chunks_fts`), then fuses ranks with `1.0 / (60 + rank)` weighted sum, returns top `p_match_count`.
  - Returns same shape as `retrieve_evidence` + new columns `vector_rank`, `bm25_rank`, `fused_score`.
- `supabase/functions/knowledge-agent/index.ts:2421–2449` — swap `retrieve_evidence` → `retrieve_evidence_hybrid`. Keep old RPC as fallback (router header `X-Retrieval: legacy` if hybrid 5xx).
- `supabase/functions/haven-ai-router/tools.ts` — use hybrid for all KB retrieval.

**Acceptance criteria**
- AC-04.1: For 20 owner-curated Q/A pairs, hybrid retrieval returns the gold-standard chunk in top-5 ≥ 80% of time (vs current vector-only baseline measured first).
- AC-04.2: Question `"What is form 1823?"` retrieves the spec document via either vector OR BM25 (test by deleting the embedding from one chunk — BM25 should still find it).
- AC-04.3: Performance: p95 retrieval latency < 400ms on Pro plan.

**Gate:** `segment:gates --segment "kb-next-04-hybrid"` PASS.

**Risks**
- **Slow RRF.** Mitigate with partial indexes; HNSW is already in place. If p95 > 400ms, fall back to two-stage (vector top-50 → BM25 reranks within those 50).

### KB-NEXT-05 — Metadata filters + reranker
**Size:** M (1 day) · **Lane:** C · **Risk:** low · **Depends on:** KB-NEXT-04

Closes KB infra gap **#2** (metadata) and **#8** (reranker is JSON reorder).

**Files to create / modify**
- `supabase/migrations/237_retrieve_evidence_metadata_filters.sql`:
  - Extend `retrieve_evidence_hybrid` to accept `p_facility_tags text[]`, `p_module_tags text[]`, `p_role_tags text[]`, `p_freshness_days int` (filters by `documents.effective_date`, `review_date`, `lifecycle_status`).
  - Uses metadata defined in `176_grace_memory_compiler.sql:9–28`.
- `supabase/functions/haven-ai-router/rerank.ts` — replace LLM JSON-reorder with **Cohere Rerank v3** (or Voyage rerank-2; pick after testing). Cross-encoder rerank top-20 from hybrid → top-8 final.
- Fallback chain: if rerank API down → use fused_score order from KB-NEXT-04.

**Acceptance criteria**
- AC-05.1: Question `"What's our infection control SOP for Oakridge?"` returns chunks where `facility_tags` contains "Oakridge" **or** the chunk is org-wide (no facility tag).
- AC-05.2: Rerank improves top-1 accuracy by ≥ 10 percentage points on the eval set (measured vs KB-NEXT-04 baseline).
- AC-05.3: Rerank fallback path tested: env `COHERE_API_KEY` unset → hybrid result still returns.

**Gate:** `segment:gates --segment "kb-next-05-rerank"` PASS. Document rerank cost (~$0.001/question) in handoff.

### KB-NEXT-06 — Citation anchors
**Size:** M (1.5 days) · **Lane:** C · **Risk:** low · **Depends on:** KB-NEXT-04, blocked-by KB-NEXT-08 (ingest writes page numbers)

Closes KB infra gap **#3** (no citation anchors).

**Files to create / modify**
- `supabase/functions/ingest/index.ts:464–569` — extend `semanticChunk` to compute and write `page_number` for PDF chunks (`pdf-parse` gives page boundaries) and `markdown_anchor` (sluggified heading id) for all chunks. Persist via existing `chunks.metadata`.
- `supabase/migrations/238_chunk_anchor_columns.sql` — add `chunks.markdown_anchor text`, `chunks.byte_start int`, `chunks.byte_end int` for substring highlight in `/admin/knowledge/admin/review/[id]`.
- `supabase/functions/haven-ai-router/index.ts` — emit citations as `{ title, facility, document_id, chunk_id, page, markdown_anchor, score }` not just `{ title, excerpt }`.
- `src/lib/grace/GraceBar.tsx:788–801` — render citation with `<Link href={\`/admin/knowledge/admin/review/${document_id}#chunk-${chunk_id}\`}>` that scrolls and highlights.
- `src/app/(admin)/admin/knowledge/admin/review/[id]/page.tsx` — scroll-to + highlight chunk on `#chunk-` hash.

**Acceptance criteria**
- AC-06.1: A Grace citation for a PDF doc deep-links to the correct page number when clicked.
- AC-06.2: Citation badge shows `"Page 12 · Section: Medication Errors"` for PDF, `"Section: Medication Errors"` for Markdown.
- AC-06.3: Backfill script re-chunks all existing PDFs to populate `page_number` (one-time migration step in segment handoff).

**Gate:** `segment:gates --segment "kb-next-06-citations" --ui` PASS.

---

## Phase 3 — Corpus & Ingestion (3 segments)

**Goal:** The KB actually contains COL's institutional knowledge. Pipeline can absorb the real-world docs operators will upload.

### KB-NEXT-07 — Auto-generated corpus
**Size:** L (2 days) · **Lane:** D (corpus, parallel with C lane) · **Risk:** low · **Depends on:** KB-NEXT-02

**Goal:** Generate one canonical KB doc per facility / entity / role / org, refreshed nightly. Source of truth = structured tables; KB is a derived view.

**Files to create / modify**
- `supabase/migrations/239_kb_seed_targets.sql` — new table `kb_seed_targets`:
  - `(id, kind text check in ('facility_card','entity_card','role_card','org_chart','employee_handbook','reg_excerpt','emergency_plan','mco_summary','form_1823','medication_sop','infection_control_sop','resident_handbook','family_policy','hipaa_policy'), key text, status text check in ('planned','drafted','published','stale'), owner_user_id uuid, last_published_at timestamptz, last_verified_at timestamptz, review_cadence_days int, document_id uuid references documents)`.
- `supabase/functions/kb-corpus-refresh/index.ts` — new scheduled function. Walks `kb_seed_targets where kind in ('facility_card','entity_card','role_card','org_chart')`, generates markdown from structured data, hashes content, re-ingests via `ingest` only if content changed.
  - Auth: `x-cron-secret = KB_CORPUS_REFRESH_SECRET`.
  - Schedule: nightly 04:00 America/New_York via Supabase Cron.
- `supabase/migrations/240_kb_seed_targets_seed.sql` — seed 5 facility cards + 5 entity cards + 1 org chart + 1 role card per active `app_role`.

**Acceptance criteria**
- AC-07.1: After cron run, querying KB for `"Homewood administrator"` returns the auto-generated facility card naming Charlene Elmore.
- AC-07.2: Updating `facilities.administrator_name = 'X'` and rerunning cron updates the published doc within one cron cycle.
- AC-07.3: `kb_seed_targets` has 11 + (active roles) + planned-only entries for manual targets (`employee_handbook` etc.) marked status `planned`.

**Gate:** `segment:gates --segment "kb-next-07-auto-corpus"` PASS.

### KB-NEXT-08 — Ingestion upgrades
**Size:** L (2 days) · **Lane:** C · **Risk:** medium · **Depends on:** none (parallel-safe with D lane)

Closes KB infra gap **#4** (no image OCR), **#9** (no PHI in ingest), **#10** (no retry), and unlocks **#3** (page anchors).

**Files to create / modify**
- `supabase/functions/ingest/index.ts`:
  - Add `image/*` branch: Tesseract via WASM (`tesseract.js`) for OCR fallback OR Claude vision pass for image captioning. Pick during impl based on cost/quality.
  - Add `pdfjs` integration to walk pages and emit per-page text chunks with `page_number` for downstream KB-NEXT-06.
  - Add explicit retry with exponential backoff (3 tries, base 500ms) around embeddings call (currently no retry — gap #10).
  - Add `redactString` pre-pass on `markdown_text` before chunking when `documents.metadata.contains_phi = true` flag (gap #9).
  - Expand `documents.metadata` to capture: `facility_id`, `module`, `regulatory_citation` (e.g. `"AHCA 429.255"`), `effective_date`, `expires_at`, `confidentiality_tier`.
- `supabase/migrations/241_documents_metadata_columns.sql` — add explicit columns (rather than just JSONB) for `module`, `regulatory_citation`, `expires_at` to make filters in KB-NEXT-05 cheap.
- `supabase/functions/ingest/index.ts:1018–1025` — replace silent fallback with structured error log + Sentry breadcrumb.

**Acceptance criteria**
- AC-08.1: Upload a scanned PDF of FL 1823 form → text extracted via OCR is ingested and retrievable.
- AC-08.2: Upload an image of a floor plan → caption ingested and retrievable.
- AC-08.3: Embedding API simulated to fail twice → ingest retries and succeeds; if all 3 fail, `documents.status = 'ingest_failed'`.
- AC-08.4: Uploading a doc tagged `contains_phi = true` results in `chunks.content` with redacted SSNs.

**Gate:** `segment:gates --segment "kb-next-08-ingest"` PASS.

**Risks**
- **OCR cost.** Tesseract is free but slow; Claude vision is fast but ~$0.003/page. Mitigate: Tesseract for batch, vision opt-in for high-priority docs.

### KB-NEXT-09 — Owner-curated corpus seed
**Size:** L (3 days, mostly content) · **Lane:** D · **Risk:** low (eng) / high (content latency) · **Depends on:** KB-NEXT-08

**Goal:** Publish the foundational COL corpus. This is mostly **content work** the owner controls; engineering provides the ingestion + tracking shell.

**Targets (owner sign-off required before this segment opens):**
- COL Employee Handbook
- AHCA Chapter 429 + FAC 59A-36 excerpts (regulatory)
- Each facility's Emergency Preparedness Plan
- Each MCO contract summary (5 facilities × 5–6 MCOs = ~28 docs)
- Form 1823 procedure
- Medication management SOP (Baya cert workflow)
- Infection control + outbreak response SOP
- Resident handbook
- Family portal policy
- HIPAA/privacy policy

**Files to create / modify**
- `supabase/migrations/242_kb_seed_targets_owner_curated.sql` — insert ~50 rows in `kb_seed_targets` with `status = 'planned'`, `kind = 'employee_handbook'` etc., and an owner assignee.
- `src/features/knowledge/components/SeedTargetTable.tsx` — new admin component listing seed targets with status, owner, "Upload now" button.
- `src/app/(admin)/admin/knowledge/admin/seed/page.tsx` — new route hosting `SeedTargetTable`.

**Acceptance criteria**
- AC-09.1: `/admin/knowledge/admin/seed` lists all owner-curated targets with status badge.
- AC-09.2: Each upload via `SeedTargetTable` links the new `document.id` back to `kb_seed_targets.document_id` and flips status `planned → drafted → published`.
- AC-09.3: After all 50 targets are `published`, coverage dashboard (KB-NEXT-11) shows ≥ 80% across modules.

**Gate:** `segment:gates --segment "kb-next-09-corpus-seed" --ui` PASS. Owner content delivery is **not** gated by engineering; engineering ships the shell + tracker.

---

## Phase 4 — Trust, Gaps, Freshness (2 segments)

### KB-NEXT-10 — Trust UX: citations everywhere, thumbs everywhere, refusal patterns
**Size:** M (1.5 days) · **Lane:** E (UX) · **Risk:** low · **Depends on:** KB-NEXT-06

Closes governance gaps **G6** (citations on Haven Insight / NLQ) and **G7** (no thumbs on Grace / Insight). Fixes KB infra **#7** (`chat_messages.feedback` DDL parity).

**Files to create / modify**
- `supabase/migrations/243_chat_messages_feedback_parity.sql` — explicitly add `feedback` column to `chat_messages` if missing (audit found type def references it but no DDL in `126`). Backfill from any existing rows.
- `src/components/haven-insight/HavenInsightPanel.tsx` — render citations under each assistant bubble (same shape as Grace, `src/lib/grace/GraceBar.tsx:788–801`). Add thumbs-up/down buttons.
- `src/app/(admin)/executive/nlq/page.tsx` — same citation block on each Q/A pair.
- `src/lib/grace/GraceBar.tsx` — add thumbs-up/down to assistant bubbles (currently has them only in KB admin chat per `src/features/knowledge/components/ChatMessage.tsx:26–37`).
- Thumbs-down behavior: writes `chat_messages.feedback`, AND if last answer had `confidence < threshold`, auto-creates `knowledge_gaps` row tagged `user_dissatisfied`.
- Router answer schema — if confidence < threshold for clinical/regulatory intents, response includes `refusal: true, refusal_reason: "low_confidence"` and the UI renders "I don't have a high-confidence source for this — please verify directly. [Log this gap]" with one-click gap log button.

**Acceptance criteria**
- AC-10.1: Haven Insight answer for "What's the medication error rate?" shows a citation badge linking to the source row/doc.
- AC-10.2: Thumbs-down on Grace + Haven Insight writes `chat_messages.feedback = 'down'` and creates `knowledge_gaps` row when confidence below threshold.
- AC-10.3: Asking Haven Insight `"What is the legal definition of 'self-administration' under FL 429?"` with no published reg doc results in refusal UX (not a hallucinated answer).
- AC-10.4: a11y: thumbs buttons have `aria-pressed`, citation badges have `aria-describedby` linking to title; keyboard navigable.

**Gate:** `segment:gates --segment "kb-next-10-trust" --ui` PASS (UI changes; axe a11y check on `/admin/executive/nlq` and `/admin/knowledge`).

### KB-NEXT-11 — Gaps loop, coverage dashboard, freshness
**Size:** M (1.5 days) · **Lane:** E · **Risk:** low · **Depends on:** KB-NEXT-09 (corpus seed populates the dashboard meaningfully)

Closes governance **G9** (gap triage minimal), KB infra **#6** (health metrics shallow).

**Files to create / modify**
- `supabase/migrations/244_knowledge_gaps_workflow.sql`:
  - Extend `knowledge_gaps` with `assigned_to uuid`, `due_date date`, `priority text default 'medium'`, `tags text[]`.
  - Add `documents.last_verified_at timestamptz`, `verification_owner_id uuid`, `review_cadence_days int default 180`.
  - Add `kb_refresh_queue` table for KB-NEXT-07 to enqueue regeneration jobs (triggered by `facilities`, `staff`, `entities` updates via trigger functions).
- `supabase/functions/kb-staleness-marker/index.ts` — nightly cron flips `documents.status` to `'stale'` when `now() - last_verified_at > review_cadence_days`. Auth: `x-cron-secret`.
- `src/app/(admin)/admin/knowledge/admin/gaps/page.tsx` — new full triage UI: list, filter by status/priority, assign, due date, link-to-publish.
- `src/app/(admin)/admin/knowledge/admin/coverage/page.tsx` — new coverage dashboard:
  - Per-module % of `kb_seed_targets` published vs planned.
  - Top 10 most-queried questions with low-confidence misses.
  - Top 10 most-cited docs (from `chunks.metadata` query counts via `kb_analytics_events`).
  - Stale doc count (replaces hardcoded `0` in `useKBHealth:62`).
  - Per-facility coverage heatmap.
- `src/features/knowledge/components/KBCoveragePanel.tsx` — main dashboard component.
- `supabase/functions/kb-weekly-digest/index.ts` — sends owner an email Mon 08:00 ET summarizing: unanswered questions, new published docs, top 5 gaps.

**Acceptance criteria**
- AC-11.1: `/admin/knowledge/admin/gaps` allows assigning a gap to a user, setting due date, marking resolved with linked document.
- AC-11.2: Coverage dashboard shows non-zero `staleDocuments` count once nightly job runs.
- AC-11.3: Weekly digest fires Mon 08:00 ET (verify via test cron run) with at least 3 sections populated.
- AC-11.4: User updates `facilities.administrator_name` → `kb_refresh_queue` enqueues a row → next cron run regenerates the facility card → publish completes within one cycle.

**Gate:** `segment:gates --segment "kb-next-11-gaps-coverage" --ui` PASS.

---

## Phase 5 — Red-team & Evals (optional, post-launch)

### KB-NEXT-12 — Eval harness + red-team
**Size:** M (1.5 days) · **Lane:** F · **Risk:** low · **Depends on:** all prior phases shipped

**Files**
- `tests/ai-eval/` — Vitest harness running 100 owner-curated Q/A pairs against the router weekly via GitHub Actions. Reports accuracy, citation rate, refusal rate, p95 latency, cost per question.
- `supabase/functions/haven-ai-redteam/index.ts` — extends existing `grace-redteam-nightly` to cover router; runs adversarial prompts nightly, alerts on PHI leaks, role-bypass attempts, jailbreaks.

**Acceptance criteria**
- AC-12.1: Eval harness reports baseline: top-1 accuracy, citation precision/recall, refusal correctness on the 100 Q/A pairs.
- AC-12.2: Red-team finds **zero** cross-tenant leaks across 200 adversarial prompts.

---

## Cross-cutting

### Sequencing for two-engineer team

| Week | Lane A (router/gov) | Lane C (retrieval/ingest) | Lane D (corpus) | Lane E (UX) |
|---|---|---|---|---|
| 1 | KB-NEXT-00, 01 | (waits for 01 contract) | – | – |
| 2 | KB-NEXT-02, 03 | KB-NEXT-04, 05 | – | – |
| 3 | – | KB-NEXT-08, 06 | KB-NEXT-07 | – |
| 4 | – | – | KB-NEXT-09 (mostly content) | KB-NEXT-10, 11 |
| 5+ | – | – | – | KB-NEXT-12 |

### Migration numbers reserved
`234` (tool layer), `235` (governance closeout), `236` (hybrid retrieval), `237` (metadata filters), `238` (chunk anchors), `239` (seed targets), `240` (auto seed), `241` (doc metadata cols), `242` (owner seed), `243` (feedback parity), `244` (gaps workflow).

### Edge functions reserved
`haven-ai-router`, `kb-corpus-refresh`, `kb-staleness-marker`, `kb-weekly-digest`, `haven-ai-redteam`.

### Config.toml `verify_jwt`
- `haven-ai-router` → `verify_jwt = true`
- `kb-corpus-refresh`, `kb-staleness-marker`, `kb-weekly-digest`, `haven-ai-redteam` → `verify_jwt = false` (cron secret)

### Existing legacy endpoints kept as fallback for 60 days
`exec-nlq-executor`, `knowledge-agent` (KB chat path). Retired in a follow-up segment `KB-NEXT-99-legacy-retire` once router metrics show ≥ 99% success rate.

---

## Expanded test plan

### Unit
- Per-tool RPC cross-org isolation tests (KB-NEXT-02).
- `redactString` regex coverage: SSN, FL Medicaid IDs, DEA, NPI, DOB phrases.
- RRF fusion math correctness on synthetic ranks.
- Citation parser handles malformed Claude JSON without throwing.
- Token budget pre-check returns 429 correctly.

### Integration (Vitest + Supabase test container)
- Router classifier → tool call → answer with citation, end-to-end.
- KB miss → `knowledge_gaps` row inserted with correct workspace_id.
- Rate limit triggers 429 at 11th request in 60s.
- `allow_phi = false` blocks PHI-tier router branches with 403.
- Family role can read diet orders post-migration `233` but cannot read med orders.
- `ai_invocations` row written for every model call across all surfaces.
- Cron-secret functions reject missing/wrong header.

### E2E (Playwright, run with `--ui` gate)
- `/admin/executive/nlq` — "Who runs Homewood?" returns Charlene Elmore.
- Grace KB question returns a citation that deep-links to the doc page.
- Thumbs-down logs a gap and refreshes admin panel within 2 seconds.
- Haven Insight refuses ungrounded answer with refusal UX, not hallucination.
- Family user opening Grace from `/family` cannot see clinical tool answers.
- Caregiver shell dark mode preserves citation contrast (axe contrast ≥ 4.5:1).

### Observability
- Sentry edge SDK on router emits structured errors (test by throwing).
- `ai_invocations` count metric per org/day visible in Supabase logs.
- `structured-log` includes `trace_id` propagated from frontend `x-trace-id` header.
- Stale doc count > 0 after first staleness cron run.
- Token spend alert fires when daily org spend > $50.

---

## Risks & mitigations (consolidated)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PHI leak via tool layer | low | catastrophic | Cross-org test per RPC; security-review subagent gate; `SET search_path = public`; internal `WHERE organization_id =` |
| Hallucinated clinical citations | medium | high | Confidence threshold + refusal; two-source rule on clinical intents; eval suite; thumbs-down auto-gap |
| Cost blowout | medium | medium | Per-user + per-org rate limits; daily org token budget; Haiku for rerank; 5-turn tool loop cap |
| Router latency degrades UX | medium | medium | Classifier cache (5min TTL); speculative dispatch on low-confidence intent; p95 SLO < 2s |
| Migration history drift blocks remote deploy | high | medium | Migration `233` already needs owner repair before `supabase db push`; this roadmap adds 11 more migrations; bundle into 2–3 push windows with owner-supervised repair |
| Tool whitelist sprawl | medium | medium | Tier-1 capped at 13; Tier-2 requires owner sign-off; quarterly review |
| Vendor lock-in on Cohere rerank | low | low | Rerank module is pluggable; fallback to hybrid-only path proven in KB-NEXT-04 |

---

## Verification steps (one-time, owner-visible)

After each phase ships:

```bash
# Phase 0
curl -X POST https://app/api/haven-insight -d '{"question":"Who runs Homewood?"}' | jq .answer
# Expect substring: "Charlene Elmore"

# Phase 1
supabase db query "select count(*) from ai_invocations where created_at > now() - interval '1 hour' and metadata_json->>'function' = 'haven-ai-router'"
# Expect > 0 after admin uses Haven Insight once

# Phase 2
supabase db query "explain analyze select * from retrieve_evidence_hybrid('infection control', null, '<org_id>', 'owner', 8, null)"
# Expect HNSW + GIN index usage; total time < 400ms

# Phase 3
supabase db query "select kind, status, count(*) from kb_seed_targets group by 1, 2"
# Expect facility_card=5 published, employee_handbook=1 planned/drafted/published depending on owner progress

# Phase 4
open /admin/knowledge/admin/coverage
# Expect stale doc count > 0 after nightly run; per-module heatmap rendered
```

---

## Open questions for owner

1. **Phase 3 corpus ownership.** Who curates Employee Handbook / EP plans / MCO summaries? Suggest: COO owns operational SOPs, you own org/HR/policy, admin per facility owns EP plan. Confirm or revise.
2. **Token budget per org.** Default of $50/day/org enough for pilot? Multi-tenant pricing needs to fold this into plan tiers eventually.
3. **Rerank vendor.** Cohere Rerank v3 ($1/1K queries) vs Voyage rerank-2 ($0.50/1K). Either is BAA-eligible. Preference?
4. **Legacy endpoint retirement.** OK to retire `exec-nlq-executor` and `knowledge-agent` 60 days after KB-NEXT-01 ships, conditional on ≥ 99% router success?
5. **Eval Q/A set ownership.** Phase 5 (KB-NEXT-12) needs 100 curated Q/A pairs as gold standard. Can you produce 25 and assign each operational lead 25 more?
6. **PHI in KB.** Some seed targets (resident handbook excerpts, care SOPs) may contain identifiers. Confirm: redact at ingest by default, or rely on `documents.audience` and role-tiered RLS only?

---

## Mission alignment

**pass** — every segment strengthens resident safety, regulatory readiness, auditability, and owner visibility. AI remains subordinate to RLS, role gating, and citation-required answers. No segment ships a write path; no segment removes a human-in-the-loop.

---

## Changelog

- 2026-05-17 v1: Initial roadmap synthesized from four parallel readonly audits (AI surfaces, KB infrastructure, structured data + RLS, governance + UX).
