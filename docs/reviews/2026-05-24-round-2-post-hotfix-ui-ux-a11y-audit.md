# Round 2 Post-Hotfix UI/UX + a11y Audit

**Date:** 2026-05-24
**Scope:** Post-hotfix surfaces touched in `b0269245`, `85d4ab27`, `49597151`, `afb02587`
**Reviewer:** JARVIS
**Auditor lens:** WCAG 2.1 AA, WCAG 2.5.5 (target size), Mercury layout rules, mobile→32" responsive

---

## Context / Scope

Surfaces audited (file paths under `Circle-of-Life-repo/`):

| Surface | File |
|---|---|
| Haven Insight NLQ page | `src/app/(admin)/executive/nlq/page.tsx` |
| Profile page | `src/app/(admin)/admin/profile/page.tsx` |
| ConversationSidebar | `src/components/haven-insight/ConversationSidebar.tsx` |
| UserMenu / UserMenuSheet | `src/components/layout/UserMenu/UserMenu.tsx`, `UserMenuSheet.tsx` |
| Adjacent: InsightFeedback (rendered in NLQ) | `src/components/haven-insight/InsightFeedback.tsx` |
| Adjacent: AppShell (chrome math) | `src/components/layout/AppShell.tsx` |
| Adjacent: IdentityBlock (used in profile/menu) | `src/components/ui/identity-block.tsx` |
| Adjacent: ExecutiveHubNav (header inside NLQ) | `src/app/(admin)/executive/executive-hub-nav.tsx` |

---

## Findings

### P0 — Layout broken, unreadable text, WCAG AA fails

**P0-1 · Input below the fold on mobile / tablet (regression of the bug this hotfix was supposed to fix)**
**File:** `src/app/(admin)/executive/nlq/page.tsx:752`
**Issue:** The conversation card is sized `h-[calc(100dvh-200px)] min-h-[480px]`. The `200px` constant is only correct on `lg`+ where the AppShell pillar strip is hidden and the page header has `lg:pt-0`. On `<lg` (mobile + tablet ≤1023px) the actual chrome stack above the card is:
- AppShell topbar `h-14` = 56px
- AppShell mobile pillar strip `h-9` = 36px (hidden only at `lg`)
- AppShell main `border-t` = 1px
- AppShell main `py-5` top = 20px
- Page header `pt-11` = 44px (only resets at `lg:pt-0`)
- h1 + sub-paragraph block ≈ 50px
- Page `gap-6` between header and card = 24px

Total **above** the card on `<lg` ≈ **231px**, plus 20px of `py-5` bottom = **251px** of viewport consumed. With the card sized `100dvh − 200px`, it is **~51px taller than the viewport allows** → input bar scrolls below the fold on every mobile and tablet width. This is the exact failure mode the hotfix targeted; it's been re-broken.

**Exact fix:** Replace the fixed-calc with breakpoint-aware values, or — preferred — go fully flex/min-h-0 so the card consumes remaining space:

```tsx
// page.tsx — replace the wrapping <div className="relative flex h-full w-full"> +
// <main className="flex h-full flex-1 flex-col gap-6 ..."> with a column that fills <main>.
<div className="relative flex h-full w-full flex-col">
  <main className="flex h-full min-h-0 flex-1 flex-col gap-6 lg:pl-[var(--haven-sidebar-width,280px)]">
    {/* page header — unchanged */}
    <div className="flex shrink-0 flex-col gap-3 pt-11 md:flex-row md:items-start md:justify-between lg:pt-0">…</div>

    {/* card now fills remaining space with no calc math */}
    <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius)] border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">…</div>
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">…</div>
    </div>
  </main>
  <ConversationSidebar …/>
</div>
```

This removes the calc altogether. `min-h-0` on every flex parent lets the inner scroll area shrink, and the input is always docked above the fold at every breakpoint. The `min-h-[480px]` floor can be kept on the card for desktop polish if desired.

---

**P0-2 · InsightFeedback error text 9px — unreadable**
**File:** `src/components/haven-insight/InsightFeedback.tsx:73`
**Issue:** `<span className="text-[9px] text-amber-600">{error}</span>` — 9px is well below the 12px legibility floor and well below WCAG AA "normal text" target sizing. `text-amber-600` on `bg-card` is also borderline (4.0–4.3:1) depending on theme.
**Exact fix:**
```tsx
{error ? <span role="alert" className="text-[12px] text-destructive">{error}</span> : null}
```

