# P2 Cleanup Roadmap — 2026-05-24

**Scope:** Consolidates all outstanding P2 items from:
1. The [2026-05-24 UI/UX audit](../reviews/2026-05-24-haven-insight-threads-profile-menu-audit.md) — P2 items #29–43 plus P1-skipped items #8, #9, #12, #13, #14, #15/#20, #24, #25, #26, #27, #28
2. Security and performance findings from prior audit waves (verified against live codebase 2026-05-24)
3. FIX-C's explicit "P1s SKIPPED — follow-up needed" list

**Verification note:** All items confirmed present in the codebase as of 2026-05-24.  
**Four items confirmed already fixed — excluded from this roadmap:**

| Excluded | Status |
|---|---|
| Audit #6 — `window.confirm` for thread deletion | ✅ Fixed — `requestDelete` + `AlertDialog` in place |
| Audit #10 — Collapse button 24px touch target | ✅ Fixed — `size="icon-sm"` now used |
| Audit #11 — Sidebar search clear × button | ✅ Fixed — clear button with `aria-label="Clear search"` in DOM |
| Audit #40 — Redundant `className="size-9"` in IdentityAvatar | ✅ Fixed — `className` dropped, `size="md"` only |

---

## Wave Assignment Overview

| Wave | Focus | Files (exclusive — agents must not cross these boundaries) |
|---|---|---|
| **W1 — BE / Data** | Security hardening, auth correctness, DB integrity | `supabase/functions/_shared/**`, `supabase/migrations/277_p2_security_and_perf.sql` (new), `src/app/api/admin/**`, `src/contexts/haven-auth-context.tsx`, `src/components/haven-insight/InsightFeedback.tsx` |
| **W2 — FE Perf + Sidebar** | Performance, sidebar ARIA/UX, NLQ page polish | `src/components/haven-insight/ConversationSidebar.tsx`, `src/app/(admin)/executive/nlq/page.tsx`, `src/components/layout/UserMenu/user-menu-data.ts`, `src/components/layout/UserMenu/UserMenu.tsx`, `src/components/layout/UserMenu/UserMenuSheet.tsx` |
| **W3 — Profile + Polish** | Stub tabs, identity block, profile micro-UX | `src/app/(admin)/admin/profile/page.tsx`, `src/components/ui/identity-block.tsx` |

> **ROAD-04 cross-wave note:** W1 ships the new `set_nlq_message_feedback` RPC + rewrites `InsightFeedback.tsx`. The call-site in `nlq/page.tsx` (passing `messageId` not `sessionId`) must be updated by the **W2 agent** immediately when it opens that file. Coordinate: W2 agent reads `InsightFeedback.tsx` signature before editing `nlq/page.tsx`.

> **ROAD-06 cross-wave note:** W1 lifts `orgName` into `HavenAuthProvider`. W2 must consume from context instead of calling `useOrganizationName()`. W3 does the same in `profile/page.tsx`. W2 and W3 are **blocked** on ROAD-06 W1 landing before touching those call sites.

---

## Wave 1 — BE / Data Safety (7 items)

> Priority rule: security > auth correctness > data integrity > performance.  
> All DB changes go into a single migration `277_p2_cleanup.sql`.

### W1 Progress Tracker

| Item | Status |
|---|---|
| ROAD-01 | ✅ |
| ROAD-02 | ✅ |
| ROAD-03 | ✅ |
| ROAD-04 | ✅ |
| ROAD-05 | ✅ |
| ROAD-06 | ✅ |
| ROAD-07 | ✅ |

---

### ROAD-01 — [SEC] Executive refresh 503 response leaks server secret names to the browser

- **File:line** `src/app/api/admin/executive/refresh/route.ts:121`
- **Issue:** The 503 JSON body includes `missing: ["EXEC_KPI_SNAPSHOT_SECRET", ...]` — the names of unset env vars — visible to any authenticated browser that triggers the endpoint.
- **Fix:**
  ```typescript
  // Remove `missing` from the JSON response; keep logging on the server only
  console.error("[ExecutiveRefresh] missing env vars:", missing);
  return NextResponse.json(
    { ok: false, error: "Executive refresh is not configured on this server." },
    { status: 503 },
  );
  ```
