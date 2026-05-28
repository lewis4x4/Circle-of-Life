# Haven Insight — Conversation Threads · Architecture Design

**Date:** 2026-05-24
**Author:** JARVIS (Architecture lens)
**Surface:** `/admin/executive/nlq` (standalone page only — `HavenInsightPanel` ephemeral by design v1)
**Entry point:** `Circle-of-Life-repo/src/app/(admin)/executive/nlq/page.tsx`
**Companion review:** `docs/reviews/2026-05-24-haven-insight-portfolio-qa-design-review.md` (Phases A–D shipped)
**Concurrent design tracks (do not touch in this scope):** profile-menu diagnostic, profile-menu UX, hygiene/CI

---

## Executive summary

Phases A–D landed the conversational chrome — streaming, citations, follow-up chips, inline charts, slash palette, Cmd+K. What they did **not** land is the most basic affordance a 2026 LLM surface is expected to have: a thread that survives a page reload. Today every executive question is a write-only event — answered, dropped on the floor, forgotten. The CFO who got a brilliant occupancy breakdown at 10:42am has no way to find it at 3pm; the CEO can't bookmark a conversation; nobody can pin "Compliance scorecard for Q1" so it sits at the top of their sidebar all year. The schema (`exec_nlq_sessions`, migration 085) was designed as a per-question log, the router writes one row per call (`haven-ai-router/index.ts:300–360`), and the FE doesn't even pass `session_id` (`page.tsx:222–226`) — so the existing thread foundation is essentially unused.

This design ships **threads as the primary unit of work**: a persistent, RLS-scoped, role-aware notebook the executive can search, pin, rename, and resume from any device. The bar is ChatGPT, Claude.ai, Linear AI, Perplexity — and on five specific axes (citations as chips, follow-ups derived from grounded tool calls, role-scoped RLS, mobile-first sidebar via existing `Sheet` primitive, zero-latency auto-title) Haven will be ahead of all four for the senior-living-ops use case.

The work is **21–28 engineering hours** across 6 sub-phases (P0–P5), three of which can run in parallel. It is fully backward-compatible — the existing one-shot pattern in `HavenInsightPanel.tsx` keeps working untouched. Rollout is feature-flagged behind `NEXT_PUBLIC_HAVEN_THREADS_ENABLED` mirroring the proven `NEXT_PUBLIC_AI_ROUTER_ENABLED` pattern (`HavenInsightContext.tsx:36`).

---

## 1 · Schema (migrations needed)

### 1.1 Decision: separate `exec_nlq_messages` table — **not** jsonb on the session row

Four reasons relational beats jsonb here:

1. **Write amplification on append.** A jsonb array means every new turn re-serialises the entire prior conversation as a single UPDATE — at 12 turns × ~600 tokens of payload, that's a 7KB-per-write tax that grows linearly. A row insert is O(1).
2. **Race conditions during SSE.** The streaming path in `haven-ai-router/index.ts:401–467` already does multiple writes inside `start(controller)` — token emission, then a final `meta` event. Two SSE clients streaming on the same session (browser + iPad open simultaneously) would clobber each other's jsonb appends; an insert with a `(session_id, ordinal)` unique constraint won't.
3. **RLS granularity.** Postgres RLS operates on rows, not jsonb elements. A relational table lets us SELECT individual messages — which we'll want when message-level feedback ships (today's feedback is session-level per `245_exec_nlq_feedback.sql:9–13`; the next loop almost certainly wants per-answer rating).
4. **Search.** Full-text search on `to_tsvector(content)` with a GIN index is trivial on rows, awkward on jsonb (`jsonb_to_tsvector` works but loses position info).

The cost is one extra trigger (to maintain denormalised `last_message_at` + `message_count` on the session row for cheap sidebar ordering). That cost is paid once per insert.

### 1.2 New table `exec_nlq_messages`

| Column | Type | Rationale |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Stable handle for per-message feedback / re-render |
| `session_id` | `uuid NOT NULL REFERENCES exec_nlq_sessions(id) ON DELETE CASCADE` | Owning thread; cascade simplifies hard-delete (used only by ops cleanup, not user-facing) |
| `organization_id` | `uuid NOT NULL REFERENCES organizations(id)` | **Denormalised** — RLS predicates don't need a JOIN; mirrors how `chat_messages` denormalises (per the comment in `245_exec_nlq_feedback.sql:14`) |
| `role` | `text NOT NULL CHECK (role IN ('user','assistant','system'))` | `system` reserved for future rolling-summary insertion |
| `content` | `text NOT NULL CHECK (length(content) <= 50000)` | 50KB ceiling matches the router's 1024-output-tokens × 4-bytes worst case + headroom for tool-fact prepends |
| `ordinal` | `int NOT NULL CHECK (ordinal > 0)` | 1-based monotonic per-session position. **Unique with session_id.** Drives ORDER BY without a millisecond race on `created_at` |
| `ai_invocation_id` | `uuid REFERENCES ai_invocations(id) ON DELETE SET NULL` | Per-message audit link (today `exec_nlq_sessions.ai_invocation_id` is per-session — gets clobbered by every turn) |
| `citations` | `jsonb` | Array of `{label, href?, facility_id?, kind}` matching `NlqMessage.citations` shape (`page.tsx:30–35`) |
| `follow_ups` | `jsonb` | Array of strings ≤ 3 (matching `normalizeStringArray(value, 3)` at `page.tsx:117`) |
| `chart_spec` | `jsonb` | `{kind, series, x_label?, y_label?}` matching `ChartSpec` (`page.tsx:36`) |
| `intent` | `text` | Router intent classification (`router-intent.ts`) — enables "all my compliance threads" filtering later |
| `intent_confidence` | `numeric(4,3)` | Stored for the gaps loop |
| `tools_used` | `jsonb` | Array of strings — debug + telemetry |
| `fallback_used` | `boolean NOT NULL DEFAULT false` | Surface badge ("Fallback model — answer may be less precise" already exists at `page.tsx:553`) |
| `tokens_used` | `int` | Per-message (today `result_summary` is session-level — wrong) |
| `tokens_in` | `int` | Cost split for budget reconciliation |
| `tokens_out` | `int` | Cost split |
| `model_used` | `text` | `claude-sonnet-4-6` today; persisted so the gaps loop can A/B model swaps |
| `streamed` | `boolean NOT NULL DEFAULT false` | SSE vs JSON — useful for streaming-perf telemetry |
| `feedback` | `text CHECK (feedback IS NULL OR feedback IN ('positive','negative'))` | Per-message tri-state; mirrors `245_exec_nlq_feedback.sql:11` |
| `feedback_at` | `timestamptz` | |
| `feedback_note` | `text` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `deleted_at` | `timestamptz` | Soft delete; preserves audit retention even when user "redoes" a turn |