---

**P0-3 · InsightFeedback thumbs lose focus indicator**
**File:** `src/components/haven-insight/InsightFeedback.tsx:55-68`
**Issue:** Both thumbs buttons use `className="rounded p-1 transition-colors"` with no `focus-visible:ring-*`. Keyboard users have no focus indicator on the only feedback affordance in NLQ answers.
**Exact fix:** Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring` to both buttons.

---

**P0-4 · Typing indicator announces nothing to screen readers**
**File:** `src/app/(admin)/executive/nlq/page.tsx:883-895`
**Issue:** The row has `role="status" aria-live="polite"` but the only text content (`aria-label="Haven Insight is preparing an answer"`) is on a non-text element. `role="status"` reads the live-region's *text content*, not nested `aria-label` attributes. Today SR users hear nothing when the indicator appears.
**Exact fix:** Add an sr-only span as the live-region text:
```tsx
<div className="flex max-w-3xl gap-3" role="status" aria-live="polite">
  <span className="sr-only">Haven Insight is preparing an answer…</span>
  <div className="size-8 …">
    <MessageSquare className="w-4 h-4" />
  </div>
  <div className="rounded-[var(--radius)] px-[13px] py-3 bg-card border border-border">
    <div className="flex items-center gap-1" aria-hidden>
      <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:0ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse [animation-delay:300ms]" />
    </div>
  </div>
