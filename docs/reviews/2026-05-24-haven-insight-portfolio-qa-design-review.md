# Haven Insight — "Portfolio Q&A" Page · Design / UX Review

**Date:** 2026-05-24
**Reviewer:** JARVIS (Design lens)
**Surface under review:** `/admin/executive/nlq`
**Entry point:** `Circle-of-Life-repo/src/app/(admin)/executive/nlq/page.tsx`
**Sibling for cohesion reference:** `Circle-of-Life-repo/src/components/executive/ExecutiveOverviewPageClient.tsx`
**Companion review (concurrent):** code/a11y/dead-code audit by separate agent — this report intentionally avoids that lens.

---

## 🟢 LIVE PROGRESS TRACKER — Orchestrated Campaign

> This section is updated by the orchestrator as each phase completes. Sub-agents reading this report should consult this section to see what's already shipped.

| Phase | Description | Status |
|-------|-------------|--------|
| **A** | 10 quick wins (Quick wins section below) | ✅ shipped 2026-05-24 |
| **B** | Structural & naming (P0-2, P0-3, P0-4, P1-1, P1-4, P1-6, P2-7, B2) | ✅ shipped 2026-05-24 |
| **C** | Router cutover + citations + feedback widget (P0-1, P1-9, P2-5) | ✅ shipped 2026-05-24 |
| **D** | Streaming + multi-turn + inline charts (S-1, S-2, S-3, S-5) | ✅ shipped 2026-05-24 |
| **D1** | Backend: haven-ai-router SSE streaming + follow_up_suggestions + chart_spec (backward-compatible) | ✅ shipped 2026-05-24 (requires `supabase functions deploy haven-ai-router --project-ref manfqmasfqppukpobpld`) |
| **D2** | Frontend: streaming reader, follow-up chips, chart slot, `/` palette, Cmd+K | ✅ shipped 2026-05-24 |

**Campaign complete.** All 4 phases shipped. User must deploy: (1) `git push` Next.js changes for Netlify auto-deploy, (2) manual `supabase functions deploy haven-ai-router` for streaming/follow-ups/charts to activate. Without (2), FE falls back to JSON path which still works (additive fields just absent).

Sub-agent boundary rule: only touch items inside your assigned phase. If you find issues outside your phase, note them at the bottom of this tracker but do not implement.

---

## Executive summary

The Portfolio Q&A page is functionally complete but reads as a prototype that was wired up before the design system caught up with it. Three core problems make it feel underbaked: (1) it's **named four different things** in five places ("Insight", "Haven Insight", "Portfolio Q&A", "What would you like to know?", `/nlq/`) so users don't know what surface they're on; (2) it's the **only executive page missing `<ExecutiveHubNav />`**, severing it from the rest of the executive hub and forcing a `← Back to Executive Overview` breadcrumb to do navigation work the segmented tab strip already does on every peer page; and (3) the **answer body is the page's reason to exist**, but the empty state is dressed up while the response surface itself has no source attribution, no feedback widget, no streaming, and no chart slot — even though the upstream router (`haven-ai-router`) **already returns `citations`, `intent`, `tools_used`, `fallback_used`** that the UI silently discards. The visual chrome (nested cards, drifted radii, three competing headings, an always-visible "Clear conversation" link on an empty conversation, and a sticky-looking input that isn't actually sticky) is fixable in an afternoon. The deeper redesign of the conversation surface is a 1–2 day investment that will close the credibility gap with the rest of the executive area.

---

## Strengths

- **Suggestion-chip empty state is the right pattern** for an LLM surface — six concrete portfolio questions immediately teach scope and lower activation energy. The questions themselves are well-chosen and span the six executive lanes (occupancy, incidents, AR, infection control, certifications, compliance).
- **Loading copy is operator-grade** — "Analyzing your portfolio data…" with a spinner reads as competent, not consumery (`page.tsx:198–207`).
- **Auth gate fails closed and quietly** — the `appRole === "owner" || "org_admin"` check on mount degrades to a small warning card rather than crashing the route (`page.tsx:64–73, 138–145`).
- **Message-buffer cap (`MAX_MESSAGES = 50`)** is a thoughtful guardrail that other chat UIs forget (`page.tsx:43, 95, 113, 124`).
- **Token-counter telemetry is present** — useful for debugging cost, even if it shouldn't be in the executive's view (`page.tsx:188–190`).

