# Haven Insight Threads + Profile Menu — Post-Build UI/UX & A11y Audit

**Date:** 2026-05-24
**Scope:** ConversationSidebar, NLQ page (two-column layout), UserMenu + UserMenuSheet, IdentityBlock, Profile page, Executive Overview onboarding split.
**Method:** Static code review — markup, classes, ARIA, focus management, keyboard handlers, theme contrast tokens. No runtime screenshots in this pass.
**Severity:** P0 = broken / WCAG AA fail / unreadable · P1 = inconsistent or missing keyboard/focus · P2 = polish / copy / micro-interaction.

---

## P0 — Critical

### 1. Avatar initials fail WCAG AA in dark mode

- **File:** `src/components/ui/identity-block.tsx:115-128` (IdentityAvatar)
- **Issue:** Fallback uses `text-foreground` (94% lightness ≈ near-white in dark mode) over the deterministic gradient `linear-gradient(135deg, base, lightSibling)`. The `lightSibling` end is mixed to ~92% lightness (`rgb(228, 232, 232)`), so white initials on that half of the gradient have ~1.1:1 contrast — invisible. Even the dark end (palette like `#8aa4a8`, L≈60%) yields ~3:1, below AA 4.5:1.
- **Fix:** Change `<AvatarFallback className="font-semibold text-foreground" …>` to `<AvatarFallback className="font-semibold text-zinc-900" …>` (fixed near-black). The gradient always terminates at L≈92% so dark text guarantees ≥4.5:1 across every palette entry in both themes. Alternative: drop the light sibling, use a single solid mid-tone with white text and bump palette to L≤45% to maintain 4.5:1.

### 2. "Clear conversation" link is unreadable