</div>
```

---

**P0-5 · Citation chip and follow-up eyebrow text at 11px**
**Files:**
- `src/app/(admin)/executive/nlq/page.tsx:831` (Sources `h4`)
- `src/app/(admin)/executive/nlq/page.tsx:835` (citation chip inner `text-[11px]`)
- `src/app/(admin)/executive/nlq/page.tsx:854` (Follow-up `p` eyebrow)
**Issue:** Three of the four eyebrow labels around an assistant message use `text-[11px]`. Mercury's own legibility floor is 12px. Below that fails internal review and many WCAG AA audits.
**Exact fix:** Bump to `text-[12px]` on each. The chip inner text and the "Sources"/"Follow-up" eyebrows render in the densest part of the page; 1px improves recognition without re-flowing.

---

**P0-6 · Save state in profile page has no SR announcement**
**File:** `src/app/(admin)/admin/profile/page.tsx:226-239`
**Issue:** The Save button text swaps to "Saving…" while in-flight. `<Loader2 aria-hidden />` is decorative. There is no `aria-live` region, no `role="status"`, no announcement when the button transitions to saving or back. SR users get silent UI for a multi-second async action. Toast announces success/failure but not the in-flight state, so users who tab away from the button after triggering save get no feedback at all.
**Exact fix:** Wrap the footer in a polite live region, or add an sr-only status next to the button:
```tsx
<CardFooter className="justify-end gap-2">
  <span aria-live="polite" className="sr-only">
    {saving ? "Saving profile…" : ""}
  </span>
  <Button … onClick={() => void handleSave()} disabled={saving || authLoading || !hasChanges}>
    {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
    {saving ? "Saving…" : "Save changes"}
  </Button>
</CardFooter>
```

---

### P1 — Inconsistencies, missing keyboard support, responsive gaps

**P1-1 · ConversationSidebar action buttons obscure long titles + miss touch target**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:584-622`
**Issue:** The Pin / Rename / Delete action cluster is positioned `absolute right-1 top-1/2 -translate-y-1/2` over the row. On `[@media(hover:none)]` (touch) the cluster is permanently visible (`opacity-100`) and overlays the right portion of the title — there is no right-padding reserved on the title text. Buttons are `size="icon-xs"` (24px square), well below WCAG 2.5.5 minimum target size (44×44) on the surface where they're permanently exposed.
**Exact fix:**
1. Add right-padding to the title text when actions are visible (touch always, hover on hover):
   ```tsx
   <span className={cn(
     "min-w-0 flex-1 truncate",
     itemCollapsed && "sr-only",
     // reserve space for the action cluster on touch and on hover/focus
     !itemCollapsed && "group-hover:pr-20 group-focus-within:pr-20 [@media(hover:none)]:pr-20",
   )}>
   ```
2. Bump button size on touch: replace `size="icon-xs"` with `size="icon-sm"` (32px), or wrap the cluster in `[@media(hover:none)]:[&_button]:size-9` to give a 36px touch target on touch surfaces only.

---

**P1-2 · Profile tablist has no roving-focus arrow navigation**
**File:** `src/app/(admin)/admin/profile/page.tsx:114-167`
**Issue:** `role="tablist"` is set, the active Link has `tabIndex={0}`, stubs have `tabIndex={-1}` — but there is no ArrowLeft/ArrowRight key handler. WAI-ARIA tabs pattern requires roving focus. Since all stubs are disabled anyway, the user cannot Tab off the active tab to another tab. The tablist is non-navigable.
**Exact fix:** Even with all-but-one stub disabled, attach an `onKeyDown` to the `<nav role="tablist">` that intercepts Left/Right/Home/End and focuses the next enabled tab. For now there's only one enabled tab, but this prevents the pattern from breaking when more tabs ship.

```tsx
const navRef = useRef<HTMLElement>(null);
const onTablistKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
  if (!["ArrowRight","ArrowLeft","Home","End"].includes(e.key)) return;
  e.preventDefault();
  const enabled = Array.from(navRef.current!.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"])'));
  if (!enabled.length) return;
  const i = enabled.findIndex(el => el === document.activeElement);
  const next = e.key === "Home" ? 0
    : e.key === "End" ? enabled.length - 1
    : e.key === "ArrowRight" ? (i + 1) % enabled.length
    : (i - 1 + enabled.length) % enabled.length;
  enabled[next].focus();
};
<nav ref={navRef} role="tablist" onKeyDown={onTablistKeyDown} …>
```

---

**P1-3 · Role caption text under 12px floor**
**File:** `src/app/(admin)/admin/profile/page.tsx:219`
**Issue:** `<span className="text-[11px] text-muted-foreground">Assigned by your org admin</span>` — 11px text immediately under the Role Badge falls below the 12px floor and reads as legalese.
**Exact fix:** `text-[12px]` (and `mt-0.5` for breathing room next to the Badge):
```tsx
<span className="text-[12px] text-muted-foreground">Assigned by your org admin</span>
```

---

**P1-4 · Profile page: `readOnly disabled` on Email + Organization inputs blocks copy-via-keyboard**
**Files:** `src/app/(admin)/admin/profile/page.tsx:208,224`
**Issue:** `<Input … readOnly disabled />` — `disabled` makes the input unfocusable, so keyboard users cannot select-copy the email or org name. Many users open the profile page specifically to grab their org email.
**Exact fix:** Drop `disabled`, keep `readOnly`. The Input component already styles readonly distinctly:
```tsx
<Input id="profile-email" value={email ?? ""} readOnly />
<Input id="profile-organization" value={orgName} readOnly />
```

---

**P1-5 · ConversationSidebar section labels at 11px**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:685`
**Issue:** "Today / Yesterday / This week / Earlier / Pinned" section dividers are `text-[11px] font-medium uppercase tracking-wider`. Below floor.
**Exact fix:** `text-[12px]` with the same uppercase tracking.

---

**P1-6 · Thread message-count badge at 10px**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:580`
**Issue:** `<span className="text-[10px] tabular-nums text-muted-foreground">{messageCount}</span>` — 10px, well below floor; renders as visually-disposable noise even though it is the only signal of thread depth.
**Exact fix:** `text-[11px]` (kept tight, but legible) **or** drop the count entirely and use the pin star + Recent grouping. If keeping the count, also add an aria-label so SR users get context:
```tsx
<span aria-label={`${messageCount} messages`} className="text-[11px] tabular-nums text-muted-foreground">{messageCount}</span>
```

---

**P1-7 · Collapsed sidebar items have no tooltip / discoverable label**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:548-583`
**Issue:** When `collapsed=true`, every thread row renders as a single `<MessageSquare>` icon with the title in `sr-only`. Sighted keyboard users (and any user without hover) can't tell threads apart. There's no `title=` or `<Tooltip>` wrapper.
**Exact fix:** Add `title={thread.title}` on the button so the native browser tooltip surfaces on hover/long-press, and add `aria-label={thread.title}` (so SR users on collapsed mode get the title even when the `<span>` is sr-only inside a button — current is fine for SR but adding aria-label is cheap defense). Better: wrap the icon with a `<Tooltip>` from `@/components/ui/tooltip` when collapsed.

---

**P1-8 · ConversationSidebar mobile Sheet width overflows on ≤320px viewports**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:738`
**Issue:** `<SheetContent side="left" className="w-[280px] p-0" …>` — fixed 280px width spills past the viewport on Galaxy Fold (280×653), iPhone 5 / SE 1st gen (320×568), and any pinned PWA browser chrome.
**Exact fix:** Clamp to viewport like the UserMenu fix:
```tsx
<SheetContent side="left" className="w-[min(280px,calc(100vw-32px))] p-0" …>
```

---

**P1-9 · ConversationSidebar listbox arrow-nav has no Space activation or type-ahead**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:412-446`
**Issue:** `handleListKeyDown` handles ArrowUp/Down/Home/End/Enter/F2/Delete but not Space (standard listbox activation) or type-ahead (jump to first thread title starting with the typed letter). WAI-ARIA listbox expects both.
**Exact fix:** Add a Space handler that mirrors Enter, and (lower priority) wire a debounced type-ahead via a `typedRef.current` string flushed every 500ms.

```tsx
} else if ((event.key === "Enter" || event.key === " ") && currentId) {
  event.preventDefault();
  activateThread(currentId);
}
```

---

**P1-10 · Rename input commits on blur, including blur from clicking action buttons**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:507`
**Issue:** `onBlur={(event) => void commitRename(thread.id, event.target.value)}` fires whenever focus leaves the input. Clicking the Pin or Delete icon to abandon the rename will commit the (possibly empty or half-edited) title first. Escape works, but blur is the more common dismissal path.
**Exact fix:** Track an `aborted` ref set by Escape / clicking outside the row, and short-circuit `commitRename` when aborted. Simpler: change blur to read the input value via a ref and *only* commit if the title changed and the input is still mounted (no race with the action buttons).