---

## Issues — Prioritized

### P0 — fix before this ships to a customer

#### P0-1 · The router's structured answer payload is silently dropped

**Severity rationale:** This is the single biggest reason the page feels "underbaked." The `haven-ai-router` returns `citations`, `intent`, `intent_confidence`, `tools_used`, and `fallback_used` per the contract documented at `src/lib/haven-insight/HavenInsightContext.tsx:33–36`. The standalone NLQ page calls `exec-nlq-executor` directly (which is the legacy non-router executor) and throws away anything beyond `answer` / `tokens_used`. Executives reading an AI answer about their own portfolio with **zero source attribution** will not trust the system — they will assume the answer is hallucinated.
**File:line:** `page.tsx:88–110` (response mapping); type `NlqMessage` at `page.tsx:22–29`.
**Recommendation:** Route the standalone page through `haven-ai-router` (the same edge function the side panel uses), extend `NlqMessage` with `citations?: Array<{ label: string; href?: string; facility_id?: string }>`, `intent?: string`, `tools_used?: string[]`, `fallback_used?: boolean`, and render a small **"Sources" rail** below each assistant message — chip-style links to the underlying facility / report / KB doc. Visual reference: 11px uppercase eyebrow + a row of `h-6 rounded-md border bg-secondary/50 px-2` chips, same vocabulary as the heat-map eyebrows on `ExecutiveOverviewPageClient.tsx:680`.

#### P0-2 · Naming chaos across one page

**Severity rationale:** Five different names for one surface destroys product confidence. The hub-nav calls it "**Insight**" (`executive-hub-nav.tsx:32`). The page H1 calls it "**Haven Insight**" (`page.tsx:151`). The section H2 calls it "**Portfolio Q&A**" (`page.tsx:157`). The empty-state H3 asks "**What would you like to know?**" (`page.tsx:164`). The URL is `/nlq`. Marketing voice ("What would you like to know?") collides with operator voice ("Portfolio Q&A") inside the same card.
**File:line:** `executive-hub-nav.tsx:32`, `page.tsx:151–155`, `page.tsx:157`, `page.tsx:164`.
**Recommendation:** Pick **one** brand name and one section label, and use them everywhere:
- **Hub-nav tab:** rename to "**Haven Insight**" (matches the H1 and the side-panel header on `HavenInsightPanel.tsx:46`).
- **Page H1:** "Haven Insight" — keep.
- **Subtitle:** swap "Ask questions about your portfolio in plain English" → "**Portfolio Q&A — natural-language answers grounded in your live operational data.**"
- **Delete the nested `RecordDetailSection title="Portfolio Q&A"`** — it's the only thing on the page so the H2 is redundant chrome (see P0-3).
- **Empty-state H3:** "What would you like to know?" → "**Start with a portfolio question**" (operator voice, sentence case, matches the "Executive watchlist" / "Portfolio health" cadence of the Overview).

#### P0-3 · Wrong primitive: `RecordDetailHeader` + `RecordDetailSection` for a chat surface