- **Wave:** W1
- **Estimate:** S

---

### ROAD-02 — [SEC] `getSession()` reads unverified JWT from localStorage for role/org derivation

- **File:line** `src/contexts/haven-auth-context.tsx:46`
- **Issue:** `supabase.auth.getSession()` trusts the locally cached JWT without server verification. A tampered token can spoof `app_role` and `organization_id`, bypassing all role gates derived from `HavenAuthProvider`.
- **Fix:**
  ```typescript
  // Replace the getSession call with getUser (verifies JWT server-side):
  const { data: { user: u } } = await withSupabaseAuthLockRetry(
    () => supabase.auth.getUser()
  );
  setUser(u ?? null);
  // Remove setSession — session object is no longer needed for role derivation.
  // Drive all downstream logic from u directly (u?.id, u?.email, etc.).
  ```
- **Wave:** W1
- **Estimate:** M

---

### ROAD-03 — [SEC] `exec_nlq_messages` SELECT RLS policy excludes 6 roles the router allows

- **File:line** `supabase/migrations/274_exec_nlq_threads.sql:161–175` (fix in migration 277)
- **Issue:** The RLS SELECT policy on `exec_nlq_messages` only permits `('owner', 'org_admin')`. The router's `ALLOWED_ROLES` constant (`haven-ai-router/index.ts:62`) includes `clinical_admin`, `administrator`, `clinical`, `caregiver`, `family` — those users can POST questions and have messages inserted via service-role key, but can never SELECT their own messages back from the FE query. Their conversation history is silently empty.
- **Fix (migration 277):**
  ```sql
  DROP POLICY exec_nlq_messages_select ON public.exec_nlq_messages;

  CREATE POLICY exec_nlq_messages_select ON public.exec_nlq_messages
    FOR SELECT USING (
      organization_id = haven.organization_id()
      AND deleted_at IS NULL
      AND haven.app_role() IN (
        'owner','org_admin','clinical_admin','administrator',
        'clinical','caregiver','family'
      )
      AND EXISTS (
        SELECT 1 FROM public.exec_nlq_sessions s
        WHERE s.id = exec_nlq_messages.session_id
          AND s.organization_id = haven.organization_id()
          AND (s.user_id = auth.uid() OR s.shared_with_org = true)
          AND s.deleted_at IS NULL
      )
    );
  ```
  Also update the `canUse` gate in `nlq/page.tsx` (W2 agent) if the product intent is to open Haven Insight to more roles; leave it as-is if only owners/org_admins should access the page.
- **Wave:** W1
- **Estimate:** S

---

### ROAD-04 — [SEC] `InsightFeedback` writes session-level feedback instead of message-level

- **File:line** `src/components/haven-insight/InsightFeedback.tsx:27`
- **Issue:** The component updates `exec_nlq_sessions.feedback` (whole-session thumbs) instead of the specific `exec_nlq_messages` row. Repeated feedback on different messages overwrites prior values; per-message quality data is lost. The KB comment `KB-NEXT-10` confirms this is a known placeholder.
- **Fix (two-part):**
  1. **Migration 277** — new SECURITY DEFINER RPC:
  ```sql
  CREATE OR REPLACE FUNCTION public.set_nlq_message_feedback(
    p_message_id uuid,
    p_feedback    text  -- 'positive' | 'negative' | NULL
  ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    UPDATE public.exec_nlq_messages
       SET feedback    = p_feedback,
           feedback_at = now()
     WHERE id = p_message_id
       AND organization_id = haven.organization_id()
       AND session_id IN (
         SELECT id FROM public.exec_nlq_sessions
          WHERE user_id = auth.uid() AND deleted_at IS NULL
       );
  END;
  $$;
  GRANT EXECUTE ON FUNCTION public.set_nlq_message_feedback(uuid, text) TO authenticated;
  ```
  2. **`InsightFeedback.tsx`** — change prop from `sessionId: string` to `messageId: string`; replace the `.from("exec_nlq_sessions").update(…)` call with `.rpc("set_nlq_message_feedback", { p_message_id: messageId, p_feedback: newVal })`.
  3. **`nlq/page.tsx` (W2 agent)** — update the call site `<InsightFeedback sessionId={msg.id} />` → `<InsightFeedback messageId={msg.id} />`. The existing `msg.id.length === 36` UUID guard remains valid.