---

**P1-11 · Inactive ExecutiveHubNav More-dropdown trigger label fragile**
**File:** `src/app/(admin)/executive/executive-hub-nav.tsx:100-105`
**Issue:** When no secondary section is active, the dropdown trigger shows just "More" with no aria-controls/aria-haspopup — the dropdown library typically wires this. But the `aria-label` only includes the current state when one is active. SR users get no hint that a menu of secondary sections exists when none is active.
**Exact fix:** Always include "menu" in the label:
```tsx
aria-label={activeSecondary ? `More views menu — currently ${activeSecondary.label}` : "More views menu"}
```

---

**P1-12 · NLQ "Clear conversation" button below WCAG 2.5.5 target size**
**File:** `src/app/(admin)/executive/nlq/page.tsx:941-947`
**Issue:** The text-only button is `text-[12px]` with `RotateCcw className="w-3 h-3"` (12px icon). Total tap target is roughly 16–20px tall — well below 44×44 minimum.
**Exact fix:** Add explicit padding and an icon bump:
```tsx
<button
  type="button"
  onClick={startNewConversation}
  className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
  <RotateCcw className="size-3.5" aria-hidden /> Clear conversation
</button>
```

---

**P1-13 · NLQ slash-palette `aria-controls` points to a not-yet-mounted element when closed**
**File:** `src/app/(admin)/executive/nlq/page.tsx:925-928`
**Issue:** The combobox input always declares `aria-controls="haven-slash-palette"`, but the palette only mounts when `paletteOpen=true`. WAI-ARIA permits forward-references; many SR + browser combos still throw "controlled element not found" warnings.
**Exact fix:** Render the palette container *always* (with `hidden` when closed), or set `aria-controls={paletteOpen ? "haven-slash-palette" : undefined}`. The latter is the smaller diff.

---

**P1-14 · NLQ message bubble `max-w-[600px]` without `min-w-0` overflows on mobile with long unbroken content**
**File:** `src/app/(admin)/executive/nlq/page.tsx:785-792`
**Issue:** `<div className="flex max-w-[600px] flex-col gap-1.5">` inside a `flex max-w-3xl gap-3` parent. The inner column lacks `min-w-0`, so flex won't shrink it below intrinsic content width. Long URLs, table-like outputs, or inline code with no spaces overflow the row on screens < 600px (every mobile width).
**Exact fix:**
```tsx
<div className="flex min-w-0 max-w-[600px] flex-col gap-1.5">
```
And add `break-words` to the inner `<p>`:
```tsx
<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.content}</p>
```

---