**Severity rationale:** `RecordDetailHeader` is documented as a page-level header for **entity record pages** — "Attio 50% · Mercury 25% · Stripe 15% · Linear 10%" per `RecordDetailHeader.tsx:8–13`. The `h1` is sized at `text-2xl md:text-3xl` (24/30px), which works for "Mary Johnson · MRN 048213" but reads as marketing-poster size for a tool surface where the input box is the real primary element. Meanwhile, **`RecordDetailSection` is explicitly documented as not-for-nesting** ("Nested cards are forbidden. Choose one container." — `RecordDetailSection.tsx:36–37`), yet the empty state nests another `bg-card` card inside it at `page.tsx:163`. This is a documented anti-pattern.
**File:line:** `page.tsx:150–156`, `page.tsx:157`, `page.tsx:163`.
**Recommendation:** Match the sibling pattern from `ExecutiveOverviewPageClient.tsx:259–276`:
```tsx
<div className="flex flex-col gap-6">
  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
    <div className="min-w-0">
      <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
        Haven Insight
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Portfolio Q&A — natural-language answers grounded in your live operational data.
      </p>
    </div>
    <div className="hidden md:block"><ExecutiveHubNav /></div>
  </div>
  {/* one single card — the conversation surface — no nested RecordDetailSection */}
  <div className="rounded-[var(--radius)] border border-border bg-card shadow-[var(--shadow-card)] flex flex-col h-[calc(100dvh-220px)] min-h-[520px]">
    {/* messages */}
    {/* input row */}
  </div>
</div>
```
This drops the `← Back to Executive Overview` breadcrumb (the hub-nav replaces it), eliminates the nested card, brings the H1 to 20px to match Overview, and gives the conversation a single bounded card with a real bottom-sticky input.

#### P0-4 · `<ExecutiveHubNav />` is missing — every other executive page renders it

**Severity rationale:** The NLQ page is the **only executive page that omits the hub nav** — confirmed via grep: `alerts/page.tsx:119`, `facility/[id]/page.tsx:137`, `reports/page.tsx:494`, `settings/page.tsx:139`, `standup/page.tsx:160`, `standup/[week]/page.tsx:294`, `standup/compare/page.tsx:123`, `standup/history/page.tsx:146`, and `ExecutiveOverviewPageClient.tsx:269` all render `<ExecutiveHubNav />`. The NLQ page is dead-ended — once you land on it, the only way out is the back-link breadcrumb.
**File:line:** add at `page.tsx:148` (after the loading/unauthorized guards, inside the main return).
**Recommendation:** Render `<ExecutiveHubNav />` in the same position as Overview (right-aligned in the header row, `hidden md:block`). Remove the `backLink` prop on the header — the active tab in the nav strip is the canonical "you are here" affordance.

---

### P1 — fix in the next sprint

#### P1-1 · Six suggestion chips wasting half the viewport stacked vertically

**Severity rationale:** On a 1440×900 executive laptop, the empty state renders six 33px-tall chips stacked in a single column inside a `max-w-2xl` card, then leaves ~400px of dead whitespace above the input. The chips are short, scannable strings (avg ~50 chars) — they belong in a 2-column grid on tablet and 3-column on desktop. Current treatment makes the page feel hollow.
**File:line:** `page.tsx:166–179` — the `<ul className="mt-4 grid gap-1.5">`.
**Recommendation:** Change to `<ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">` and lift chip min-height from `33px` (drifted) to `h-9` (canonical). Also add a 11px uppercase eyebrow above the grid: `<p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Try a question</p>` to match the eyebrow vocabulary used everywhere in the Overview (`ExecutiveOverviewPageClient.tsx:478`, `:494`, `:529`).

#### P1-2 · Radius drift: `rounded-[8px]` / `rounded-[9px]` instead of canonical `--radius` (10px)

**Severity rationale:** The design system canonical radius is `--radius: 0.625rem` → 10px, consumed by `Button`, `Input`, `.surface-card`, `.surface-panel` (`globals.css:164`). The NLQ page uses **three different radii** in arbitrary values — `rounded-[8px]` on the empty-state card and suggestion chips and avatar squares (`page.tsx:163, 173, 184, 218, 224`), `rounded-[9px]` on message bubbles (`page.tsx:189, 203`), and `rounded-xl` is not used here but is the wrong value for operator chrome (28px). This drift will visibly cause the chips and bubbles to look "off" next to a `Button`.
**File:line:** `page.tsx:163, 173, 184, 189, 203, 218, 224`.
**Recommendation:** Global find/replace: `rounded-[8px]` → `rounded-[var(--radius)]` and `rounded-[9px]` → `rounded-[var(--radius)]`. There is no design reason for the +1px bubble variant; it's almost certainly a copy-paste artifact.