- **Wave:** W1 (RPC + component); W2 call-site update (coordinate before W2 touches `nlq/page.tsx`)
- **Estimate:** L

---

### ROAD-05 — [SEC] Profile API route logs raw error object containing potential PII

- **File:line** `src/app/api/admin/profile/route.ts:68`
- **Issue:** `console.error("[ProfileRoute] Failed to update profile", error)` dumps the raw caught value, which may contain Supabase error objects with user email, row data, or stack traces.
- **Fix:**
  ```typescript
  console.error(
    "[ProfileRoute] Failed to update profile",
    error instanceof Error ? error.message : String(error),
  );
  ```
- **Wave:** W1
- **Estimate:** S

---

### ROAD-06 — [PERF] `useOrganizationName` fires 3 identical `organizations.name` queries per page load

- **File:line** `src/components/layout/UserMenu/user-menu-data.ts:8`
- **Issue:** UserMenu desktop, UserMenuSheet, and the profile page each independently call `useOrganizationName(organizationId)`, each firing a separate `SELECT name FROM organizations WHERE id = ?` on mount — 3 identical round-trips for the same row on every page load.
- **Fix (two-part):**
  1. **W1 — `haven-auth-context.tsx`:** Add `const [orgName, setOrgName] = useState<string | null>(null)` to `HavenAuthProvider`. In the `load()` function, after the `user_profiles` query resolves, fetch `organizations.name` once and `setOrgName`. Expose `orgName` on the context value type.
  2. **W2 — consumers (`UserMenu.tsx`, `UserMenuSheet.tsx`):** Replace `const orgName = useOrganizationName(organizationId)` with `const { orgName } = useHavenAuth()`. Remove the `organizationId` prop drilling where `orgName` is the only consumer. The `user-menu-data.ts` hook can remain but is no longer called from these two files.
  3. **W3 — `profile/page.tsx`:** Same swap to `useHavenAuth()`.
- **Wave:** W1 (context lift) → W2/W3 consumer swap (blocked on W1 landing)
- **Estimate:** M

---

### ROAD-07 — [PERF] Two sequential DB round-trips on every AI query in `router-context.ts`

- **File:line** `supabase/functions/_shared/router-context.ts:38–80`
- **Issue:** `loadConversationContext` first queries `exec_nlq_sessions` for `(message_count, rolling_summary_text)`, then conditionally queries `exec_nlq_messages` for the recent history — two sequential PostgREST calls on the critical path of every Haven Insight question.
- **Fix (migration 277):** New SECURITY DEFINER RPC returning both in one shot:
  ```sql
  CREATE OR REPLACE FUNCTION public.get_nlq_conversation_context(
    p_session_id uuid,
    p_org_id     uuid,
    p_user_id    uuid,
    p_limit      int DEFAULT 6
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE
    v_session record;
    v_msgs    jsonb;
  BEGIN
    SELECT message_count, rolling_summary_text
      INTO v_session
      FROM public.exec_nlq_sessions
     WHERE id = p_session_id
       AND organization_id = p_org_id
       AND (user_id = p_user_id OR shared_with_org = true)
       AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT jsonb_agg(m ORDER BY m.ordinal)
      INTO v_msgs
      FROM (
        SELECT role, content, ordinal
          FROM public.exec_nlq_messages
         WHERE session_id = p_session_id
           AND organization_id = p_org_id
           AND deleted_at IS NULL
           AND role != 'system'
         ORDER BY ordinal DESC
         LIMIT p_limit
      ) m;

    RETURN jsonb_build_object(
      'message_count',        v_session.message_count,
      'rolling_summary_text', v_session.rolling_summary_text,
      'messages',             COALESCE(v_msgs, '[]'::jsonb)
    );
  END;
  $$;
  GRANT EXECUTE ON FUNCTION public.get_nlq_conversation_context(uuid, uuid, uuid, int)
    TO service_role;
  ```
  Update `router-context.ts` `loadConversationContext` to call `admin.rpc('get_nlq_conversation_context', { p_session_id, p_org_id, p_user_id, p_limit })` and parse the single `jsonb` response, replacing both queries.