**Indexes:**

```sql
-- Thread fetch in turn order (the hottest read path).
-- Partial keeps the index small and supports index-only ORDER BY.
CREATE UNIQUE INDEX idx_exec_nlq_messages_session_ordinal
  ON exec_nlq_messages (session_id, ordinal)
  WHERE deleted_at IS NULL;

-- Org-scoped recency for telemetry / gaps-loop pooling.
CREATE INDEX idx_exec_nlq_messages_org_created
  ON exec_nlq_messages (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Negative-feedback pool (gaps loop) — partial keeps it tiny.
CREATE INDEX idx_exec_nlq_messages_negative_feedback
  ON exec_nlq_messages (organization_id, created_at DESC)
  WHERE feedback = 'negative' AND deleted_at IS NULL;

-- Search-within-thread (Phase 4).
CREATE INDEX idx_exec_nlq_messages_content_fts
  ON exec_nlq_messages USING gin (to_tsvector('english', content))
  WHERE deleted_at IS NULL;
```

### 1.3 `exec_nlq_sessions` enhancement columns

Migration 085 (`085_executive_intelligence_v2.sql:10–23`) shipped seven user-facing columns plus audit timestamps. Add nine more:

| Column | Type / default | Why |
|---|---|---|
| `last_message_at` | `timestamptz` | Sidebar sort key. Denormalised so the list query never JOINs messages. |
| `message_count` | `int NOT NULL DEFAULT 0` | Sidebar badge ("12 turns") + thread-length heuristics in the router. |
| `pinned_at` | `timestamptz` | Pinned-first sort. NULL = unpinned. |
| `archived_at` | `timestamptz` | Hidden from default sidebar; recoverable via "Archived" filter. Distinct from `deleted_at`. |
| `title_auto` | `boolean NOT NULL DEFAULT true` | Distinguishes auto-generated from user-edited titles — the auto-title regenerator skips manually-renamed threads. |
| `title_generated_at` | `timestamptz` | Lets us re-run auto-title after thread evolves significantly. |
| `last_intent` | `text` | Quick filter — "all my finance threads" sidebar segment in Phase 4. |
| `rolling_summary_text` | `text` | Compacted history once thread > 12 turns (see §2.3). |
| `rolling_summary_updated_at` | `timestamptz` | Stale-after threshold (re-summarise every 6 new turns). |
| `shared_with_org` | `boolean NOT NULL DEFAULT false` | **Ships in v1 but no UI** — column on day one so the eventual share-thread feature is purely additive. |

**Replace index** `idx_exec_nlq_sessions_user` (`085:29`) with a sidebar-shaped one:

```sql
DROP INDEX IF EXISTS idx_exec_nlq_sessions_user;

-- Sidebar query: pinned-first, then most-recent-active.
CREATE INDEX idx_exec_nlq_sessions_sidebar
  ON exec_nlq_sessions (
    organization_id,
    user_id,
    pinned_at DESC NULLS LAST,
    last_message_at DESC NULLS LAST
  )
  WHERE deleted_at IS NULL AND archived_at IS NULL;

-- Archived view (rare; tiny index).
CREATE INDEX idx_exec_nlq_sessions_archived
  ON exec_nlq_sessions (organization_id, user_id, archived_at DESC)
  WHERE deleted_at IS NULL AND archived_at IS NOT NULL;
```

### 1.4 Triggers (maintain denormalised counts atomically)

```sql
CREATE OR REPLACE FUNCTION public.haven_exec_nlq_messages_touch_session()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE exec_nlq_sessions
       SET last_message_at = NEW.created_at,
           message_count   = message_count + 1,
           last_intent     = COALESCE(NEW.intent, last_intent),
           updated_at      = now()
     WHERE id = NEW.session_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Soft-delete via UPDATE; only hard DELETE decrements (used by retention ops).
    UPDATE exec_nlq_sessions
       SET message_count = GREATEST(message_count - 1, 0),
           updated_at    = now()
     WHERE id = OLD.session_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tr_exec_nlq_messages_touch_session
  AFTER INSERT OR DELETE ON exec_nlq_messages
  FOR EACH ROW EXECUTE FUNCTION public.haven_exec_nlq_messages_touch_session();

-- Reuse the canonical helpers (085:112, 117).
CREATE TRIGGER tr_exec_nlq_messages_audit
  AFTER INSERT OR UPDATE OR DELETE ON exec_nlq_messages
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
```

### 1.5 RLS — and the org-admin-sees-CEO's-threads decision

The existing session policy (`085:61–84`) does this:
- **SELECT**: same org, not deleted, role ∈ {owner, org_admin} — but **no `user_id = auth.uid()` filter**. So today an org_admin can read any other org_admin's thread summary. This is fine when sessions are one-question logs; it is **not** fine when they become an executive's working notebook.