#### P1-3 · "Clear conversation" link is visible with zero messages

**Severity rationale:** Confirmed bug — the button at `page.tsx:241–246` is unconditionally rendered. Clicking it on an empty conversation calls `setMessages([])` on an already-empty array, which does nothing user-visible but advertises a control that has no effect. It also clutters the bottom of the empty state with redundant chrome.
**File:line:** `page.tsx:241`.
**Recommendation:** Gate the entire button container on `messages.length > 0`:
```tsx
{messages.length > 0 && (
  <div className="flex items-center justify-center gap-4 mt-3">
    <button onClick={() => setMessages([])} className="...">
      <RotateCcw className="w-3 h-3" /> Clear conversation
    </button>
  </div>
)}
```
While you're in there, bump the font from `text-[10px]` (which is sub-readable) to `text-[11px]` to match the eyebrow scale.

#### P1-4 · Input row pretends to be sticky but isn't

**Severity rationale:** The input row sits at the bottom of `RecordDetailSection` (which is `min-h-[620px] flex-1 flex-col`), so it **looks** sticky on first paint. But as the conversation grows past the section height, the input scrolls away with the messages — there's no `sticky bottom-0` on the input container. Users expect the input to stay docked.
**File:line:** `page.tsx:217–248` (the input row container) — currently `<div className="border-t border-border bg-card px-[14px] py-[14px]">` with no sticky positioning.
**Recommendation:** Convert the conversation surface to a real flex column with `overflow-y-auto` on the messages region and `flex-shrink-0` on the input row. The card itself should be height-constrained (`h-[calc(100dvh-220px)] min-h-[520px]`) so the input is anchored to the visible bottom of the card. Already partially set up by `flex-1 overflow-y-auto` on the messages container at `page.tsx:158` — just needs the parent card height constrained.

#### P1-5 · No streaming response — answers appear all-at-once after a 5–15s pause

**Severity rationale:** The current pattern is: spinner with "Analyzing your portfolio data…" → wait → full answer appears. For LLM responses that can take 8–12s on a multi-tool query, this destroys the perception of intelligence. Every modern executive AI tool (ChatGPT enterprise, Glean, Hebbia, Pulse) streams. Without streaming, the wait feels like a hang.
**File:line:** `page.tsx:87–108` — the `fetch` → `res.json()` → `setMessages` flow is one-shot.
**Recommendation:** Strategic — see below. Short term, add a 3-state spinner that cycles through ("Reading your data…", "Cross-checking facilities…", "Drafting your answer…") on a 3s rotation so the wait feels intentional. The illusion of progress is better than a frozen spinner.

#### P1-6 · Assistant avatar is a square with `<MessageSquare />`; user avatar is a square with the text "You"

**Severity rationale:** Putting the literal word "You" inside a 32×32 square is awkward and crowds the bubble. Most chat UIs either (a) use a real user avatar / initial, (b) drop the user avatar entirely and rely on right-alignment, or (c) put the role label in 10px uppercase above the bubble. The current treatment reads as a placeholder ("we'll figure out the avatar later").
**File:line:** `page.tsx:181–186`.
**Recommendation:** Drop the user avatar entirely. Right-align the bubble (already done at `page.tsx:177`), give it the primary color treatment (already done at `page.tsx:191`), and trust the alignment. For the assistant, keep `<MessageSquare />` but consider a Haven-branded mark (a single uppercase "H" in primary on a `bg-primary/10` background) to reinforce brand on the surface that **is** the brand. While there, change `w-8 h-8` → `size-8` to match the codebase's preferred shorthand (used throughout `executive-hub-nav.tsx`).

#### P1-7 · Suggestion chips have no visible focus ring