- **Wave:** W1
- **Estimate:** L

---

## Wave 2 — FE Perf + Sidebar (20 items)

> Fix in priority order within the wave: A11y and keyboard issues first (affect all keyboard/AT users), then UX discoverability, then visual polish.  
> **Depends on ROAD-06 W1 for the `orgName` consumer swap (ROAD-26).**

### W2 Progress Tracker

| Item | Status |
|---|---|
| ROAD-08 | ✅ |
| ROAD-09 | ✅ |
| ROAD-10 | ✅ |
| ROAD-11 | ✅ |
| ROAD-12 | ✅ |
| ROAD-13 | ✅ |
| ROAD-14 | ✅ |
| ROAD-15 | ✅ |
| ROAD-16 | ✅ |
| ROAD-17 | ✅ |
| ROAD-18 | ✅ |
| ROAD-19 | ✅ |
| ROAD-20 | ✅ |
| ROAD-21 | ✅ |
| ROAD-22 | ✅ |
| ROAD-23 | ✅ |
| ROAD-24 | ✅ |
| ROAD-25 | ✅ |
| ROAD-26 | ✅ |
| ROAD-27 | ✅ |

---

### ROAD-08 — [A11y] Cmd+K global listener fires during IME composition and steals focus from other inputs

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:293`
- **Issue:** No `isComposing` guard — CJK/accented-character IME sessions get interrupted. Also no check that the event target isn't another text input (e.g. sidebar search), so Cmd+K from sidebar search jumps focus away mid-typing.
- **Fix:**
  ```typescript
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.repeat) return;
    if (
      event.target instanceof HTMLInputElement &&
      event.target !== inputRef.current
    ) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-09 — [A11y] Sidebar arrow-key navigation clamps at list boundaries instead of wrapping

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:407–412`
- **Issue:** `Math.min(currentIndex + 1, len - 1)` and `Math.max(currentIndex - 1, 0)` make ArrowDown on the last item and ArrowUp on the first item silently no-ops. Spec required wrapping.
- **Fix:**
  ```typescript
  // ArrowDown
  focusThreadByIndex((currentIndex + 1) % focusableThreadIds.length);
  // ArrowUp
  const len = focusableThreadIds.length;
  focusThreadByIndex((currentIndex - 1 + len) % len);
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-10 — [A11y] Each thread section renders its own `role="listbox"` — fragmented AT semantics

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:540`
- **Issue:** 2–5 separate `<ul role="listbox">` elements (one per time-group: Pinned, Today, Yesterday, etc.) make screen readers announce multiple independent listboxes for one conceptual conversation list. Selection state is also incoherent across sections.
- **Fix:** Drop `role="listbox"` from individual section `<ul>` elements. Wrap the full thread list area in a single container:
  ```tsx
  <div
    role="listbox"
    aria-label="Conversations"
    onKeyDown={handleListKeyDown}
  >
    {/* sections render <section> → <ul> (no role) → <li role="option"> */}
  </div>
  ```
  Move `onKeyDown` from each `<ul>` to this wrapper. Section `<ul>` elements drop the `role` and `aria-label` attributes; section eyebrows can use `aria-label` on a wrapping `<section>` for group context.
- **Wave:** W2
- **Estimate:** M

---

### ROAD-11 — [UX] Thread rename is invisible — double-click only, no button, no F2 binding

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:463` (onDoubleClick) + `400` (handleListKeyDown)
- **Issue:** The only trigger for rename is `onDoubleClick` on the thread button — no hover button affordance and no keyboard equivalent. The feature is effectively hidden from users who don't know to double-click.
- **Fix:** In the hover action group beside pin/delete (around line 494), add a third ghost button:
  ```tsx
  <Button
    type="button" variant="ghost" size="icon-xs"
    onClick={(e) => { e.stopPropagation(); setRenamingId(thread.id); }}
    aria-label="Rename conversation"
  >
    <Pencil className="size-3" aria-hidden />
  </Button>
  ```
  In `handleListKeyDown`, add: `else if (event.key === "F2" && currentId) { event.preventDefault(); setRenamingId(currentId); }`