Design decision: **scope SELECT to the row owner by default**, with org-admin override gated by an opt-in column (`shared_with_org`) that ships but is unused in v1.

```sql
-- Drop the old session SELECT/UPDATE policies and re-create scoped to the user.
DROP POLICY IF EXISTS exec_nlq_sessions_select ON exec_nlq_sessions;
DROP POLICY IF EXISTS exec_nlq_sessions_update ON exec_nlq_sessions;

CREATE POLICY exec_nlq_sessions_select ON exec_nlq_sessions
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner','org_admin')
    AND (
      user_id = auth.uid()
      OR shared_with_org = true   -- Phase 2+ opt-in; default false
    )
  );

CREATE POLICY exec_nlq_sessions_update ON exec_nlq_sessions
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner','org_admin')
    AND user_id = auth.uid()       -- only the owner can rename / pin / delete
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin')
    AND user_id = auth.uid()
  );
```

Messages inherit:

```sql
ALTER TABLE exec_nlq_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY exec_nlq_messages_select ON exec_nlq_messages
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner','org_admin')
    AND EXISTS (
      SELECT 1 FROM exec_nlq_sessions s
       WHERE s.id = exec_nlq_messages.session_id
         AND (s.user_id = auth.uid() OR s.shared_with_org = true)
         AND s.deleted_at IS NULL
    )
  );

-- INSERT/UPDATE/DELETE only via SECURITY DEFINER RPCs in migration 275;
-- no direct FE writes. (Router writes via service-role key, bypassing RLS.)
```

**Why this design wins:** the CFO who opens a thread titled "Q3 EBITDA scenarios" can trust it's invisible to the CEO until they explicitly share. ChatGPT Workspace defaults to private workspaces but a "team mode" shares everything by default — Haven inverts that. SOC-2 auditors will love it.

### 1.6 Migration filenames

Last shipped migration: `273_slice1_p1_security_hardening.sql`. Next two slots:

- **`274_exec_nlq_threads.sql`** — messages table, sessions column additions, indexes, RLS, triggers
- **`275_exec_nlq_threads_rpc.sql`** — rename/pin/archive/delete RPCs (`SECURITY DEFINER` with explicit org-and-role re-check)

### 1.7 Soft-delete strategy

| Action | Session row | Message rows |
|---|---|---|
| User clicks Delete on thread | `deleted_at = now()` | unchanged — RLS already filters via the session predicate |
| User retries a question | n/a | new row inserted at `max(ordinal) + 1`; old `deleted_at = now()` |
| Retention sweep (>2 years) | hard DELETE → cascades messages | hard DELETE |
| User unarchives | `archived_at = NULL` | n/a |

No row is ever destroyed by a user-facing action. The audit trigger (`tr_exec_nlq_messages_audit`) means we have a hard log even for soft-deleted message bodies.

### 1.8 Acceptance criteria — schema