**P1-15 · UserMenu identity header uses `bg-muted/30` — risk in dark mode**
**File:** `src/components/layout/UserMenu/UserMenu.tsx:97`
**Issue:** `<header className="border-b border-border bg-muted/30 …">` — 30% opacity over the popover background can collapse to near-popover contrast in dark mode, leaving the identity block visually indistinct from menu items below it. Same pattern in UserMenuSheet (`bg-muted/30`).
**Exact fix:** Either bump to `bg-muted/60` or use the design token directly: `bg-secondary/50`. Verify in dark mode with the OS theme switcher.

---

**P1-16 · UserMenuSheet bottom-sheet width 320 looks like an orphaned card, not a sheet**
**File:** `src/components/layout/UserMenuSheet.tsx:99`
**Issue:** `side="bottom" className="mx-auto max-h-[85dvh] w-[min(320px,calc(100vw-32px))]"` — bottom sheets in iOS / Android (and the rest of the app) are full-bleed. Clamping to 320px floating in the middle looks like a misplaced popover. Mercury convention elsewhere in the codebase: bottom sheets span the viewport.
**Exact fix:** Drop the width clamp on bottom side, full-bleed instead:
```tsx
<SheetContent
  side="bottom"
  className="max-h-[85dvh] rounded-t-[14px] border-t border-border bg-card p-0"
  showCloseButton
>
```

---

### P2 — Polish, copy nits

**P2-1 · NLQ scroll-to-bottom is `behavior: "smooth"` during streaming**
**File:** `src/app/(admin)/executive/nlq/page.tsx:218`
**Issue:** `chatEndRef.current?.scrollIntoView({ behavior: "smooth" })` fires on every `messages` change — i.e. every appended token during SSE streaming. On low-power mobile devices this causes visible jank and triggers reduced-motion users' OS-level smoothing fallback.
**Exact fix:** Use `behavior: "auto"` for token updates; smooth only when a message is appended (new role). Or guard with `prefers-reduced-motion`:
```tsx
useEffect(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  chatEndRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
}, [messages.length]); // length, not messages — only fires when a message is added, not on every token
```

---

**P2-2 · NLQ empty-state alignment inconsistent with rest of card**
**File:** `src/app/(admin)/executive/nlq/page.tsx:771-784`
**Issue:** The empty-state lives in a `mx-auto … max-w-2xl flex-col justify-center py-16` block. `justify-center` only affects the cross-axis when `flex-col` — but it's the *main axis* here, so it centers vertically only when the container has extra height (which it usually doesn't). The eyebrow/title/description stack hugs the top.
**Exact fix:** Add `flex-1` so the empty state actually centers in the available card space:
```tsx
<div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-16">
```

---

**P2-3 · Profile page programmatic focus on h1 fires on every mount**
**File:** `src/app/(admin)/admin/profile/page.tsx:60-62`
**Issue:** `useEffect(() => { headingRef.current?.focus(); }, [])` — every navigation to the profile page yanks focus to the h1 and announces "My profile, heading". On round-trips (e.g. open a tooltip then return), the announcement repeats. Conventional pattern: only focus the heading when arriving via in-app navigation, not on hard reload.
**Exact fix:** Gate on a "fresh navigation" sentinel, or — simpler — only auto-focus when there's no element to restore focus to:
```tsx
useEffect(() => {
  // Only steal focus on initial mount, and only when nothing else is focused.
  if (document.activeElement === document.body || document.activeElement === null) {
    headingRef.current?.focus();
  }
}, []);
```

---