- **Wave:** W2
- **Estimate:** M

---

### ROAD-12 — [A11y] Mobile sidebar sheet opens with focus on close button, not search input

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:583–592` (SheetContent)
- **Issue:** Radix Sheet's default initial focus lands on the first focusable element — the close button. Users who open the sidebar to search must Tab multiple times before they can type. Setting initial focus to the search input matches intent.
- **Fix:**
  ```tsx
  // Add a ref and override initial focus:
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  <SheetContent
    onOpenAutoFocus={(e) => {
      e.preventDefault();
      searchInputRef.current?.focus();
    }}
    …
  >
  // Wire ref to the search <input>:
  <input ref={searchInputRef} … />
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-13 — [A11y] Sidebar DOM order puts sidebar before main column in the tab sequence

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:594–596`
- **Issue:** The `absolute inset-y-0 left-0 z-30` sidebar renders earlier in DOM order than the main column. Tab from the page header routes into sidebar focusables before the main content — violating visual reading order and confusing screen-reader users.
- **Fix (preferred — option A):** In `nlq/page.tsx`, flip render order: main column first, sidebar second. Use CSS flex + `order-first` to maintain visual left-position:
  ```tsx
  <div className="relative flex min-h-dvh w-full flex-row-reverse">
    <ConversationSidebar … /> {/* DOM-last, visually left via order-first */}
    <main className="order-first flex flex-1 flex-col …">…</main>
  </div>
  ```
  Alternatively (option B): set `tabIndex={-1}` on the collapsed rail's focusables and add a "Skip to conversations" landmark in the page header.
- **Wave:** W2
- **Estimate:** M

---

### ROAD-14 — [A11y] Slash palette has no ARIA — screen readers get zero feedback

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:713–734`
- **Issue:** The slash-command popover has no `role="listbox"`, the textarea has no `role="combobox"`, `aria-expanded`, or `aria-activedescendant`. Keyboard nav functions but AT users receive no state announcements.
- **Fix:** Three attribute additions:
  ```tsx
  // On the <textarea>:
  role="combobox"
  aria-expanded={paletteOpen}
  aria-controls="haven-slash-palette"
  aria-autocomplete="list"
  aria-activedescendant={paletteOpen ? `slash-tpl-${paletteIndex}` : undefined}

  // On the popover container:
  id="haven-slash-palette"
  role="listbox"
  aria-label="Slash templates"

  // On each template <button>:
  role="option"
  id={`slash-tpl-${index}`}
  aria-selected={index === paletteIndex}
  ```
- **Wave:** W2
- **Estimate:** M

---

### ROAD-15 — [UX] UserMenu dropdown is fixed `w-[320px]` — overflows on 360px viewports