**Severity rationale:** Accessibility issue but also visual — keyboard-only users tabbing through the empty state have no idea which chip is active. The chip styling at `page.tsx:170–175` defines only `transition-colors hover:bg-muted/40 hover:text-foreground` — no `focus-visible:ring-2 focus-visible:ring-ring`. Compare to the canonical Button at `src/components/ui/button.tsx:43` which always carries `focus-visible:ring-3 focus-visible:ring-ring/50`.
**File:line:** `page.tsx:170–175`.
**Recommendation:** Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` to the chip className. Same fix applies to the "Clear conversation" button at `page.tsx:243`.

#### P1-8 · Token counter shown to executives

**Severity rationale:** `47 tokens` (or whatever) is engineer telemetry, not exec-grade copy. Executives looking at an AI answer about their portfolio do not benefit from seeing the model's token consumption — it implies cost-anxiety on a workflow they're supposed to feel confident using.
**File:line:** `page.tsx:188–190`.
**Recommendation:** Hide the token counter behind a `?dev=1` query param or a feature flag. Replace the visible affordance with the **actually useful** metadata: timestamp + sources count. E.g. `<p className="text-[10px] text-muted-foreground mt-2">Drawn from 47 facilities · {formatRelative(msg.timestamp)}</p>`.

#### P1-9 · No feedback widget on the standalone page

**Severity rationale:** The side-panel `HavenInsightPanel.tsx:140–185` already implements 👍/👎 feedback wired to `exec_nlq_sessions.feedback`. The standalone NLQ page does not. So executives using the dedicated full-page surface (the more important one) **cannot tell the team when an answer is wrong** — but ops staff using the side panel can. The data feedback loop is broken on the wrong surface.
**File:line:** `page.tsx:194–195` (where the message bubble closes).
**Recommendation:** Lift the `InsightFeedback` component out of `HavenInsightPanel.tsx` into `src/components/haven-insight/InsightFeedback.tsx` (shared) and render it inside the assistant bubble on the NLQ page when `msg.id.length === 36` (the UUID heuristic — same as the side panel). This is a 15-minute fix.

---

### P2 — polish & cohesion

#### P2-1 · `min-h-[calc(100vh-64px)]` subtracts a header that doesn't exist on this route

**Severity rationale:** Per the layout-chrome probe, executive pages route through `(admin)/layout.tsx` which is a bare provider wrapper — no visual chrome. The `AppShell` (with its 56px header) only applies under `/admin/*`, not `/executive/*`. So `100vh - 64px` is subtracting 64px of phantom chrome that isn't rendered. Result: a slight visual gap at the bottom of the page on tall viewports.
**File:line:** `page.tsx:130, 138, 148`.
**Recommendation:** Change `min-h-[calc(100vh-64px)]` → `min-h-dvh` (or just drop the explicit min-h — the layout will handle it). Three occurrences.

#### P2-2 · Three competing headings on a near-empty page

**Severity rationale:** The page renders an `h1` ("Haven Insight"), an `h2` ("Portfolio Q&A"), and an `h3` ("What would you like to know?") in a stack with no content between them. The document outline has heading-stack-without-substance.
**File:line:** `page.tsx:151, 157, 164`.
**Recommendation:** Demote — eliminate the `h2` (P0-3 already removes the `RecordDetailSection` wrapper). The remaining `h1` + an empty-state `h3` is sufficient.

#### P2-3 · Input is single-line `<input>`, can't handle multi-sentence questions

**Severity rationale:** Six of the six suggested questions are short, but in practice executives ask multi-clause questions ("Which facilities had infection-control flags in the last 14 days AND missed their survey-readiness threshold AND have labor % above 60?"). A single-line input truncates these visually as the user types.
**File:line:** `page.tsx:226–232`.
**Recommendation:** Swap `<input>` → `<textarea rows={1}>` with auto-grow on input change (capped at ~5 rows). Bind `onKeyDown` to submit on Enter without Shift (Shift+Enter inserts newline). Pattern: `react-textarea-autosize` is already a common dependency; if not present, a 10-line `useEffect` that sets `textarea.style.height = textarea.scrollHeight + 'px'` does the job.

#### P2-4 · Placeholder copy doesn't teach the keyboard affordance

**Severity rationale:** The placeholder `"Ask about your portfolio…"` is fine but misses an opportunity to teach the interaction. Stripe and Linear-grade products embed the keyboard hint in the placeholder.
**File:line:** `page.tsx:229`.
**Recommendation:** `"Ask Haven about your portfolio — Enter to submit, Shift+Enter for a new line"`.

#### P2-5 · No error-state design beyond "I couldn't process that question right now."

**Severity rationale:** The fallback message at `page.tsx:114–119` is a string interpolation that drops whatever the backend threw. If the backend returns "Rate limited (10 req/min)" the user sees a raw API error inside a friendly preamble — jarring.
**File:line:** `page.tsx:113–123`.
**Recommendation:** Map known error categories to designed copy: rate-limit → "Haven Insight is processing several requests. Try again in a minute." · auth → "Your session expired. Please refresh." · timeout → "That question took longer than expected. Try a narrower scope?" · generic → keep current. Always offer a "Try a simpler question" CTA below the error message that re-suggests the six chips.

#### P2-6 · Empty `<></>` fragment artifacts in the loading/unauthorized branches

**Severity rationale:** Lines 132 and 142 contain bare `<></>` fragments — dead artifacts from a previous refactor (the same pattern shows up in `ExecutiveOverviewPageClient.tsx:565, 644, 651`). Visually invisible but they betray a half-done cleanup pass to any reviewer.
**File:line:** `page.tsx:132, 142`.
**Recommendation:** Delete. (The code audit will catch this too — flagging here only because it's part of the "half-finished" perception.)

#### P2-7 · Tone inconsistency between standalone page and side panel

**Severity rationale:** The side panel's empty state says **"Ask anything about your {module} data."** (operator voice, lowercase, blunt — `HavenInsightPanel.tsx:212`). The standalone page says **"What would you like to know?"** (consumery, sentence-case, soft). Same surface, two different products.
**File:line:** `page.tsx:164–166`.
**Recommendation:** Pick the side-panel voice. "What would you like to know?" → "**Ask Haven about your portfolio.**" Subtitle "Ask about occupancy, revenue, incidents, compliance, staffing, or any portfolio metric." → "**Spans occupancy · revenue · incidents · compliance · staffing · any portfolio metric.**" (Operator middot-list, sentence case, no marketing verb.)

#### P2-8 · `Send` button label "Ask" is fine, but icon redundant

**Severity rationale:** The submit button shows `<Send />` icon + "Ask" label. Either is sufficient; both is belt-and-suspenders. Compare to Linear (icon-only) and Notion AI (label-only). Picking one tightens the row.
**File:line:** `page.tsx:233–240`.
**Recommendation:** Drop the icon; keep "Ask" — it's the more confident affordance for an executive surface. Reduces visual weight on the right edge of the input row, which currently fights the input itself for attention.

---

## Quick wins (each <15 minutes)

1. **Hide "Clear conversation" when `messages.length === 0`** — `page.tsx:241` · gate the wrapper on the message count.
2. **Drop the `← Back to Executive Overview` breadcrumb** — `page.tsx:154` · remove the `backLink` prop; the hub-nav (P0-4) replaces it.
3. **Find/replace `rounded-[8px]` and `rounded-[9px]` → `rounded-[var(--radius)]`** — 7 occurrences in `page.tsx`.
4. **Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` to suggestion chips** — `page.tsx:170–175`.
5. **Hide the token counter behind a dev flag** — `page.tsx:188–190` · wrap in `{process.env.NODE_ENV === "development" && msg.tokensUsed && (...)}`.
6. **Suggestion chips into 2-column grid on `sm`+** — `page.tsx:166` · change `grid gap-1.5` → `grid grid-cols-1 gap-2 sm:grid-cols-2`.
7. **Delete the two `<></>` fragment artifacts** — `page.tsx:132, 142`.
8. **`min-h-[calc(100vh-64px)]` → `min-h-dvh`** — `page.tsx:130, 138, 148`.
9. **Empty-state H3 copy** — `page.tsx:164` · "What would you like to know?" → "Ask Haven about your portfolio."
10. **Lift chip min-height `33px` → `h-9` (36px)** — `page.tsx:174` · matches Button/Input canonical height.

---

## Strategic recommendations (1–2 day investments)

### S-1 · Route through `haven-ai-router` and render structured citations

**Why:** Closes the credibility gap entirely. Today an executive reads "Sunny Acres has 14 open incidents" and has no way to verify — they have to leave the page, navigate to `/admin/incidents?facility_id=...`, and re-run the filter. With citations, each statement in the answer carries a chip-link that drops them straight into the source rows.
**How:**
1. Swap the `authorizedEdgeFetch("exec-nlq-executor", ...)` call to `authorizedEdgeFetch("haven-ai-router", ...)` in `page.tsx:93`.
2. Extend `NlqMessage`:
   ```ts
   interface NlqMessage {
     id: string;
     role: "user" | "assistant";
     content: string;
     timestamp: Date;
     citations?: Array<{ label: string; href?: string; facility_id?: string; kind: "facility" | "report" | "kb" | "metric" }>;
     intent?: string;
     toolsUsed?: string[];
     fallbackUsed?: boolean;
   }
   ```
3. Below each assistant bubble, render a "Sources" rail with 11px uppercase eyebrow + chip-link row. Each chip uses `inline-flex h-6 items-center gap-1 rounded-md border border-border bg-secondary/50 px-2 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground` — same vocabulary as the heat-map chips on the Overview.
4. If `fallbackUsed === true`, show a subtle 11px warning eyebrow "**Fallback model — answer may be less precise**" above the bubble.

### S-2 · Stream responses with the `ai`-package server-sent-events pattern

**Why:** Removes the perceived hang. An 8-second wait with text appearing token-by-token feels like a 3-second wait. The streaming UI also visually proves the system is doing work — critical for executive trust.
**How:** Convert `exec-nlq-executor` (or its replacement, `haven-ai-router`) to return SSE / chunked transfer. Use the Vercel AI SDK's `useChat` or `useCompletion` hook in the page. The bubble renders incrementally; the spinner becomes a typing indicator (three pulsing dots) that disappears as the first token lands. This is a half-day FE change once the BE supports streaming.

### S-3 · Multi-turn UX: thread context, follow-up suggestions, "/" commands

**Why:** The current page treats each question as standalone. But real executive workflows are **follow-up driven**: "Which facility has the most incidents?" → (sees Sunny Acres) → "What kinds of incidents?" → "Show me a 30-day trend." The current UI doesn't surface that the LLM has conversation memory (the router supports it via session), nor does it suggest follow-ups after each answer.
**How:**
1. After each assistant response, render a "**Follow-up**" row with 3 chip suggestions returned by the router (the router can compute these from the intent + result).
2. Add a `/` command palette: typing `/` in the input opens a popover with `Compare facilities`, `Last 30 days`, `Compliance scorecard`, `Cost outliers` — pre-fills the input with a templated query.
3. Add Cmd+K to focus the input from anywhere on the page, and Cmd+L (Linear convention) or Cmd+/ to clear and start over.

### S-4 · Promote the page to a true conversation surface — not a "Q&A wrapped in a card"

**Why:** The current visual model is "a marketing page with a card in the middle." A conversation surface should occupy the full available height with a fixed-bottom input — like Claude, ChatGPT, Linear's Asks. The card-in-a-page treatment is what makes the user describe it as "floating / disconnected."
**How:**
1. Replace the `RecordDetailSection` wrapper with a full-height flex column: `<div className="flex h-[calc(100dvh-160px)] flex-col rounded-[var(--radius)] border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">`.
2. Messages region: `<div className="flex-1 overflow-y-auto px-4 py-6">`.
3. Input region: `<div className="shrink-0 border-t border-border bg-card px-4 py-3">` — naturally docks to the bottom because of the flex layout.
4. On scroll-up away from the bottom, show a small "Jump to latest ↓" pill above the input. (Track scroll delta from `chatEndRef`.)

### S-5 · "Worked example" answer with charts inline

**Why:** Today, the answer is a wall of plain text — even for questions like "How does our AR aging look right now?" which begs for a stacked bar. The router has access to the underlying data; the page just doesn't render it.
**How:** Add a `chart` slot to `NlqMessage` of shape `{ kind: "bar" | "line" | "pie"; series: Array<{ label: string; value: number }>; }`. Render with the existing chart primitives used by Overview KPI tiles. The router determines whether a chart should accompany a given intent; the UI renders whatever it receives.

---

## Appendix A · The five-name problem (for reference)

| Where | What it's called | File:line |
|---|---|---|
| URL path | `/admin/executive/nlq` | route |
| Hub-nav tab label | "Insight" | `executive-hub-nav.tsx:32` |
| Page H1 | "Haven Insight" | `page.tsx:151` |
| Section H2 | "Portfolio Q&A" | `page.tsx:157` |
| Empty-state H3 | "What would you like to know?" | `page.tsx:164` |
| Brand mark in side panel | "Haven Insight" | `HavenInsightPanel.tsx:46` |

Pick **one** brand name ("Haven Insight") and **one** descriptive label ("Portfolio Q&A"). Use the brand at the page level, the descriptor in the subtitle, and align the hub-nav tab to the brand. Delete the rest.

---

## Appendix B · Standalone NLQ page vs. side-panel `HavenInsightPanel` divergence

| Aspect | Standalone (`page.tsx`) | Side panel (`HavenInsightPanel.tsx`) |
|---|---|---|
| Empty-state copy | "What would you like to know?" | "Ask anything about your {module} data." |
| Suggestion chips | 6 hard-coded portfolio questions | Dynamic per-module |
| Message avatars | "You" square + `<MessageSquare />` square | No avatars; alignment only |
| Max bubble width | 600px | 300px |
| Feedback widget | ❌ none | ✅ 👍/👎 wired to `exec_nlq_sessions.feedback` |
| Citations rendering | ❌ not rendered | ❌ not rendered (but router returns them) |
| Edge function | `exec-nlq-executor` (legacy) | `haven-ai-router` (newer, with citations) |
| Token counter | Shown | Shown |

These should converge. The standalone page is the larger, more important surface — it should be the **canonical** implementation, and the side panel should be a constrained variant of the same shared `<HavenInsightConversation />` component (with prop variants for compact bubble width, no-feedback mode, etc.).

---

## Recommended sequencing

1. **Day 1 morning** — Quick wins #1-10 (90 min total).
2. **Day 1 afternoon** — P0-2 (naming), P0-3 (primitive swap), P0-4 (hub-nav), P1-1 (chip grid), P1-3 (clear-conv gate). Result: visually cohesive with the rest of executive.
3. **Day 2** — P0-1 (router cutover + citations rail), P1-9 (lift feedback widget). Result: credibility gap closed.
4. **Sprint +1** — S-1 fully (sources rail polished), S-3 (follow-ups + `/` commands), S-4 (full-height conversation surface).
5. **Sprint +2** — S-2 (streaming) and S-5 (inline charts) — requires backend changes.

---

## Closing note

The page works. It just doesn't yet earn the executive's trust the way the Overview does — the Overview communicates "we know your portfolio cold" via KPI strips, watchlists, and heat maps. Haven Insight communicates "we have an LLM" via a centered card with example prompts. The fixes above (especially P0-1 citations + P0-3 primitive swap + S-4 full-height surface) close that gap. None of them are speculative; all map to existing patterns already shipped elsewhere in the executive hub.
