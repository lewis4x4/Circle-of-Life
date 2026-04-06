# 24 — Executive Intelligence v2 (Phase 5)

**Module:** Executive Intelligence — NLQ session log, what-if scenarios, roadmap toward Realtime dashboards  
**Dependencies:** [`24-executive-intelligence.md`](24-executive-intelligence.md) (v1 `047`), [`068_ai_invocation_framework.sql`](../../supabase/migrations/068_ai_invocation_framework.sql) (`ai_invocations`)  
**Migration:** `085_executive_intelligence_v2.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/executive/nlq`, `/admin/executive/scenarios`

---

## Implementation note (repo migrations vs spec SQL)

Applied migration uses **`haven.organization_id()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log` per foundation migrations.

---

## Purpose (Core segment)

- **`exec_nlq_sessions`:** Per-user **natural-language query** attempts with optional link to **`ai_invocations`** (audit trail for model routing and `phi_class`). Stores a short **title**, **status**, optional **result_summary** (sanitized for UI), and **intent_json** (structured, non-PHI where possible).
- **`exec_scenarios`:** **What-if** assumption bundles (name, optional facility scope, **assumptions** JSON) for portfolio modeling — computation engines are **Enhanced / application-layer**.

**Non-goals (Core):** Executing NLQ against the warehouse in-app; Supabase Realtime channel wiring; Azure/OpenAI routing (see **`ai_invocation_policies`**).

---

## Scope tiers

### Core (this segment)

- Two tables + enum; RLS **owner / org_admin** only (aligned with **`ai_invocations`** read policy).
- Admin list + minimal create flows.

### Enhanced (defer)

- Edge Function: NLQ → validated SQL or API plan → `ai_invocations` row + session update.
- **Realtime** executive tiles: private channels + JWT claims mirroring RLS ([`README.md`](README.md) scale table).
- **facility_admin** read-only or scoped scenario access.

---

## RLS (normative)

- **`exec_nlq_sessions`:** `owner` and `org_admin` only; **INSERT** requires `user_id` and `created_by` = `auth.uid()`.
- **`exec_scenarios`:** `owner` and `org_admin` only; **INSERT** requires `created_by` = `auth.uid()`.

---

## Definition of done

- Migration `085` applies; types updated; `npm run segment:gates -- --segment "<id>" --ui` **PASS** for executive v2 routes.