- **File:line** `src/components/layout/UserMenu/UserMenu.tsx:83`
- **Issue:** `w-[320px]` is hardcoded; on a 360px viewport with the avatar at the right edge, Radix repositioning may clip identity text or force an awkward horizontal shift.
- **Fix:**
  ```tsx
  className="w-[min(320px,calc(100vw-1.5rem))] …"
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-16 — [A11y] NLQ submit button missing `aria-label`; uses off-spec disabled opacity

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:736–743`
- **Issue:** The send button has no accessible name when only the icon is visible at narrow widths. `disabled:opacity-40` deviates from the codebase-wide standard of `disabled:opacity-50`.
- **Fix:**
  ```tsx
  aria-label={loading ? "Sending question" : "Send question"}
  // class change:
  disabled:opacity-40 → disabled:opacity-50
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-17 — [A11y] Typing indicator wrapper has no `aria-live` — state change never announced

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:742`
- **Issue:** `aria-label="Haven Insight is typing"` is on the inner dot row, but the outer wrapper has no `role="status"` or `aria-live`, so AT never reads the announcement. Also "is typing" implies a human — better copy is "is preparing an answer".
- **Fix:**
  ```tsx
  // Outer wrapper of the loading message bubble:
  <div className="flex gap-3 max-w-3xl" role="status" aria-live="polite">
    …
    <div … aria-label="Haven Insight is preparing an answer">
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-18 — [A11y] Citations block "Sources" label is a `<p>` — heading navigation skips it

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:649`
- **Issue:** `<p className="text-[11px] font-medium uppercase tracking-wider …">Sources</p>` is styled as a heading but semantically is a paragraph — screen reader heading navigation (`H` key) skips it.
- **Fix:**
  ```tsx
  <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
    Sources
  </h4>
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-19 — [Polish] Follow-up chip eyebrow has accidental `pl-0.5` misalignment

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:720`
- **Issue:** `<div className="pl-0.5">` puts the "Follow-up" eyebrow 2px off from the bubble's natural left edge — looks like an uncommitted leftover from layout experiments.
- **Fix:** Drop `pl-0.5`; the eyebrow should flush-align with the bubble's left edge.
- **Wave:** W2
- **Estimate:** S

---

### ROAD-20 — [Polish] Suggested-question cards don't equalize height at base (mobile) breakpoint

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:613`
- **Issue:** `sm:auto-rows-fr` only activates above 640px; at 320–360px with 2-line question text, card heights mismatch and the grid looks broken.
- **Fix:**
  ```tsx
  className="grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-2"
  ```
  (move `auto-rows-fr` to apply at all breakpoints)
- **Wave:** W2
- **Estimate:** S

---

### ROAD-21 — [Polish] Token-count pill lacks `tabular-nums` — digit widths jitter between turns

- **File:line** `src/app/(admin)/executive/nlq/page.tsx:645`
- **Issue:** `font-mono text-[10px]` on `{tokens} tokens` — mono doesn't guarantee tabular alignment in all browser/font-stack combinations; explicit utility does.
- **Fix:** Add `tabular-nums` to the class string.
- **Wave:** W2
- **Estimate:** S

---

### ROAD-22 — [Polish] "Conversations" sidebar heading is 13px; every other primary rail header is 14px

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:553`
- **Issue:** `text-[13px] font-semibold` on the sidebar `<h2>` is one step below the 14px floor used by all other primary section headers in the app.
- **Fix:** `text-[14px] font-semibold`
- **Wave:** W2
- **Estimate:** S

---