- [ ] `supabase db push` applies `274` and `275` cleanly against a fresh local clone
- [ ] Inserting a message bumps `last_message_at`, `message_count`, `last_intent` on the parent session in a single transaction
- [ ] Owner A cannot SELECT owner B's session (same org) until `shared_with_org = true`
- [ ] Service role can SELECT/INSERT freely (so the router's existing dual-write keeps working)
- [ ] Cascade behaves correctly: hard DELETE of session drops all message rows
- [ ] `idx_exec_nlq_sessions_sidebar` is used by the sidebar query (`EXPLAIN` shows index scan, not seq)
- [ ] Negative-feedback partial index is hit by the gaps-loop query

---

## 2 · Backend (haven-ai-router changes)

### 2.1 Append-to-thread vs create-thread logic

Today `persistRouterResponse` (`haven-ai-router/index.ts:255–360`) UPDATEs `exec_nlq_sessions` when `bodySessionId` is set, INSERTs otherwise. The replacement is two writes per turn — once to the session (status / last invocation), once to the messages table for each role.

```ts
// Inside persistRouterResponse, after resolving sessionId (existing logic stays):
const userOrdinal = await nextOrdinal(admin, sessionId);

await admin.from("exec_nlq_messages").insert([
  {
    session_id: sessionId,
    organization_id: organizationId,
    role: "user",
    content: question,
    ordinal: userOrdinal,
    streamed: wantsSse,
  },
  {
    session_id: sessionId,
    organization_id: organizationId,
    role: "assistant",
    content: dispatchResult.answer,
    ordinal: userOrdinal + 1,
    ai_invocation_id: aiInvocationId,
    citations: dispatchResult.citations,
    follow_ups: parsed.followUpSuggestions,
    chart_spec: parsed.chartSpec,
    intent: intent.intent,
    intent_confidence: intent.confidence,
    tools_used: dispatchResult.toolsUsed,
    fallback_used: !primaryIntentOnlyWhenSpeculative,
    tokens_used: dispatchResult.tokensUsed,
    tokens_in: dispatchResult.tokensIn,
    tokens_out: dispatchResult.tokensOut,
    model_used: dispatchResult.modelUsed ?? "claude-sonnet-4-6",
    streamed: wantsSse,
  },
]);
```

`nextOrdinal` is a tiny SQL helper that does `SELECT COALESCE(MAX(ordinal),0)+1 FROM exec_nlq_messages WHERE session_id = $1` — cheap given the `(session_id, ordinal)` unique index.

### 2.2 Auto-title — piggyback on the streaming finalizer, **never** a second LLM round-trip

Today the streaming finalizer (`haven-ai-router/index.ts:301–336`) already emits two XML metadata blocks — `<follow_ups>` and `<chart>` — that are stripped from the visible answer by `createMetadataAwareEmitter` (`index.ts:386–414`) and parsed out by `parseAnswerMetadata` (`index.ts:206–215`). Adding a third tag is a 20-token cost, runs in the same Anthropic stream, and lands the instant `[DONE]` arrives. ChatGPT's title generation visibly lags the first answer by 2-3s because they fire a second API call after streaming completes — we don't.

**Trigger:** only on the first assistant message per session (when `message_count == 0` at call time). Detected server-side by `await admin.from("exec_nlq_messages").select("id", { count: "exact", head: true }).eq("session_id", sessionId)`.

**Prompt addition** (inserted into the `system` block of `buildStreamingFinalizerPrompt`, `index.ts:362–384`):

> If this is the first turn of a new conversation, ALSO output:
> `<thread_title>{"title":"…"}</thread_title>`
> Title must be 4–8 words, Title Case, no quotes, no trailing punctuation, and summarise the topic the executive will recognise on returning to this thread tomorrow. Example: `Q3 occupancy by region`, `Sunny Acres incident review`, `AR aging next steps`.

**Fallback when the LLM forgets** (it will, ~5% of the time): first 60 chars of the question — same heuristic the router uses today (`index.ts:332–334`).

**User-rename interaction:** when a user renames the thread, set `title_auto = false`. The auto-title block is ignored on subsequent runs once `title_auto = false`. If they want to revert to auto-titles they'd need a "regenerate title" affordance — out of scope for v1.

### 2.3 Multi-turn context — sliding window + rolling summary

| Thread state | What goes into the dispatcher prompt |
|---|---|
| Turns 1–6 | Full conversation: every (user, assistant) pair |
| Turns 7–12 | Most recent 6 turns + a one-line "previously" gloss |
| Turns 13+ | `rolling_summary_text` + most recent 4 turns; re-summarise every 6 new turns |

**Token math.** Sonnet 4.6 input window is 200k. Average per-turn payload (after metadata strip): user ~80 tokens, assistant ~400 tokens. 6 turns ≈ 2,880 input tokens of history overhead vs. the router's existing ~4,000-token tool-fact prepends (per `formatFacilityFactsBlock` and KPI bundle). Total worst case: 7k input tokens per turn — well under both Sonnet's context and the $0.05 per-question reservation (`index.ts:51`).

**Summariser:** a Haiku call (cheap; ~$0.0001/turn) triggered server-side when `message_count > 12 && (message_count - rolling_summary_updated_message_count) >= 6`. Writes back to `exec_nlq_sessions.rolling_summary_text`. Async (non-blocking on the response stream); the next turn picks up the summary if available.

**Where context assembles:** new helper `loadConversationContext(admin, sessionId, organizationId)` in `supabase/functions/_shared/router-context.ts` returns `{ priorTurns: Array<{role, content}>, rollingSummary: string | null }`. Consumed by `dispatch()` (`router-dispatch.ts`) and by the streaming finalizer prompt builder.

### 2.4 New endpoints — mostly direct queries (RLS does the work)

The standard answer for "should this be a BE endpoint or a Supabase query?" in this codebase is: **direct query unless we need cross-tenant logic, a SECURITY DEFINER bypass, or an atomic multi-step write.** Threads need three of those.

| Operation | Surface | Rationale |
|---|---|---|
| **List user's threads** | Direct `from("exec_nlq_sessions").select(...).order(...)` | Pure RLS-scoped read. Pagination via `.range()`. Sort: `pinned_at DESC NULLS LAST, last_message_at DESC NULLS LAST` — matches `idx_exec_nlq_sessions_sidebar`. |
| **Fetch one thread's messages** | Direct `from("exec_nlq_messages").select(...).eq("session_id", id).order("ordinal")` | Pure RLS-scoped read. The `(session_id, ordinal)` unique index serves the ORDER BY. |
| **Rename thread** | RPC `rename_nlq_thread(p_session_id, p_title)` | Atomic: sets `title`, `title_auto = false`, `updated_at`. Re-checks owner inside `SECURITY DEFINER`. Title CHECK constraint (length 1–500 from `085:14`) enforced. |
| **Soft-delete thread** | RPC `delete_nlq_thread(p_session_id)` | Sets `deleted_at = now()`. Idempotent. |
| **Pin / unpin** | RPC `set_nlq_thread_pinned(p_session_id, p_pinned)` | Sets `pinned_at = now() OR NULL`. |
| **Archive / unarchive** | RPC `set_nlq_thread_archived(p_session_id, p_archived)` | Distinct from delete — recoverable, hidden from default sidebar. |
| **Search threads** | RPC `search_nlq_threads(p_query, p_limit)` | Cross-row tsvector search; returns top-N session ids ranked by `ts_rank` against concatenated message bodies. |

All RPCs follow this skeleton (re-asserts org + role + ownership even though SECURITY DEFINER bypasses RLS — defence in depth):

```sql
CREATE OR REPLACE FUNCTION public.rename_nlq_thread(p_session_id uuid, p_title text)
RETURNS exec_nlq_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row exec_nlq_sessions;
BEGIN
  IF haven.app_role() NOT IN ('owner','org_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE exec_nlq_sessions
     SET title = p_title,
         title_auto = false,
         updated_at = now()
   WHERE id = p_session_id
     AND organization_id = haven.organization_id()
     AND user_id = auth.uid()
     AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;
```

### 2.5 Backward compatibility

- **`HavenInsightPanel.tsx`** keeps its current ephemeral-conversation behaviour. It calls the router without `session_id`, the router creates a new session per question (existing path), the panel never reads `exec_nlq_messages`. **Zero changes** to `HavenInsightPanel.tsx` or `HavenInsightContext.tsx` in v1. The router's existing message dual-write means those sessions accumulate clean message rows — useful for telemetry even though the panel doesn't render them. If we want panel persistence later, it's a 30-line FE change (pass `session_id`, fetch on open).
- **Legacy `exec-nlq-executor`** (still the fallback when `NEXT_PUBLIC_AI_ROUTER_ENABLED=false` per `HavenInsightContext.tsx:36`) is **not** updated. Threads only exist when going through the router. The fallback path keeps the legacy "one row per question" semantics.
- **Existing one-shot questions on the NLQ page** continue working — until the FE starts passing `session_id`, the router creates a fresh session per question (which is what it does today). The feature flag flips the FE behaviour without requiring a router redeploy.

### 2.6 Auto-title prompt (final form, ready to paste)

Appended to the existing system prompt at `haven-ai-router/index.ts:367–380`:

```
If <is_first_turn>true</is_first_turn>, ALSO output a thread title block:
<thread_title>{"title":"..."}</thread_title>
The title must be 4–8 words, Title Case, no quotes, no trailing punctuation, and
summarise the topic the executive will recognise on returning to this thread
tomorrow. Examples: "Q3 Occupancy By Region", "Sunny Acres Incident Review",
"AR Aging Next Steps". If you cannot produce a clean title, omit the block.
```

The `<is_first_turn>` flag is included in the `user` block alongside the existing `<intent>`, `<tools_used>`, `<citations>` tags.

### 2.7 Acceptance criteria — backend

- [ ] Sending two questions with the same `session_id` produces a single thread row + four message rows (2 user + 2 assistant)
- [ ] First-turn answer arrives with `<thread_title>` block; sessions row has `title_auto = true` and a Title-Case title
- [ ] User rename via RPC sets `title_auto = false`; subsequent answers do NOT overwrite the title
- [ ] Thread > 6 turns: dispatcher prompt input shows sliding-window history (verified via `t.log` event `context_assembled`)
- [ ] Thread > 12 turns: `rolling_summary_text` is non-NULL within 1 turn of crossing the threshold
- [ ] Sending `session_id` for a thread owned by a different user returns a new session (cross-user safety)
- [ ] `HavenInsightPanel` still works unchanged — verified by running the existing E2E test against the deployed router

---

## 3 · Frontend (page + sidebar)

### 3.1 Component spec — `src/components/haven-insight/ConversationSidebar.tsx`

A new client component. Reads from `exec_nlq_sessions` directly via the Supabase browser client. Exposes one prop: `currentSessionId?: string | null`.

**Layout primitives:**

| Breakpoint | Treatment |
|---|---|
| `lg+` (≥1024px) | Persistent left rail, 280px expanded / 56px collapsed; toggle persisted to `localStorage["haven-sidebar-collapsed"]` |
| `<lg` | Hidden by default; `Sheet` drawer triggered from a hamburger in the page header — mirrors the proven mobile pattern in `executive-hub-nav.tsx:142–189` |

**Section order, top-to-bottom:**

1. Header row — "Conversations" title (`text-[13px] font-semibold tracking-tight text-foreground`) + collapse toggle + "+ New" Button (icon-only when collapsed)
2. Search input — `<input>` with `useDeferredValue`-debounced filter (300ms), 200-thread client-side cap; falls back to RPC `search_nlq_threads` when the query is non-empty and client-side returns < 3 hits
3. **Pinned** section eyebrow + items — only renders if `pinned_at IS NOT NULL` for ≥ 1 thread
4. **Today** / **Yesterday** / **This week** / **Earlier** sections — smart date labels; computed client-side from `last_message_at`
5. Empty state (zero threads): centred `MessageSquare` icon + "No conversations yet" + "Ask Haven a question to start your first thread." — copy matches the operator voice from the design review

**Per-thread item template:**

```tsx
<li role="option" aria-selected={isActive} className="group relative">
  <Link
    href={`/admin/executive/nlq?session=${thread.id}`}
    data-state={isActive ? "active" : "inactive"}
    className={cn(
      "flex h-10 items-center gap-2 rounded-md px-2 text-[13px]",
      "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:font-medium",
      "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-muted/40",
    )}
  >
    {thread.pinned_at && <Star className="size-3 shrink-0 text-amber-500 fill-amber-500" />}
    <span className="flex-1 truncate">{thread.title}</span>
    <span className="text-[10px] text-muted-foreground tabular-nums">{thread.message_count}</span>
  </Link>
  {/* Hover actions — visible on hover (desktop) or always (touch). */}
  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
    <Button variant="ghost" size="icon-xs" onClick={togglePin} aria-label={thread.pinned_at ? "Unpin" : "Pin"}>
      <Star className={cn("size-3", thread.pinned_at && "fill-current")} />
    </Button>
    <Button variant="ghost" size="icon-xs" onClick={confirmDelete} aria-label="Delete">
      <Trash2 className="size-3" />
    </Button>
  </div>
</li>
```

Visual reference points already shipped:
- Active/inactive state vocabulary: `executive-hub-nav.tsx:117–137` (`Sheet` drawer items) and `executive-hub-nav.tsx:84–96` (segmented control)
- `Button variant="ghost" size="icon-xs"` defined in `button.tsx:73–74`
- `Sheet` drawer pattern: `executive-hub-nav.tsx:142–189`
- 11px uppercase eyebrows: canonical across the executive surface — `nlq/page.tsx:521`, `nlq/page.tsx:570`, `standup/[week]/page.tsx:372`, `alerts/page.tsx:131`

**"+ New conversation" button:**

```tsx
<Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={startNewConversation}>
  <Plus className="size-3.5" />
  New conversation
</Button>
```

`outline` variant matches the hub-nav secondary action pattern; full-width left-aligned is the established sidebar CTA shape (compare `ExecutiveOverviewPageClient.tsx:259–276` page header).

### 3.2 Inline rename — click-to-edit

Clicking the thread title (NOT the link wrapper) enters edit mode:

```tsx
const [renamingId, setRenamingId] = useState<string | null>(null);

// In the item:
{renamingId === thread.id ? (
  <input
    autoFocus
    defaultValue={thread.title}
    onBlur={(e) => commitRename(thread.id, e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      if (e.key === "Escape") setRenamingId(null);
    }}
    className="flex-1 rounded-sm border border-input bg-background px-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
    aria-label="Rename conversation"
  />
) : (
  <button onDoubleClick={() => setRenamingId(thread.id)} className="flex-1 truncate text-left">
    {thread.title}
  </button>
)}
```

Double-click instead of single-click to enter rename mode — single-click is "navigate to thread", which is the 99% action. This mirrors Linear's project-name rename UX.

### 3.3 URL routing — `?session=<uuid>` as the source of truth

```tsx
// In page.tsx:
const searchParams = useSearchParams();
const router = useRouter();
const sessionParam = searchParams.get("session");
const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionParam);

// Hydrate messages when sessionParam changes (mount or sidebar click).
useEffect(() => {
  if (!sessionParam) {
    setMessages([]);
    return;
  }
  let cancelled = false;
  (async () => {
    const { data, error } = await supabase
      .from("exec_nlq_messages")
      .select("id, role, content, ordinal, citations, follow_ups, chart_spec, fallback_used, tokens_used, created_at, session_id")
      .eq("session_id", sessionParam)
      .order("ordinal", { ascending: true });
    if (cancelled) return;
    if (!error && data) setMessages(data.map(rowToNlqMessage));
  })();
  return () => { cancelled = true; };
}, [sessionParam, supabase]);

// After a successful send, update the URL to the new session_id (replace, not push).
useEffect(() => {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.id.length === 36 && last.id !== sessionParam) {
    router.replace(`/admin/executive/nlq?session=${last.id}`, { scroll: false });
  }
}, [messages, sessionParam, router]);
```

The router currently returns `session_id` in the SSE `meta` event (`haven-ai-router/index.ts:494–504`) and in the JSON body (`index.ts:611`) — both already wired through `applyAssistantMeta` (`page.tsx:262–306`) and `appendJsonAssistant` (`page.tsx:308–315`). No router changes needed for URL hydration.

The "+ New conversation" button clears the URL: `router.replace("/admin/executive/nlq")` + `setMessages([])`.

### 3.4 Realtime — ship in v1 because it's cheap and table-stakes

Supabase channels are ~free at this volume (per-user subscription, throttled refetch). Cross-tab sync (new thread on laptop appears on iPad without refresh) is the kind of detail that signals "this product was built for real use."

```tsx
useEffect(() => {
  if (!userId) return;
  const channel = supabase
    .channel(`nlq-threads:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "exec_nlq_sessions", filter: `user_id=eq.${userId}` },
      (payload) => {
        // Throttled refetch — at most once every 500ms.
        scheduleRefetch();
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [userId, supabase]);
```

### 3.5 Accessibility

- Sidebar is `<aside aria-label="Haven Insight conversations">`
- Thread list is `<ul role="listbox" aria-label="Conversations">` with each item `role="option" aria-selected={isActive}`
- Arrow keys (Up/Down) move focus through items via `onKeyDown` on the `<ul>`; Home/End jump to first/last; Enter activates (navigates); Delete prompts soft-delete
- Sidebar collapse toggle is a `Button` with `aria-expanded={!collapsed} aria-controls="haven-sidebar"`
- Rename input has `aria-label="Rename conversation"`; Esc cancels, Enter commits
- Empty state is announced via `role="status" aria-live="polite"`
- Mobile drawer follows the `Sheet` primitive's built-in focus trap (already wired in `executive-hub-nav.tsx:163–188`)

### 3.6 Page layout integration

Modify `page.tsx` minimally — wrap the existing flex column in a two-column layout:

```tsx
return (
  <div className="flex min-h-dvh w-full">
    <ConversationSidebar currentSessionId={activeSessionId} />
    <main className="flex flex-1 flex-col gap-6 lg:pl-[280px]">
      {/* existing header + conversation card unchanged */}
    </main>
  </div>
);
```

The sidebar is `position: fixed` on `lg+` (so it doesn't scroll with the chat), `position: absolute` inside a Sheet on `<lg`. `pl-[280px]` on the main reserves space; toggle to `pl-[56px]` when collapsed via a context value or state lifted to the page.

### 3.7 Acceptance criteria — frontend

- [ ] Sidebar renders threads sorted pinned-first, then by `last_message_at` DESC
- [ ] Clicking a thread navigates via `?session=<uuid>` and hydrates messages in < 300ms (single SELECT, indexed)
- [ ] "+ New conversation" clears the URL and the message buffer
- [ ] Inline rename commits on Enter / blur; Esc cancels
- [ ] Pin / unpin updates immediately (optimistic) and persists across page reload
- [ ] Delete soft-deletes and removes from sidebar without a full refetch
- [ ] Realtime: creating a thread in tab A surfaces in tab B's sidebar within 1s without refresh
- [ ] Below `lg`: sidebar is hidden; hamburger opens a Sheet drawer that uses the same component
- [ ] Keyboard: arrow keys move through threads; Enter activates; focus ring matches the rest of the executive surface
- [ ] Sidebar collapse state persists across reloads via `localStorage`

---

## 4 · Migration sequencing & rollout plan

Six discrete deploys, each independently revertible. The hard rule: **every step is backward-compatible with the previous one**, so a mid-deploy user never sees a broken page.

| # | What ships | What user sees | Backout |
|---|---|---|---|
| **0** | Migrations 274 + 275 only (no FE/BE code) | Nothing | Drop the two migrations |
| **1** | `haven-ai-router` redeploy with message dual-write + multi-turn context + auto-title | Same UX. Behind the scenes, `exec_nlq_messages` starts populating; titles improve | Roll back the edge function |
| **2** | Sidebar component + URL routing, gated on `NEXT_PUBLIC_HAVEN_THREADS_ENABLED=false` (default off); shipped to one internal owner via Netlify env override | Internal user gets the sidebar; everyone else sees today's page | Flip flag to false |
| **3** | Per-thread actions (rename / pin / archive / delete) wired to the RPCs from migration 275 | Internal user can pin / rename | Flip flag |
| **4** | Realtime + search + polished empty/loading states | Internal user sees cross-tab sync, search | Flip flag |
| **5** | Flag flip → `true` for all owners + org_admins; remove the gate after a week | All execs see threads | Flag flip back; revert removal commit |

**Feature flag pattern** mirrors the existing `NEXT_PUBLIC_AI_ROUTER_ENABLED` toggle in `HavenInsightContext.tsx:36`:

```ts
const THREADS_ENABLED = process.env.NEXT_PUBLIC_HAVEN_THREADS_ENABLED === "true";
```

Default off — explicit opt-in via Netlify env var per environment.

### 4.1 Telemetry plan

Every new event piggybacks on the existing `t.log()` structured logger (`withTiming` from `_shared/structured-log.ts`) for backend, and on the existing client-side analytics hook for frontend. Concretely:

**Server-side (`haven-ai-router`) — add fields to existing events:**

| Event | New fields |
|---|---|
| `router_completed` | `thread_message_count`, `is_first_turn`, `auto_titled`, `rolling_summary_used` |
| New: `thread_title_generated` | `session_id`, `title_length_chars`, `fallback_used` (when LLM forgot the block) |
| New: `rolling_summary_refreshed` | `session_id`, `prior_summary_chars`, `new_summary_chars`, `turns_since_last_summary` |
| New: `context_window_assembled` | `session_id`, `prior_turns_included`, `summary_included`, `total_history_tokens` |

**Client-side (page):**

| Event | Props |
|---|---|
| `haven_thread_created` | `module`, `intent`, `streamed` |
| `haven_thread_continued` | `turn_n`, `session_age_minutes` |
| `haven_thread_renamed` | `auto_to_manual: true`, `prev_title_chars`, `new_title_chars` |
| `haven_thread_pinned` | `from_sidebar: true` |
| `haven_thread_deleted` | `turn_count_at_delete`, `age_minutes` |
| `haven_thread_search` | `query_length`, `result_count`, `selected: bool` |
| `haven_thread_resumed_from_url` | `turn_count`, `age_minutes` |
| `haven_follow_up_chip_clicked` | `suggestion_index (0|1|2)`, `turn_n` (already partially in place from Phase D) |
| `haven_sidebar_collapsed_toggled` | `to_state: 'collapsed' | 'expanded'` |

**KPIs to validate adoption** (review at 7 / 30 / 90 days):

1. **Threads per active user / week** — target ≥ 2 by week 4. Below 1 means execs aren't returning.
2. **Average turns per thread** — target ≥ 3 by week 4. Below 1.5 means follow-ups aren't landing.
3. **Follow-up chip CTR** — target ≥ 15%. The chips are computed from grounded tools — they should be high-value.
4. **% of users with ≥ 1 pinned thread within 14 days** — target ≥ 30%. Pinning is the strongest retention signal.
5. **p50 time-to-first-token on turn 2+** vs turn 1 — should be within 10% (no perf regression from history hydration).
6. **Negative-feedback rate on multi-turn answers** vs single-turn — should DECREASE (context helps); if it increases, the sliding window needs widening.

---

## 5 · Out-of-scope (explicit deferrals)

| Item | Why deferred | When to revisit |
|---|---|---|
| **Cross-org / cross-user thread sharing** | `shared_with_org` column ships but no UI; HIPAA implications need a separate ADR | Q3 after v1 metrics stabilise |
| **Thread folders / tags** | YAGNI v1; jsonb tags column can be added in a 5-line migration when actual demand appears | After 100+ threads/user observed |
| **Export to PDF / Markdown** | Genuine ask but a 1-day project on its own; threads need to exist first | Once thread retention > 30 days proven |
| **Voice input** | iPad-first executives sometimes ask for it but mobile keyboard works fine v1 | Pilot with one CEO after v1 |
| **Thread merging / branching** | "Branch from this answer" is a Claude Pro feature; nice but not table-stakes | Watch CTR on follow-up chips first |
| **Message-level rating widget** | Schema supports it (per-message `feedback` columns ship in 274); session-level widget stays for v1 to keep the gaps loop running uninterrupted | Q3 |
| **Shared "starred prompts" library** | Different surface (org-level), different RLS shape | Separate design doc |
| **Side panel (`HavenInsightPanel`) thread persistence** | Panel is intentionally ephemeral / module-scoped; v1 cleanly separates the two surfaces | After standalone v1 lands |
| **Auto-archive of stale threads** | Manual archive ships; auto needs a clear policy (90d? 180d?) and a one-time backfill | After 6 months of data |

---

## 6 · Why this beats peer apps

Five opinionated decisions that put Haven Insight ahead of ChatGPT, Claude.ai, Linear AI, and Perplexity **specifically for the executive senior-living-ops use case**:

### 6.1 Citations as first-class chips, not muted footnotes

ChatGPT, Claude.ai, and Linear AI render citations as superscripts or end-of-message link lists; Perplexity does chips but they're brand-anchored web URLs. Haven's citations chip-link directly into **the executive's own underlying data** — facility detail page, incident report row, KPI source. Already shipped per `page.tsx:579–602`; threads make it shine because the same citation chip works whether you opened the thread today or three weeks ago. **No peer app does grounded-data chips at the chip-affordance level we ship.**

### 6.2 Follow-up chips computed from the answer's intent + tools, not from a generic suggester

ChatGPT's follow-ups are generic ("Tell me more about X"). Linear AI's are template-driven. Perplexity's are SEO-flavoured. Haven's are generated by the **same Sonnet finalizer call** that produced the answer, with full access to which tools fired and which facilities were referenced (`haven-ai-router/index.ts:301–336`, emission at `:498`). The chip "Compare Sunny Acres to Maple Grove on incident trend" appears because the router *knows* both facilities were in the result set — not because a template thought it would be a good idea. This is invisible to the user; the effect is chips that feel like they were written by someone who watched the question.

### 6.3 Role-scoped RLS — private by default, share is an opt-in

Every peer app in the consumer AI space ships threads as either "yours alone" (ChatGPT free) or "your team's shared workspace" (ChatGPT Enterprise, Claude Projects). Neither model fits a CFO who keeps a thread of EBITDA scenarios that an org_admin (e.g. an ops lead) absolutely should not stumble into. Haven defaults to `user_id = auth.uid()` SELECT — even between same-org owners — with `shared_with_org` as an opt-in for the cases where a CFO *does* want their finance lead to read along (§1.5). SOC-2 auditors will see private-by-default and check the box; consumer LLM apps with team-by-default will trigger questions.

### 6.4 Mobile-first sidebar via the existing `Sheet` primitive — same code path desktop and mobile

ChatGPT's iPad sidebar is its own codepath; Claude.ai's mobile menu drifts from desktop after every release. Haven's sidebar is one component that renders as a persistent rail on `lg+` and as a `Sheet` drawer below — using the **exact same** `Sheet` we use for the executive hub nav today (`executive-hub-nav.tsx:142–189`). Same focus trap, same animation curve, same close affordance, same `aria-*` shape. The Saturday-morning iPad portfolio check feels identical to the Monday-morning desktop one — because it is.

### 6.5 Auto-title runs on the same LLM call as the answer — zero added latency

ChatGPT's title generation visibly lags the first answer by 2–3s (you watch "New conversation" sit there after the answer lands; then it pops to a title). Claude.ai is even slower. Both fire a second API call after streaming completes. Haven piggybacks `<thread_title>` on the existing streaming finalizer (`haven-ai-router/index.ts:301–336` — same call that already emits `<follow_ups>` and `<chart>`), parsed by `parseAnswerMetadata` (`index.ts:206–215`), and emitted in the final `meta` SSE event. The title appears the **instant** `[DONE]` arrives. Zero additional latency, ~20 output tokens cost. This is the kind of detail nobody notices when present and everyone notices when absent.

### 6.6 (Bonus) Streaming + threading + grounded citations + inline charts in one bubble

No peer app in operations software composes all four affordances inside a single chat surface. Glean has citations; Perplexity has follow-ups; ChatGPT has threads; Linear AI has compact UX — Haven Insight has **all of them**, executed in the existing Quiet Operator design language, with one design system, one router, one auth model.

---

## 7 · Effort estimate

Six sub-phases. P0 is the blocker; P1 and P2 unlock in parallel; P3 / P4 then sequence behind P2. Total **21–28 hours** of focused engineering — calendar **3–4 working days** with one engineer, **2 days** if P1 (backend) and P2 (frontend) split across two.

| # | Sub-phase | Hours | Parallel? | Depends on |
|---|---|---|---|---|
| **P0** | Schema migrations 274 + 275 — messages table, sessions additions, indexes, RLS, triggers, RPCs | 3–4h | — | nothing |
| **P1** | Backend — `haven-ai-router` dual-write to `exec_nlq_messages`, append-on-`session_id`, `<thread_title>` block, sliding-window context, rolling-summary trigger | 5–7h | ✅ with P2 | P0 |
| **P2** | Frontend — `ConversationSidebar` component, `?session=` URL routing, hydrate-from-URL on mount, "New conversation" button, Sheet drawer for mobile | 5–6h | ✅ with P1 | P0 |
| **P3** | Per-thread actions — inline rename, pin / archive, soft-delete; wired to RPCs from 275 | 3–4h | sequential | P2 |
| **P4** | Realtime cross-tab sync, search bar with debounce, polished empty / loading / error states, sidebar collapse | 3–4h | sequential | P2 |
| **P5** | Telemetry instrumentation, feature-flag rollout to internal user, Cypress smoke test (load thread → ask question → resume from URL) | 2–3h | sequential | P3, P4 |

**Critical path:** P0 → P2 → P3 → P5 (15–19h, ~2 days solo). P1 fits inside that critical path with room to spare if a second engineer takes it.

**Recommended cadence:**
- Day 1 AM — P0 ships, validated locally
- Day 1 PM — P1 begins (one engineer), P2 begins (other engineer)
- Day 2 — P1 ships to staging; P2 ships behind flag
- Day 3 AM — P3 ships behind flag
- Day 3 PM — P4 ships behind flag
- Day 4 — P5 telemetry + internal pilot user; flag flip end of day after observation

---

## Closing note

The page works. Phases A–D made it look the part. This design makes it *act* the part — a thread is the unit of work, the executive's notebook of running portfolio questions, retrievable from any device, scoped tight by RLS, private by default, with auto-titles that arrive at the same instant as the answer and a sidebar that's the same component on iPad as on the 32-inch monitor. None of the choices above are speculative; every one of them maps to a pattern this codebase has already shipped — `Sheet` for mobile (`executive-hub-nav.tsx:142–189`), 11px uppercase eyebrows (`alerts/page.tsx:131`), RLS-via-`haven.organization_id()`-helpers (`085:64`), feature-flag-gated rollouts (`HavenInsightContext.tsx:36`), additive SSE meta events (`haven-ai-router/index.ts:494–504`). The work is small, the lift is mostly schema + sidebar + a 60-line dual-write in the router. The result will be the only operations-software AI surface in the senior-living space that an executive will reach for instinctively on day 30.