**P2-4 · ConversationSidebar listbox sections not wrapped in `role="group"`**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:680-692`
**Issue:** Section headers are inserted as `<li role="presentation">` siblings of options. The listbox pattern strictly allows only `role="option"` children. Some SRs (NVDA + Firefox) will skip the section label entirely.
**Exact fix:** Wrap each section's options in a `<li role="presentation">` containing a `<div role="group" aria-labelledby="...">` with the options inside. Lower priority — current behavior degrades gracefully.

---

**P2-5 · NLQ Send button double-announces in some SR/browser combos**
**File:** `src/app/(admin)/executive/nlq/page.tsx:933-941`
**Issue:** `aria-label={loading ? "Sending question" : "Send question"}` overrides the visible "Ask" / "Sending…" text. Some SRs read both (the aria-label and then the inner text). Pick one.
**Exact fix:** Drop `aria-label` and rely on the visible text + the existing `<Send aria-hidden />` icon:
```tsx
<button type="submit" disabled={loading || !input.trim()} className="…">
  {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
  <span>{loading ? "Sending…" : "Ask"}</span>
</button>
```

---

**P2-6 · NLQ page's "Conversations" SheetTrigger flush against viewport edge on tablet**
**File:** `src/components/haven-insight/ConversationSidebar.tsx:723-737`
**Issue:** `absolute left-0 top-0 z-40` places the trigger at the page-content edge with no breathing room. On tablet (768–1023px) it touches the heading column with only the `pt-11` on the h1 separating it. Visually cramped.
**Exact fix:** Offset by a few pixels:
```tsx
className={cn(
  "absolute left-0 top-0 z-40 lg:hidden inline-flex h-9 items-center gap-2 …",
  "ml-0 mt-0", // explicit no-shift; or use top-1 left-1 to breathe
)}
```
Or move the trigger inside the header row on md+ and only float it absolutely on small mobile.

---

**P2-7 · Suggested-question buttons inconsistent height baseline**
**File:** `src/app/(admin)/executive/nlq/page.tsx:777-783`
**Issue:** `<ul className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2">` with `<button className="… min-h-9 …">` — the `auto-rows-fr` does normalize heights, but on a 2-column row where one question is 1 line and another is 2 lines, the 1-liner button has whitespace at the top because `items-center` is not set. Visible misalignment.
**Exact fix:** The button already has `flex h-full items-center`, but the `<li className="h-full">` is also needed (already present). Actually looks correct — verify in screenshot. **Skip if no visible defect.**

---

**P2-8 · `aria-current="page"` on tab Links is unconventional**
**File:** `src/app/(admin)/admin/profile/page.tsx:155`, also `executive-hub-nav.tsx:90`
**Issue:** `aria-current="page"` paired with `role="tab"` is semantically mixed. `aria-selected="true"` is the right primary indicator for tabs; `aria-current` is for breadcrumb/page indicators. Harmless but noisy in accessibility-tree snapshots.
**Exact fix:** Drop `aria-current` on tabs that already carry `aria-selected`. Keep `aria-current="page"` only on non-tab nav Links.

---

**P2-9 · Profile page tooltip-on-avatar fires only on hover, no keyboard parity**
**File:** `src/app/(admin)/admin/profile/page.tsx:184-200`
**Issue:** The avatar wrapper is a non-interactive `<div>` with `outline-none` and no `tabIndex`. Tooltip "Avatar upload coming soon" only appears on hover. Keyboard / SR users miss it — though there is a static "Drag-and-drop upload coming soon" line below as fallback. Comment explicitly chose this. **Acceptable but worth re-checking once avatar upload ships.**

---

**P2-10 · NLQ token-count debug print at 10px**
**File:** `src/app/(admin)/executive/nlq/page.tsx:818`
**Issue:** `<p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">{msg.tokensUsed} tokens</p>` — dev-only debug, but 10px text in the visual hierarchy of a polished page is jarring even in dev. Bump to `text-[11px]` to avoid mistaking it for a layout bug while debugging in prod-mode.

---

## Summary

- **6 P0 findings** — input below fold on mobile/tablet (regression), 9px error text, missing focus indicator on feedback buttons, silent typing indicator for SR, 11px micro-copy floor breach, silent save-state.
- **16 P1 findings** — action-cluster overlap + touch target, no roving-focus on tablist, 10–11px label breaches, `readOnly disabled` blocking copy, mobile sheet overflow on ≤320px, missing Space activation, blur-commits-rename race, dark-mode contrast risk on UserMenu identity header, full-bleed bottom-sheet convention, message bubble `min-w-0` missing, slash-palette aria-controls when closed, clear-conversation below 44px tap target.
- **10 P2 findings** — smooth-scroll-during-stream jank, empty-state alignment, on-mount h1 focus theft, role-group listbox structure, double-announce Send button, tablet sheet trigger crowding, suggested-question alignment, `aria-current` + `role="tab"`, tooltip-only-on-hover avatar, dev token-count text size.

**Top priority to ship next:** P0-1 (viewport math) is the single biggest UX regression — the input bar is below the fold on every mobile + tablet width. Recommend swapping the `h-[calc(100dvh-200px)]` for a `flex flex-1 min-h-0` chain end-to-end so the calc never has to track AppShell chrome again.