### ROAD-23 — [Polish] Pinned star icon in collapsed rail creates inconsistent rhythm

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:481–483`
- **Issue:** Collapsed pinned threads show an amber `Star`, unpinned threads show `MessageSquare` — two icon families in the same collapsed slot make the rail visually uneven.
- **Fix:** Always render `MessageSquare` in the collapsed state; layer a small amber dot when pinned:
  ```tsx
  <div className="relative">
    <MessageSquare className="size-3.5 shrink-0" aria-hidden />
    {thread.pinned_at ? (
      <span className="absolute bottom-0 right-0 size-1.5 rounded-full bg-amber-500" />
    ) : null}
  </div>
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-24 — [Polish] Empty-state text has jarring 2px size jump between adjacent lines

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:534`
- **Issue:** `text-sm font-medium` (14px) immediately followed by `text-[12px] leading-snug` — the 2px jump looks unintentional and breaks the tight empty-state rhythm.
- **Fix:**
  ```tsx
  // Primary line:
  <p className="text-[13px] font-medium text-foreground">No conversations yet</p>
  // Secondary line:
  <p className="text-[12px] text-muted-foreground leading-snug">…</p>
  ```
- **Wave:** W2
- **Estimate:** S

---

### ROAD-25 — [Polish] Pinned section `aria-label` conflicts with its visible eyebrow label

- **File:line** `src/components/haven-insight/ConversationSidebar.tsx:540`
- **Issue:** Visible eyebrow renders `"Pinned"` but the `<ul>` has `aria-label="Pinned conversations"` — AT double-announces the label as "Pinned conversations" then reads the visible "Pinned" text.
- **Fix:** Align both to the same string. Simplest: `aria-label={section.label}` (uses "Pinned" everywhere). Or display `"Pinned conversations"` as the eyebrow and match the `aria-label`.
- **Wave:** W2
- **Estimate:** S

---

### ROAD-26 — [PERF] `useOrganizationName` consumer swap in UserMenu files (depends on ROAD-06)

- **File:line** `src/components/layout/UserMenu/UserMenu.tsx` + `UserMenuSheet.tsx` + `user-menu-data.ts`
- **Issue:** After ROAD-06 lifts `orgName` into `HavenAuthProvider` context, the W2 consumer files still call `useOrganizationName(organizationId)` and fire their own queries.
- **Fix:** In both `UserMenu.tsx` and `UserMenuSheet.tsx`, replace:
  ```typescript
  const orgName = useOrganizationName(organizationId);
  ```
  with:
  ```typescript
  const { orgName } = useHavenAuth();
  ```
  Remove the `organizationId` prop drilling where `orgName` was the only consumer. The `user-menu-data.ts` hook can remain as an export for potential future use but is no longer called from these files.
- **Wave:** W2 (hard dependency on ROAD-06 W1 landing before this file is touched)
- **Estimate:** S

---

### ROAD-27 — [Polish] `Help & docs` renders `&amp;` HTML entity in desktop menu source

- **File:line** `src/components/layout/UserMenu/UserMenu.tsx:114`
- **Issue:** Desktop menu item has `Help &amp; docs` (escaped entity in JSX string literal), mobile `UserMenuSheet.tsx:123` has `Help & docs` — visually identical but source inconsistency makes diffs noisy.
- **Fix:** Use plain `Help & docs` in both files. JSX escapes the `&` automatically.
- **Wave:** W2
- **Estimate:** S

---

## Wave 3 — Profile + Polish (4 items)

> Touches only `profile/page.tsx` and `identity-block.tsx`. Zero file overlap with W1 or W2 — safe to run in parallel with W1 from Day 0. See execution order below.
>
> **ROAD-28 cross-wave note:** The "Notification preferences" link in `UserMenuSheet.tsx` (W2 file) routes to `?tab=notifications` which maps to a stub tab. W2 agent should hide or badge that link (`aria-disabled` + "Soon" label) in sync with W3 landing ROAD-28. Coordinate: W3 agent notifies W2 agent of the tab data structure change before W2 merges.

---

### ROAD-28 — [UX] Profile stub tabs are clickable links with no disabled state or "Soon" indicator

- **File:line** `src/app/(admin)/admin/profile/page.tsx:115–138`
- **Issue:** Notifications, Security, Sessions, and Preferences tabs navigate and render a "Coming soon" Card — a dead-end with no upfront signal. Users expect to interact with enabled-looking tabs.
- **Fix:** Add a `disabled` flag to the `PROFILE_TABS` config. In the tab render, swap non-functional tabs from `<Link role="tab">` to:
  ```tsx
  <span
    role="tab"
    aria-disabled="true"
    aria-selected={false}
    className={cn("… text-muted-foreground/50 cursor-not-allowed select-none")}
  >
    {tab.label}
    <Badge
      variant="secondary"
      className="ml-1.5 py-0 text-[9px] font-normal"
    >
      Soon
    </Badge>
  </span>
  ```
  Keep the currently active "Profile" tab as a `<Link>` with full interactivity. W2 agent: hide or match-badge the "Notification preferences" item in `UserMenuSheet.tsx` simultaneously.
- **Wave:** W3
- **Estimate:** M

---

### ROAD-29 — [UX] Profile save button label is static during save — no state feedback for AT

- **File:line** `src/app/(admin)/admin/profile/page.tsx:238–241`
- **Issue:** `{saving ? <Loader2 … /> : null} Save changes` — the text is always "Save changes"; screen readers don't announce the in-progress state.
- **Fix:**
  ```tsx
  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
  {saving ? "Saving…" : "Save changes"}
  ```
- **Wave:** W3
- **Estimate:** S

---

### ROAD-30 — [UX] Identity block shows `"Organization"` placeholder text when org name is loading or absent

- **File:line** `src/components/ui/identity-block.tsx:144` + `src/app/(admin)/admin/profile/page.tsx:234`
- **Issue:** `orgName?.trim() || "Organization"` and `value={orgName ?? "Organization"}` both display placeholder copy that looks like real data until the org query resolves — or permanently for edge-case accounts without an org name.
- **Fix:**
  - In `identity-block.tsx`: hide the org line entirely when falsy:
    ```tsx
    {orgName ? (
      <><Building2 className="…" aria-hidden /><span className="truncate">{orgName}</span></>
    ) : null}
    ```
  - In `profile/page.tsx:234`: `value={orgName ?? ""}` on the read-only Input. Empty is more honest than "Organization".
- **Wave:** W3
- **Estimate:** S

---

### ROAD-31 — [UX] Profile Role field is styled to look like an editable Input but isn't

- **File:line** `src/app/(admin)/admin/profile/page.tsx:219–221`
- **Issue:** `<div className="flex h-9 … border border-input bg-background px-3">` wraps a `<Badge>` in an Input-shaped container. Users will attempt to click and edit the role — and nothing happens. The Email field below uses a true `<Input readOnly disabled>` for the same "read-only" pattern; Role should match.
- **Fix:** Drop the fake-input wrapper. Either:
  ```tsx
  {/* Option A — match Email's disabled Input treatment: */}
  <Input value={roleConfig.roleLabel} readOnly disabled />
  ```
  or just render the Badge under the Label without any chrome:
  ```tsx
  <Badge variant="default">{roleConfig.roleLabel}</Badge>
  ```
- **Wave:** W3
- **Estimate:** S

---

## Deferred Items (Not in These Waves)

| Item | Rationale for deferral |
|---|---|
| Audit #13 — `clamp` height math for chat container | Mobile-only layout edge case; medium complexity. Defer to a dedicated mobile layout pass after W2. |
| Audit #41 — `ExecutiveHubNav` hidden on mobile | L-sized new feature (dropdown nav variant); touches `nlq/page.tsx` same as W2 — schedule as a follow-on mobile-nav spike to avoid W2 collision and scope creep. |

---

## Suggested Execution Order

**Recommendation: run W3 in parallel with W1; gate W2 on W1 landing.**

```
Day 0 ┌── W1 launches (security + perf, 7 items)
      └── W3 launches in parallel (profile + polish, 4 items — zero file overlap)