- **File:** `src/app/(admin)/executive/nlq/page.tsx:743-746`
- **Issue:** `text-[10px] text-muted-foreground` for an actionable control. 10px violates the 12px floor used everywhere else in this build and contrast is borderline against the input chrome footer.
- **Fix:** Change to `text-[12px] text-muted-foreground hover:text-foreground` and add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1`.

### 3. Profile page steals page focus on every mount

- **File:** `src/app/(admin)/admin/profile/page.tsx:59-61`
- **Issue:** `document.querySelector("h1")?.focus()` grabs the first h1 in the DOM globally — if the admin layout shell already renders an h1, this routes focus to the wrong heading and announces it twice (h1 + tablist focus). It also runs on every mount/route change, hijacking screen-reader context.
- **Fix:** Replace with `useRef<HTMLHeadingElement>(null)` on the `<h1>` and `useEffect(() => { headingRef.current?.focus(); }, [])`; gate it behind a `document.referrer` check or only fire when the user actually navigated here from the UserMenu.

### 4. ConversationSidebar mobile drawer trigger collides with page header

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:560-572`
- **Issue:** `absolute right-0 top-0 z-40 lg:hidden` pins the "Conversations" trigger to the **top-right** of the page (it is positioned relative to the NLQ page's `<div className="relative …">`). The header title `<h1>Haven Insight</h1>` sits at top-left with `pt-11` to make room, but the trigger overlays the `ExecutiveHubNav` slot when it becomes visible on small tablets where `md:` activates but `lg:` has not. The right edge of the sidebar trigger consumes ~150px next to the right edge of the page.
- **Fix:** Move trigger to `absolute left-0 top-0` (matches the left rail's normal position) and update the NLQ page header padding from `pt-11` to `pl-12 lg:pl-0`. Or render the trigger inside the page header instead of as a positioned overlay.

### 5. Citation chips fail AA contrast

- **File:** `src/app/(admin)/executive/nlq/page.tsx:651-659`
- **Issue:** `bg-secondary/50 … text-muted-foreground` — secondary at 50% opacity blends with the card surface and muted-foreground over that blended fill drops below 4.5:1. Same problem on `bg-secondary/40` follow-up chips (`page.tsx:678-684`).
- **Fix:** Drop the opacity and bump text color: `bg-secondary text-foreground/85` for the resting state, `hover:bg-secondary/80 hover:text-foreground` on interaction. Apply identically to the follow-up chips.

### 6. `window.confirm` for thread deletion

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:303`
- **Issue:** Browser-native `confirm()` is a destructive action that bypasses the rest of the app's dialog system (sonner toasts, Radix dialogs). No focus return guarantee, no consistent styling, no curly-quote rendering on every browser, and it cannot be themed. Triggered via keyboard Delete (line 366) means a single keystroke + Enter can wipe a thread.
- **Fix:** Replace with an `AlertDialog` from `@/components/ui/alert-dialog` (or use the existing `sonner` confirm pattern in the repo). Provide an undo toast on success.

### 7. Profile tab list lacks `aria-controls` / `tabpanel` semantics

- **File:** `src/app/(admin)/admin/profile/page.tsx:111-138`
- **Issue:** `<nav role="tablist">` with `<Link role="tab">` children but no `aria-controls` and no following element with `role="tabpanel"`. The Card sections below are visually the tabpanel but have no semantic relationship — screen readers announce tabs that "control nothing" and cannot jump from tab to panel via the standard shortcut.
- **Fix:** Add `aria-controls="profile-tabpanel"` to each `<Link>` and wrap the conditional Card section in `<section id="profile-tabpanel" role="tabpanel" aria-labelledby={\`tab-${activeTab}\`} tabIndex={0}>`. Add `id={\`tab-${tab.value}\`}` to each Link.

---

## P1 — High

### 8. Sidebar arrow-key nav does not loop at top/bottom

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:347-357`
- **Issue:** `Math.min(currentIndex + 1, focusableThreadIds.length - 1)` and `Math.max(currentIndex - 1, 0)` clamp instead of wrap. Spec called for arrow-key navigation that loops. Home/End jump works but ArrowDown on last item is a no-op.
- **Fix:** Replace clamps with modulo: `(currentIndex + 1) % focusableThreadIds.length` and `(currentIndex - 1 + len) % len`.

### 9. Each thread section is its own `role="listbox"`

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:430-433`
- **Issue:** Pinned, Today, Yesterday, etc. each render `<ul role="listbox">`, so screen readers announce 2–5 separate listboxes for what is conceptually one list. ARIA recommends one listbox per group. Sections do not own their thread options' selection state coherently.
- **Fix:** Wrap all sections in a single `<ul role="listbox" aria-label="Conversations">` and use `<li role="presentation">` containers per section with the eyebrow as a non-semantic label; OR drop `role="listbox"` entirely and use `role="navigation"` on the aside with native `<a>` semantics for each thread.

### 10. Sidebar collapse button hits 24px target on touch

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:482-491`
- **Issue:** `size="icon-xs"` resolves to ~24×24px — below the WCAG 2.5.5 AA touch-target floor (44×44 recommended, 24×24 fails).
- **Fix:** Use `size="icon-sm"` (32px) on the collapse button, or extend the touch target with `before:absolute before:-inset-2`.

### 11. Sidebar search has no clear-input affordance

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:514-525`
- **Issue:** Once a query is typed, the only way to reset is select-all + delete. Standard pattern is an "×" button when `searchValue.length > 0`.
- **Fix:** Append `{searchValue ? <button type="button" onClick={() => setSearchValue("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 …"><X className="size-3.5" aria-hidden /></button> : null}` inside the label.

### 12. Rename interaction is not discoverable

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:382-389`
- **Issue:** Rename only fires on `onDoubleClick` of the thread button. No visible affordance, no keyboard equivalent (F2 is conventional). Users will never find it.
- **Fix:** Add a third action button next to Pin/Delete (a `Pencil` icon, `aria-label="Rename"`) and bind F2 in `handleListKeyDown` to set `renamingId`.

### 13. NLQ chat container height math ignores sidebar width variable on small screens

- **File:** `src/app/(admin)/executive/nlq/page.tsx:594`
- **Issue:** `h-[calc(100dvh-220px)] min-h-[520px]` uses a fixed 220px chrome estimate. On mobile (where `pt-11` for the sheet trigger plus a 2-line h1 + p header consumes ~140px), the form sometimes ends up 20–40px below the viewport. The `min-h-[520px]` then dominates and the container scrolls instead of fitting.
- **Fix:** Use `--haven-chat-chrome: 220px;` set with `clamp(180px, 22dvh, 240px)` per breakpoint and reference it: `h-[calc(100dvh-var(--haven-chat-chrome))]`. Tighten mobile by checking with `@supports (height: 100dvh)`.

### 14. Slash palette is not announced and traps no focus

- **File:** `src/app/(admin)/executive/nlq/page.tsx:713-734`
- **Issue:** The popover that opens above the input has no `role="listbox"`, no `aria-activedescendant`, no `aria-expanded` on the input. Keyboard nav works (`ArrowDown/Up/Enter/Esc`) but screen-reader users get no feedback. Also missing `aria-controls` to link input → palette.
- **Fix:**
  - Input: add `role="combobox" aria-expanded={paletteOpen} aria-controls="haven-slash-palette" aria-autocomplete="list" aria-activedescendant={paletteOpen ? \`slash-tpl-${paletteIndex}\` : undefined}`.
  - Popover wrapper: `id="haven-slash-palette" role="listbox" aria-label="Slash templates"`.
  - Each template button: `role="option" id={\`slash-tpl-${index}\`} aria-selected={index === paletteIndex}`.

### 15. Profile stub tabs are clickable with no warning

- **File:** `src/app/(admin)/admin/profile/page.tsx:115-138, 229-244`
- **Issue:** Notifications / Security / Sessions / Preferences all render an enabled tab → "Coming soon" card. Tabs that lead to dead-ends should be disabled or badged as "Soon".
- **Fix:** Add `disabled` state to non-functional tabs and a small `<Badge variant="muted" className="ml-1 text-[10px]">Soon</Badge>` next to the label. In the Link click handler, `event.preventDefault()` when the tab is disabled. Or render them as `<span role="tab" aria-disabled="true">` instead of `<Link>`.

### 16. Profile avatar tooltip trigger is keyboard-focusable but non-functional

- **File:** `src/app/(admin)/admin/profile/page.tsx:151-161`
- **Issue:** `<div role="button" aria-disabled="true" tabIndex={0}>` lands on the keyboard tab order but does nothing on Enter/Space. Worse, `cursor-not-allowed` plus `tabIndex={0}` creates a focusable disabled control — anti-pattern.
- **Fix:** Remove `tabIndex={0}` and `role="button"`. The tooltip can still trigger on hover via `<TooltipTrigger render={<div className="…" />}>`. Or keep it tabbable but turn it into a real `<button type="button" disabled>` so screen readers announce "button, dimmed".

### 17. NLQ assistant avatar uses generic `MessageSquare` instead of identity

- **File:** `src/app/(admin)/executive/nlq/page.tsx:626-628, 691-693`
- **Issue:** Every assistant turn shows the same `MessageSquare` chip. Other surfaces in the app use `IdentityBlock`/`IdentityAvatar` for sender identity. The Haven Insight thread is meant to feel conversational — a "Haven" mark or branded avatar would match the rest of the app and the user bubble's distinct primary color.
- **Fix:** Replace with a dedicated `<HavenAssistantAvatar />` component (a small `H` glyph on `bg-primary/10 text-primary` with the same border treatment as `IdentityAvatar`). Reuse the size/border math from `Avatar` so it's visually peer to the user.

### 18. `aria-description` is invalid ARIA

- **File:** `src/components/layout/UserMenu/UserMenu.tsx:127`
- **Issue:** `aria-description="Signs you out of Haven on this device"` is not a standard attribute (it's `aria-describedby`, which references an element id). Screen readers ignore the value.
- **Fix:** Either move the copy to visible text below "Sign out" inside the item, or render an offscreen `<span id="signout-desc" className="sr-only">Signs you out of Haven on this device</span>` and use `aria-describedby="signout-desc"`.

### 19. UserMenu trigger has no visible hover/focus state

- **File:** `src/components/layout/UserMenu/UserMenu.tsx:62-67`
- **Issue:** Class is `outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring` but `transition-colors` has nothing to transition because no `hover:` class changes any color. The `ring` is inside the rounded avatar — gets visually clipped by the `Avatar` afterborder.
- **Fix:** Add `rounded-full hover:opacity-90 focus-visible:ring-offset-2 focus-visible:ring-offset-background` so the focus ring sits outside the avatar circle.

### 20. UserMenuSheet "Notification preferences" routes to a dead tab

- **File:** `src/components/layout/UserMenu/UserMenuSheet.tsx:117-121` and `UserMenu.tsx:99-103`
- **Issue:** Both menus link to `/admin/profile?tab=notifications` which renders the "Coming soon" stub (see #15). Either the link is premature or the tab should ship.
- **Fix:** Hide the "Notification preferences" item until the tab content lands, OR keep it and badge it as "Soon" in the menu (matching whatever you do for #15).

### 21. Executive Onboarding has duplicate "Configuration" heading

- **File:** `src/components/executive/ExecutiveOverviewPageClient.tsx:451-498`
- **Issue:** `<h3>Configuration</h3>` describes the whole card, then the first sub-`<section>` opens with `<p className="…uppercase…">Configuration</p>` — same word twice in the heading hierarchy.
- **Fix:** Drop the redundant eyebrow on the first section. Keep `<h3>Configuration</h3>` as the card heading and rename the inner eyebrow to "Settings & thresholds" or remove the inner eyebrow entirely (the h3 already labels it).

### 22. Executive Onboarding shortcut numbered lists imply order

- **File:** `src/components/executive/ExecutiveOverviewPageClient.tsx:468, 502`
- **Issue:** `<ol>` with numbered chips suggests a sequence ("step 1, step 2"), but the spec says these are independent shortcuts. The numbers misleadingly imply a path.
- **Fix:** Change both to `<ul>` and replace the numbered circle with a small `ArrowRight` chip or the section icon. Reserve numbered chips for the actual setup runbook (refresh button + threshold setup).

### 23. Refresh status row error icons are text-only `✓` / `✗`

- **File:** `src/components/executive/ExecutiveOverviewPageClient.tsx:411-419`
- **Issue:** Status indicators use Unicode characters with color-only differentiation. Color-blind users cannot distinguish red `✗` from green `✓` reliably; screen readers announce "check mark" / "x" inconsistently across platforms.
- **Fix:** Replace with `<CheckCircle2 className="size-3.5 text-success" aria-label="Succeeded" />` and `<XCircle className="size-3.5 text-destructive" aria-label="Failed" />` from lucide-react. Already imported.

### 24. Tab order through avatar → menu → my profile → back is broken by sidebar

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:594-596`
- **Issue:** The desktop sidebar uses `absolute inset-y-0 left-0 z-30 hidden lg:block`. Because it's positioned out of flow, its first focusable element (the collapse button) sits before the main page in DOM order, so Tab from the page header's UserMenu lands inside the sidebar, then re-enters the main column from the top — not in visual reading order.
- **Fix:** Either (a) flip DOM order to render the main column first and the sidebar last (still visually left via `order-first lg:order-last` plus `flex-row-reverse`), or (b) keep DOM order but skip the sidebar from Tab when collapsed by setting `tabIndex={-1}` on the collapsed rail and providing a "Show conversations" skip link in the page header.

### 25. Cmd+K listener does not guard against composition events

- **File:** `src/app/(admin)/executive/nlq/page.tsx:253-263`
- **Issue:** `(event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"` fires even when the user is mid-IME composition or has focus inside another `<input>` (e.g., sidebar search). Pressing Cmd+K from the sidebar search input jumps focus away mid-typing.
- **Fix:** Guard with `if (event.isComposing || event.repeat) return;` and `if (event.target instanceof HTMLInputElement && event.target !== inputRef.current) return;` — only steal Cmd+K when it's not landing in another text field.

### 26. Mobile sheet has no focus trap verification + initial focus

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:583-592`
- **Issue:** Relies entirely on Radix Sheet's default focus trap. There is no explicit initial-focus target — focus lands on the close button (or first focusable) which on this layout is the "New conversation" button via DOM order, not the search input that the user likely came in to type.
- **Fix:** Add `<SheetContent onOpenAutoFocus={(e) => { e.preventDefault(); searchInputRef.current?.focus(); }} …>` and wire a `searchInputRef` on the search `<input>`.

### 27. UserMenu DropdownMenuContent is fixed 320px wide

- **File:** `src/components/layout/UserMenu/UserMenu.tsx:78-82`
- **Issue:** `w-[320px]` is hardcoded; on a 360px viewport with `align="end"` and the avatar at the right edge, this either overflows the page (Radix clamps but may shrink-clip identity text) or forces ugly horizontal repositioning. Should swap to the bottom sheet automatically on `<lg` (UserMenuSheet already exists for this).
- **Fix:** Either (a) add a viewport check (matchMedia `(max-width: 640px)`) at the consumer and render `<UserMenuSheet />` below that, or (b) constrain to `w-[min(320px,calc(100vw-1.5rem))]`.

### 28. NLQ form submit button shrinks awkwardly when disabled

- **File:** `src/app/(admin)/executive/nlq/page.tsx:736-743`
- **Issue:** `disabled:opacity-40` with `disabled:cursor-not-allowed` plus the gap reflow — when the user clears the input, the button visually "ghosts" and re-paints. Also missing `aria-label`/`aria-disabled` and the `Send` icon has no accessible name when text wraps.
- **Fix:** Add `aria-label={loading ? "Sending question" : "Send question"}`; keep "Ask" visible at all widths (it already is). Replace `disabled:opacity-40` with `disabled:opacity-50` (matches all other disabled treatments in the codebase).

---

## P2 — Polish

### 29. "Conversations" heading is too small for a primary sidebar label

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:472`
- **Issue:** `text-[13px] font-semibold` for what is essentially the H2 of the sidebar. Other rail headers in the app are `text-[14px]`.
- **Fix:** Bump to `text-[14px] font-semibold`.

### 30. Pinned star + collapsed icon overlap visually

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:391-396`
- **Issue:** In the collapsed rail, pinned threads show the amber star and unpinned threads show a generic `MessageSquare`. Visually inconsistent — all collapsed items should use the same icon family.
- **Fix:** Always render `MessageSquare`; layer a small filled dot (`absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-amber-500`) when pinned. Cleaner row rhythm.

### 31. NLQ "No conversations yet" empty state uses two text sizes

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:534-542`
- **Issue:** `text-sm font-medium` then `text-[12px] leading-snug` — small jump between two adjacent lines.
- **Fix:** Use `text-[13px] font-medium` then `text-[12px]` for tighter rhythm.

### 32. Citations panel header has no semantic role

- **File:** `src/app/(admin)/executive/nlq/page.tsx:649-650`
- **Issue:** `<p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Sources</p>` is the heading of the sources block but is rendered as a paragraph.
- **Fix:** `<h4 className="…">Sources</h4>` so the screen reader navigates by heading.

### 33. Follow-up chip eyebrow alignment

- **File:** `src/app/(admin)/executive/nlq/page.tsx:672-677`
- **Issue:** `<div className="pl-0.5">` with `<p className="text-[11px] font-medium uppercase tracking-wider …">Follow-up</p>` sits below the assistant bubble. The 2px left padding looks accidental — feels like the eyebrow is unaligned with the bubble's 13px content padding.
- **Fix:** Drop `pl-0.5`; let it align with the bubble's left edge. Or move the follow-up chips inside the bubble's bottom border like the citations are.

### 34. Typing indicator has no screen-reader status

- **File:** `src/app/(admin)/executive/nlq/page.tsx:691-705`
- **Issue:** `aria-label="Haven Insight is typing"` on the inner dot row but no `role="status"` or `aria-live="polite"` on the enclosing wrapper, so it never announces.
- **Fix:** Add `role="status" aria-live="polite"` to the outer `<div className="flex gap-3 max-w-3xl">` and make `aria-label` say "Haven Insight is preparing an answer" (typing implies a human).

### 35. Identity block fallback text for missing org name

- **File:** `src/components/ui/identity-block.tsx:144-147`
- **Issue:** `const organization = orgName?.trim() || "Organization";` — when org name hasn't loaded yet, every user shows "Organization" as their org. Looks like placeholder copy that shipped.
- **Fix:** Hide the org line entirely when `orgName` is null/empty: `{organization ? <span className="truncate">{organization}</span> : null}` plus skip the `Building2` icon and `·` separator in that branch.

### 36. Profile page Role field looks like an input but isn't

- **File:** `src/app/(admin)/admin/profile/page.tsx:195-200`
- **Issue:** `<div className="flex h-9 items-center rounded-[var(--radius)] border border-input bg-background px-3">` styled exactly like the Input next to it but houses a `<Badge>`. Users will try to click it expecting to change role.
- **Fix:** Drop the input-styled wrapper; render just the Badge with the Label above. Or use a read-only `<Input value={roleConfig.roleLabel} readOnly disabled />` matching Email's treatment for consistency.

### 37. Help & docs label inconsistency between menus

- **File:** `src/components/layout/UserMenu/UserMenu.tsx:114` vs `UserMenuSheet.tsx:123`
- **Issue:** Desktop uses `Help &amp; docs` (escaped entity), mobile uses `Help & docs` (raw). Functionally identical but inconsistent source.
- **Fix:** Use plain `&` in both: `Help & docs`. JSX handles it.

### 38. Suggested-question buttons truncate poorly on narrow phones

- **File:** `src/app/(admin)/executive/nlq/page.tsx:613-622`
- **Issue:** `grid-cols-1 sm:grid-cols-2` with `text-[13px] leading-snug` and 2-line questions can wrap to 3 lines at 320px width. Heights then mismatch via `sm:auto-rows-fr` only on `sm:` and up.
- **Fix:** Add `auto-rows-fr` (no breakpoint prefix) so cards are equal height at every width.

### 39. NLQ token-count debug pill should respect tabular figures

- **File:** `src/app/(admin)/executive/nlq/page.tsx:645-647`
- **Issue:** `font-mono text-[10px]` for `{tokens} tokens` — fine for dev, but inside a bubble with `tabular-nums` not enforced means dev token counts jitter.
- **Fix:** Add `tabular-nums` (or just rely on the global tabular setting). Cosmetic only.

### 40. `IdentityAvatar size="md" className="size-9"` is redundant

- **File:** `src/components/layout/UserMenu/UserMenu.tsx:71-77` and `UserMenuSheet.tsx:88-95`
- **Issue:** `size="md"` already resolves to `size-9` in `avatarSizeClasses.md` — passing `className="size-9"` is redundant noise.
- **Fix:** Drop the `className="size-9"` in both files. Use `size="md"` only.

### 41. ExecutiveHubNav hidden on mobile

- **File:** `src/app/(admin)/executive/nlq/page.tsx:583-585`
- **Issue:** `<div className="hidden md:block"><ExecutiveHubNav /></div>` — mobile users have no way to switch executive sub-pages from the NLQ surface. Not a regression from this campaign, but worth flagging since the campaign reshaped the page header.
- **Fix:** Render a compact `<ExecutiveHubNav variant="dropdown" />` on mobile, or surface the current nav via the sidebar sheet header.

### 42. Save button has no explicit loading label

- **File:** `src/app/(admin)/admin/profile/page.tsx:215-219`
- **Issue:** While `saving`, the button renders `<Loader2 className="size-4 animate-spin" />Save changes` — the same text. Screen reader users get no audible state change.
- **Fix:** Render conditional text: `{saving ? "Saving…" : "Save changes"}`; keep the icon.

### 43. Pinned section eyebrow uses "Pinned" but the listbox aria-label is "Pinned conversations"

- **File:** `src/components/haven-insight/ConversationSidebar.tsx:433`
- **Issue:** Cosmetic mismatch: the visible label says "Pinned" but `aria-label="Pinned conversations"` for AT. Either both should say "Pinned conversations" or both "Pinned".
- **Fix:** Align: use `aria-label={section.label === "Pinned" ? "Pinned" : section.label}`. Or, if you want fuller AT context, keep "Pinned conversations" and prefix the eyebrow text.

---

## Cross-cutting notes (not bugs, just observations)

- **Cmd+K** still works after the sidebar layout change — the listener is window-scoped and the `inputRef` is unaffected by the new flex layout. ✅
- **Sidebar arrow-key nav** wires `data-thread-id` on every button and queries them with `document.querySelector` across the whole document, so cross-section nav works in practice despite multiple `role="listbox"` containers. Functional ✅, semantically broken (see #9).
- **Mobile drawer focus trap** is Radix-managed and behaves correctly; the missing piece is *initial focus target* (see #26).
- The `--haven-sidebar-width` CSS variable correctly drives both the rail width and the main column's left padding. The fallback `280px` keeps the page rendering correctly before JS hydrates. ✅

---

## Recommended fix order

1. **#1 (avatar contrast)** — affects every authenticated surface in dark mode.
2. **#5 (citation chips)** + **#2 (Clear conversation)** — same WCAG bucket, single PR.
3. **#7 (profile tab semantics)** + **#15 (stub tab handling)** + **#20 (dead-tab links)** — coherent profile-a11y PR.
4. **#3 (profile focus hijack)** + **#16 (ghost button)** — small profile cleanup.
5. **#4 (sidebar trigger position)** + **#24 (DOM order)** — sidebar layout pass.
6. **#6 (delete dialog)** + **#11 (search clear)** + **#12 (rename discoverability)** — sidebar UX pass.
7. **#8/#9/#14/#26** — sidebar + slash palette ARIA pass.
8. **#21/#22/#23** — onboarding polish.
9. Everything else (P2) can land as a polish sweep.