Day 1 ── W1 merges → migration 277 deployed → HavenAuthProvider exposes orgName
      └── W2 launches (FE perf + sidebar, 20 items — now unblocked by ROAD-06)

Day 2 ── W2 merges → final integration review
```

**Rationale:**

1. **W3 is free parallelism.** It touches only `profile/page.tsx` and `identity-block.tsx` — no overlap with W1 or W2. Running it from Day 0 gets 4 items done for free while W1 works.

2. **W2 is blocked on ROAD-06.** The `useOrganizationName` consumer swap (ROAD-26) requires `HavenAuthProvider` to expose `orgName` first. Launching W2 before W1 lands means the W2 agent either duplicates the old hook or ships in two commits with a mid-PR refactor — more collision risk than a one-day wait.

3. **ROAD-04 requires explicit W1→W2 handoff.** W1 ships the `set_nlq_message_feedback` RPC and rewrites `InsightFeedback.tsx` prop signature. W2 agent must update the `<InsightFeedback messageId={msg.id} />` call site in `nlq/page.tsx` when it opens that file. Recommend: W1 agent leaves a `// TODO-W2: update InsightFeedback call site here` comment at line 717 of `nlq/page.tsx` so W2 agent cannot miss it.

4. **Security items (ROAD-01–05) are highest leverage.** Fix them first within W1 before touching perf items. A single missed env-var check (ROAD-01) affects every org with an incomplete server config; the auth JWT issue (ROAD-02) affects every authenticated session.

---

*Generated 2026-05-24. Source: live codebase verification + [2026-05-24 UI/UX audit](../reviews/2026-05-24-haven-insight-threads-profile-menu-audit.md).*
