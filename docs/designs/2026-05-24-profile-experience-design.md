# Haven — Profile & Account Experience · Design

**Date:** 2026-05-24
**Designer:** JARVIS (Design lens)
**Surface under design:** the avatar in the top-right of `TopBar` and everything it should open.
**Entry point today:** `Circle-of-Life-repo/src/design-system/components/TopBar/TopBar.tsx:12` (the `userMenu` slot) populated by `renderProfileMenu()` at `Circle-of-Life-repo/src/components/layout/AppShell.tsx:632–688` (and again, near-identically, by `renderSidebarFooter()` at `Circle-of-Life-repo/src/components/layout/AdminShell.tsx:642–697`).
**Companion work (concurrent, out-of-scope here):** (1) a separate agent owns the click-throws-an-error bug, (2) another owns conversation threads, (3) another owns hygiene/CI. This document is **profile UX only** — what the surface *should be* once the bug is gone.

---

## 🟢 LIVE PROGRESS TRACKER — Orchestrated Campaign

> The orchestrator updates this as each phase ships. Sub-agents reading this doc should consult here first to see what's already in.

| Phase | Description | Status |
|-------|-------------|--------|
| **0** | Bug fix (`renderProfileMenu` throws) — owned by separate agent | ☐ pending |
| **A** | Promote menu surface to a 320-wide popover with identity block (P0-1, P0-2, P0-3) | ☐ pending |
| **B** | New `/admin/profile` page with five tabs (Profile / Notifications / Security / Sessions / Preferences) | ☐ pending |
| **C** | Org + facility scope intelligence in the menu, theme toggle moved in, keyboard shortcuts sheet | ☐ pending |
| **D** | "View as" role impersonation (owner/org_admin only), PAT issuance, changelog feed | ☐ pending |

Sub-agent boundary rule: only touch items inside your assigned phase. If you find issues outside your phase, note them at the bottom of this tracker — do not implement.

---

## Executive summary

Haven's profile menu today is a **three-item dropdown** — email, "Account settings", "Sign out" — that succeeds at signing the user out and fails at every other expectation an executive brings to the top-right avatar. The single "Account settings" item points at `/admin/settings/notifications` (`AppShell.tsx:660`), which is **not** a personal profile page; it's a facility-wide **alert-routing** configuration UI (`Circle-of-Life-repo/src/app/(admin)/admin/settings/notifications/page.tsx:20–32` — `RouteRow` schema with `severity_min`, `staff_role_targets`). An owner clicking "Account settings" expecting to edit their display name or enroll MFA is shipped to a screen for editing how Level-3 incidents fan out to LPNs. That is the single biggest tell that this surface was a stub. The user already has `user_profiles.full_name` and `user_profiles.avatar_url` in the database (`Circle-of-Life-repo/supabase/migrations/003_user_rbac.sql:7,10`), and `haven-auth-context.tsx:52–67` already reads `user_profiles` — it just selects `app_role, organization_id` and ignores everything else.

The redesign below proposes: (1) a **320-wide popover** as the click target (Vercel/Stripe pattern, not a 240-wide list) anchored on a real `<Avatar />` from `src/components/ui/avatar.tsx`, (2) a dedicated **`/admin/profile` page** with five tabs that owns the actual account surface, (3) two pieces of intelligence the menu earns by virtue of Haven's multi-tenant model — **organization context** and **facility-scope spillover** — which no consumer-grade pattern would surface but which an enterprise-grade one must, (4) a **theme toggle + keyboard shortcuts cheat sheet** lifted from the topbar to compress chrome, and (5) **role-impersonation ("View as")** for owners and org_admins so they can see what a Facility Admin or Med-Tech actually sees without re-logging-in.

The bar is not "make it look like Vercel." The bar is: **what should an executive feel when their avatar opens?** They should feel that the product knows who they are, which org they belong to, which facilities they can see right now, and that every account control they could want is reachable in two clicks. The current surface lands at zero of those four.

---

## 1 · Menu surface decision

### Recommendation: **popover** (320px wide), not a dropdown list, not a sheet, not a navigate-away.

Three patterns to choose from. The right one depends on how much *identity context* the surface has to carry — not on what looks pretty.

| Pattern | Examples | Width | When it wins | When it loses |
|---|---|---|---|---|
| **Compact dropdown** (≤240px) | Linear top-right avatar | 200–240 | Single-tenant SaaS where every user has one identity. | Loses on multi-tenant — no room for org context. |
| **Popover** (280–360px) | Stripe Dashboard, Vercel, Notion personal menu | 280–360 | Multi-tenant or workspace-switching products. Identity block + grouped item list + footer affordances all fit. | Loses on phones — too tall for a tap zone. |
| **Sheet / drawer** | Notion full-screen mobile, GitHub user nav | full-screen on mobile | Phone-first surfaces where the menu carries deep navigation. | Loses on desktop — feels like a wrong-context overlay. |
| **Navigate to page** | Older enterprise (Salesforce Lightning) | n/a | When there is *nothing* to surface in the menu — only links. | Loses on every modern bar. Two clicks where one would do. |

**Haven is multi-tenant** (`haven-auth-context.tsx:21` — `organizationId: string | null`) with users that can have **multi-facility access** through `user_facility_access` (`Circle-of-Life-repo/supabase/migrations/003_user_rbac.sql:31–55`). The compact dropdown is too narrow to honor that. The dedicated page is wrong because the **80% of opens are read-only glances** ("am I signed in as the right person? what org? what role?") that should never require a route change.

So: **popover on desktop, sheet on mobile** (Haven already has `@/components/ui/sheet` in the bundle — used by AppShell's mobile pillar drawer at `AppShell.tsx:842–851` — so this is a single primitive swap on the breakpoint, not a new dependency). The popover links to `/admin/profile` for the deep settings; the popover does **not** try to be the settings page itself.

This matches what every peer at the bar does:
- **Vercel:** popover (~320 wide), `User name / email` block, "Account Settings" link, theme toggle inline, "Sign out" at the bottom. They do *not* link to a tab on the same page.
- **Stripe Dashboard:** popover, **adds an account switcher** (which Haven needs for org switching — see §2).
- **Linear:** narrower (~260) because Linear is single-workspace per user; they only switch via the workspace switcher in the **left** rail, not the top-right avatar. Haven has no workspace rail, so this duty falls to the avatar.
- **Notion:** popover that doubles as a workspace switcher with up to 8 workspaces; this is the closest pattern to what Haven needs *if* a user has multiple orgs (rare, but real for the broker role at `dashboard-routing.ts:174–185`).

---

## 2 · Menu contents — what makes the cut

Below is the proposed item list with iconography, grouping, and explicit justification. Items marked **✓** ship in Phase A. Items marked **+** ship in Phase C. Items marked **★** ship in Phase D. Items marked **✗** are explicitly dropped (with reason).

### Group 1 · Identity block (always visible, no grouping label)
| Item | Treatment | Why | Phase |
|---|---|---|---|
| Avatar (40px) + full name + role label | `<Avatar size="lg" />` from `src/components/ui/avatar.tsx:18` showing `full_name` initials over a deterministic gradient generated from `user.id`, with `roleConfig.roleLabel` from `dashboard-routing.ts:12` as the second line | The user has to know **whose account is open**. Email alone (current state, `AppShell.tsx:649`) is the lowest-information identity primitive — half the time, executives sign in with personal Gmails for demo accounts and don't remember which one is active. | ✓ A |
| Email | 11px muted, single-line truncated | Confirms the auth identity beneath the human identity. | ✓ A |
| Organization name | 11px muted with a `Building2` icon (already imported at `AppShell.tsx:36`); becomes a button if the user has >1 org | This is the **multi-tenant tax**. Today the user has zero indication of which org they're acting under. For brokers/owners with multiple orgs this is critical; for everyone else it's free reassurance. Resolves from `user_profiles.organization_id` joined to `organizations.name`. | ✓ A |

### Group 2 · Account
| Item | Icon | Why | Phase |
|---|---|---|---|
| **My profile** → `/admin/profile` | `UserCircle2` | The real settings surface. Owns avatar upload, display name, password, MFA. See §3. | ✓ A |
| **Notification preferences** → `/admin/profile?tab=notifications` | `Bell` | Personal notification preferences (which channels, which severities, quiet hours) — distinct from the facility-wide alert *routing* at `/admin/settings/notifications`. The current menu confuses these. | ✓ A |
| **Preferences** → `/admin/profile?tab=preferences` | `Settings2` | Theme, density, default facility scope on login, default landing page (overrides `dashboard-routing.ts:47` for power users), keyboard layout. | + C |

### Group 3 · Workspace context (multi-tenant scaffolding)
| Item | Icon | Why | Phase |
|---|---|---|---|
| **Switch organization** (only if `user_organizations.count > 1`) | `Building` | For brokers and contracted org_admins. Stripe pattern. Hidden for the 95% single-org case — no clutter when not needed. | + C |
| **Facility scope: `<selected name>`** + small "Change" affordance | `Building2` | Echoes the facility scope already in the topbar (`AppShell.tsx:357–428`), but inside the personal menu so a multi-facility user has a second affordance from a sticky surface. Click drops a nested submenu (same payload as the topbar scope dropdown). | + C |

### Group 4 · Power tools
| Item | Icon | Why | Phase |
|---|---|---|---|
| **Theme: Light / Dark / System** | `Sun` / `Moon` / `Monitor` | The current topbar theme toggle (`AppShell.tsx:606–629`) is a great-looking icon but lives in the topbar competing for the same 9 icon slots as Search, Grace, Haven Insight, Report Incident, Pilot Feedback, Notifications. Move it **into** this menu. The bar gets one less icon; the menu earns a real preference. Use a tri-state radio item set (System is the default the topbar can't currently express). | + C |
| **Keyboard shortcuts** | `Command` | Opens an overlay (a sheet, full-height on the right) listing the ⌘K palette, the existing shortcuts in `billing-invoice-ledger.tsx:648–676` (the most shortcut-heavy page) and the new `g` + key patterns we're proposing for navigation. Linear does this; the credibility-per-pixel is enormous. | + C |
| **What's new** (with unread dot when applicable) | `Sparkles` | Changelog feed. Reads from a `changelog` table or a remote JSON. Show a small dot when the user's `last_changelog_seen_at` < latest entry. Vercel and Linear both do this. For an enterprise app shipping weekly, this is the **single best place** to surface that the team is moving. | ★ D |

### Group 5 · Help & admin
| Item | Icon | Why | Phase |
|---|---|---|---|
| **Help & docs** → external | `LifeBuoy` | Direct link to the internal KB / runbook. The KB exists already (`Circle-of-Life-repo/src/lib/knowledge/`) but is buried inside a pillar. Many executives discover it by accident. | ✓ A |
| **View as…** (owner / org_admin only) | `Eye` | Open a submenu of all role labels from `dashboard-routing.ts:46–192`; selecting one writes a session cookie that the layout reads to coerce `appRole` for read-only routes. **Read-only** — the impersonation cookie blocks writes via middleware. Banner at top reading "Viewing as Caregiver — Exit" anchored at `WORKSPACE_WELL` styling (`AppShell.tsx:90`). This is how a CEO finally *understands* what their Caregiver staff is looking at on their phone. The closest peer is GitHub's "Become user" for staff or Notion's "View as guest." | ★ D |
| **API tokens** (owner / org_admin only) | `KeyRound` | Personal access tokens for the platform's REST endpoints under `/api/`. Power-user feature — gates the future of programmatic exports and webhook configuration. | ★ D |
| **Sign out** | `LogOut`, destructive variant | Already present (`AppShell.tsx:662–682`). Keep at the bottom, separated by divider, destructive color from `DropdownMenuItem variant="destructive"` (`dropdown-menu.tsx` pattern). | ✓ A |

### Items I am **dropping** from common "kitchen-sink" profile menus
| Item | Why it's not here |
|---|---|
| Billing / subscription | Out of scope per the brief; this is enterprise-billed, not seat-billed; lives in the org admin area. |
| Team / member management | Out of scope per the brief; already exists at `/admin/settings/users` (per the `app_role` query in `Circle-of-Life-repo/src/app/(admin)/admin/settings/users/page.tsx:36`). |
| Workspace settings | Same — that's an org admin surface, not a personal one. |
| SSO / SAML config | Same — org-admin scope. |
| "Invite a teammate" | Same. |
| Status (away / busy / focus) | Haven is not a chat product. This vocabulary would import the wrong mental model. |
| Search box inside the menu | The ⌘K palette is two keystrokes away (`AppShell.tsx:150–167`). A nested search would compete with it. |
| Recently visited pages | Same — ⌘K owns this. |

---

## 3 · Dedicated profile page — `/admin/profile`

The popover links here. Five tabs, segmented control at the top in the same style as `ExecutiveHubNav` (referenced in `2026-05-24-haven-insight-portfolio-qa-design-review.md` Appendix A). Each tab is a **bounded card** with `rounded-[var(--radius)] border border-border bg-card shadow-[var(--shadow-card)]` — the canonical surface from `globals.css:172,241`.

### 3.1 · Profile tab (default)
```
┌─────────────────────────────────────────────────────────────┐
│ [ Avatar  ]   Display name        [ Sarah Chen          ]   │
│  120×120     Pronouns             [ she/her             ]   │
│  upload      Email                  sarah@company.com (verified) │
│              Phone                [ +1 555 0103         ]   │
│              Role (read-only)       Owner                   │
│              Organization           Sunny Acres Care, LLC   │
│              Member since           Mar 12, 2025            │
│              Last sign-in           today · 09:14 PT        │
└─────────────────────────────────────────────────────────────┘
```
- **Avatar:** drag-and-drop upload zone (120×120 preview, with hover overlay that says "Replace"). Persists to Supabase Storage and writes the URL to `user_profiles.avatar_url` (column already exists at `003_user_rbac.sql:10`).
- **Display name:** writes to `user_profiles.full_name` (`003_user_rbac.sql:7`).
- **Pronouns:** new `settings.pronouns` jsonb key in `user_profiles.settings` (column at `003_user_rbac.sql:13`).
- **Email:** read-only; changing email is a Supabase-auth flow that should fire a verification email — link to a modal that does this, never edit-in-place.
- **Role:** read-only badge. Editing roles is an org-admin surface; show a tooltip "Contact your org admin to change your role" if the user clicks the badge.
- **Save bar:** sticky bottom on this card with "Cancel" and "Save changes" buttons. Save shows an inline success toast (already a primitive in the bundle).

### 3.2 · Notifications tab
The current `/admin/settings/notifications` page (`page.tsx:1–623`) is **alert-routing** for the org/facility — not personal notification preferences. Keep that page as-is at its current URL; this new tab is the user's *personal* opt-in/out for the same channels.

```
┌─────────────────────────────────────────────────────────────┐
│ Email     Push      SMS       In-app                        │
│                                                             │
│ Critical alerts (Level 4)        [✓]   [✓]   [✓]   [✓]      │
│ Urgent alerts (Level 3)          [✓]   [✓]   [ ]   [✓]      │
│ Standard alerts (Level 2)        [✓]   [ ]   [ ]   [✓]      │
│ FYI updates (Level 1)            [ ]   [ ]   [ ]   [✓]      │
│ ─────                                                       │
│ Direct mentions                  [✓]   [✓]   [ ]   [✓]      │
│ Comments on items I follow       [✓]   [ ]   [ ]   [✓]      │
│ Weekly digest (Monday 7am)       [✓]   [ ]   [ ]   [ ]      │
│ ─────                                                       │
│ Quiet hours        [✓ Enabled]   from [22:00] to [07:00]    │
│ Pause all          [ until pick-a-date ]                    │
└─────────────────────────────────────────────────────────────┘
```
- Channel matrix maps to the four `CHANNEL_OPTIONS` already declared at `Circle-of-Life-repo/src/app/(admin)/admin/settings/notifications/page.tsx:41–47` (sans the `call` channel which is for org-wide routing only).
- Severity rows map to the `SEVERITY_OPTIONS` enum at `page.tsx:32–37`.
- Persists to `user_profiles.settings.notifications` JSONB blob.
- Quiet hours is a single time range; pause all is a deadline. Both are the same vocabulary Slack uses.

### 3.3 · Security tab
```
┌─────────────────────────────────────────────────────────────┐
│ Password                                                    │
│   Last changed 47 days ago                  [ Change ... ]  │
│                                                             │
│ Two-factor authentication                                   │
│   Authenticator app    Not configured       [ Set up   ... ]│
│   Backup codes         —                                    │
│                                                             │
│ Sign-in methods                                             │
│   Email + password     ✓ active                             │
│   Google SSO           — not enabled (contact org admin)    │
│                                                             │
│ Account recovery email                                      │
│   recovery@company.com                       [ Change   ... ]│
└─────────────────────────────────────────────────────────────┘
```
- **Password change:** issues Supabase `auth.updateUser({ password })` — re-prompts current password first.
- **MFA:** TOTP enrollment via Supabase `auth.mfa.enroll`. QR code modal; backup codes shown once on completion.
- **SSO:** read-only indicator. Enabling SSO is an org-admin surface (out of scope here per §8).

### 3.4 · Sessions tab
```
┌─────────────────────────────────────────────────────────────┐
│ Active sessions (3)                       [ Sign out all  ] │
│                                                             │
│ ▣ This device · macOS · Chrome 126   · started 2h ago       │
│   192.0.2.14 · San Diego, CA                                │
│                                                             │
│ ◯ iPhone · Safari 17                · started 18h ago       │
│   192.0.2.99 · Las Vegas, NV         [ Revoke ]             │
│                                                             │
│ ◯ macOS · Chrome 125                · started 3d ago        │
│   192.0.2.14 · San Diego, CA         [ Revoke ]             │
└─────────────────────────────────────────────────────────────┘
```
- Reads from Supabase auth's session list (or a `user_sessions` join table if Supabase doesn't expose enough).
- **"Sign out all"** sweeps every other session. The current session is identified with a filled bullet and is not revokable from this row (it'd log the user out of the page they're looking at).
- Geolocation derived from IP only; show "Approximate location" tooltip on first-time use.

### 3.5 · Preferences tab
| Setting | Default | Notes |
|---|---|---|
| Theme | System | Triplet (Light / Dark / System) — `next-themes` already configured at `AppShell.tsx:31,113` |
| Density | Comfortable | Two values (Comfortable / Compact); writes a `data-density` attr on the html element; Tailwind utilities read it via a `data-[density=compact]:` variant |
| Default landing page | Role default | Drop-down listing routes the role has access to (computed from `roleConfig.visibleGroups` in `dashboard-routing.ts:54`); overrides `getDashboardRouteForRole(appRole)` at login |
| Default facility on load | "Last viewed" | Choices: Last viewed / All facilities / Specific facility |
| Time zone | Browser-detected | Affects every timestamp in the app via `formatRelative` helpers |
| Date format | `MMM D, YYYY` | Choices: `MMM D, YYYY` / `D MMM YYYY` / `YYYY-MM-DD` |
| Number format | en-US | `Intl.NumberFormat` locale string |
| Sound on alerts | On | Browser sound playback for critical alerts |

All preferences write to `user_profiles.settings` JSONB.

---

## 4 · Visual treatment

### Avatar
The current avatar (`AppShell.tsx:644` — `UserCircle2` lucide icon) is a placeholder. Replace with the `<Avatar />` primitive at `src/components/ui/avatar.tsx:8`. Use:
- **Image** if `user_profiles.avatar_url` is set.
- **Initials fallback** (two-letter UPPERCASE derived from `full_name` words) on a **deterministic gradient** generated from `user.id`. Algorithm: hash `user.id` → pick from a 12-color palette of low-saturation tones drawn from the existing token set (think the `--chart-1` through `--chart-5` series in `globals.css` extended), build a 135° gradient from the color to its 92%-lightness sibling. This gives every user a unique, branded, calm chip — never a generic gray.
- **Size:** `size-9` (36px) in the topbar trigger (matches `WORKSPACE_ICON_LG` at `AppShell.tsx:91`). `size-10` inside the popover identity block. `size-32` (128px) on the profile page.
- **Status badge slot** (`AvatarBadge` at `avatar.tsx:57`) reserved for a future "online" / "in survey mode" indicator. Not wired in Phase A.

### Popover container
```tsx
<DropdownMenuContent
  align="end"
  sideOffset={6}
  className="w-[320px] p-0 rounded-[var(--radius)] border border-border bg-popover shadow-[var(--shadow-card)] ring-1 ring-foreground/5"
>
  {/* identity block — bg-muted/30 to subtly distinguish it as fixed chrome */}
  <div className="border-b border-border bg-muted/30 px-3 py-3 flex items-start gap-3">
    <Avatar size="lg">…</Avatar>
    <div className="min-w-0 flex-1">
      <p className="text-[13px] font-semibold text-foreground truncate">{fullName}</p>
      <p className="text-[12px] text-muted-foreground truncate">{email}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3" /> {roleLabel}
        <span aria-hidden> · </span>
        <Building2 className="size-3" /> {orgName}
      </p>
    </div>
  </div>
  {/* groups — 8px vertical padding, 6px between items */}
  <DropdownMenuGroup className="p-1">…</DropdownMenuGroup>
</DropdownMenuContent>
```
- **Radius:** `--radius` (10px) — matches the rest of the chrome (`globals.css:172`).
- **Shadow:** `--shadow-card` from `globals.css:241` — same lift as the `surface-card` class so the menu feels native to the surface, not floating.
- **Border:** 1px `border-border` + a 1px `ring-foreground/5` outer halo, identical to `dropdown-menu.tsx:48` so it matches the facility scope dropdown next to it in the topbar.
- **Width:** 320px fixed — gives the identity block room to truncate gracefully on a 32-char email.
- **Animation:** inherits the `data-open:animate-in fade-in-0 zoom-in-95` set defined at `dropdown-menu.tsx:48`; do not add custom motion.

### Item iconography (lucide icons, already in the bundle at `AppShell.tsx:33–47`)
| Item | Icon | Already imported? |
|---|---|---|
| My profile | `UserCircle2` | ✓ |
| Notification preferences | `Bell` | ✓ |
| Preferences | `Settings2` | needs import |
| Switch organization | `Building` | needs import (Building2 exists) |
| Facility scope | `Building2` | ✓ |
| Theme — Light | `Sun` | ✓ |
| Theme — Dark | `Moon` | ✓ |
| Theme — System | `Monitor` | needs import |
| Keyboard shortcuts | `Command` | needs import |
| What's new | `Sparkles` | needs import |
| Help & docs | `LifeBuoy` | needs import |
| View as | `Eye` | needs import |
| API tokens | `KeyRound` | needs import |
| Sign out | `LogOut` | ✓ |

Every icon is `size-3.5` (14px) inline with `text-muted-foreground` on rest, inheriting `text-foreground` on hover — same vocabulary as `AppShell.tsx:660`.

### Hover and focus
- **Item rest:** `text-[13px] text-foreground` (the muted treatment makes items look disabled — this menu is meant to be tapped, lean primary).
- **Item hover:** `bg-muted hover:text-foreground` — already the inherited `DropdownMenuItem` behavior.
- **Item focus-visible:** `ring-2 ring-ring ring-inset` per `dropdown-menu.tsx` shipped defaults.
- **Destructive (Sign out):** `text-destructive hover:bg-destructive/10` — the `variant="destructive"` switch at `AppShell.tsx:664` already handles this; keep.

### Divider color
`border-border` (1px) — the same divider the `DropdownMenuSeparator` ships at `dropdown-menu.tsx:~80` (use the primitive, don't roll your own).

---

## 5 · Mobile behavior

The desktop popover does not translate. On `< md` the trigger opens a **bottom sheet** (`@/components/ui/sheet` — already imported at `AppShell.tsx:64–68` and used for the mobile pillar drawer at `AppShell.tsx:842`).

```
─────────────────────────────────
                              ✕
─────────────────────────────────
[  Avatar (lg)  ]
   Sarah Chen
   sarah@company.com
   Owner · Sunny Acres Care
─────────────────────────────────
 👤  My profile                  →
 🔔  Notification preferences     →
─────────────────────────────────
 🏢  Sunny Acres Care · switch    →
 📍  Cottages at 14th             →
─────────────────────────────────
 ☀️  Theme: System                
 ⌨  Keyboard shortcuts            →
 ✨  What's new       (•)         →
─────────────────────────────────
 ?   Help & docs                  ↗
─────────────────────────────────
 ⎋   Sign out                     
─────────────────────────────────
```

- **Sheet side:** `bottom`. Inherits `rounded-t-[14px]` from the pillar-sheet treatment at `AppShell.tsx:846` so the chrome reads cohesively.
- **Tap targets:** every row is `min-h-12` (48px) — exceeds the 44px iOS HIG minimum and the 48dp Material minimum.
- **Identity block:** full-bleed top section with `bg-muted/30`, 16px vertical padding.
- **Order:** identical to the desktop popover; the user's mental model survives the breakpoint flip.
- **Theme on mobile:** inline triplet of pill buttons (`Light · System · Dark`) rather than a submenu — phones have the room and submenus on touch are clumsy.
- **Sheet auto-closes** on item selection (`onOpenChange(false)` after route push) — but stays open for the theme triplet and the "view as" submenu so the user can preview before committing.

---

## 6 · Accessibility

The Base UI `MenuPrimitive` underneath `DropdownMenu` (`dropdown-menu.tsx:4`) handles the heavy lifting; the design owes the rest:

- **Keyboard:**
  - `Enter` / `Space` on the avatar trigger opens the menu (Base UI default).
  - `ArrowDown` / `ArrowUp` cycles through items, wrapping at the ends.
  - `Home` / `End` jumps to first / last item.
  - `Esc` closes; focus returns to the trigger (Base UI default).
  - Typing a letter does a Type-Ahead Find on item labels (Base UI default).
  - **Custom:** `g p` from anywhere navigates to `/admin/profile` (matches the `g`-prefix vocabulary already in use at `billing-invoice-ledger.tsx:665–668`). Document this in the keyboard shortcuts cheat sheet.
- **Focus trap:** Base UI handles when the menu is open. When the menu closes after a route push, ensure focus lands on the page H1 (not the trigger) so screen readers narrate the new context. Add `useEffect` in the `/admin/profile` page to `document.querySelector('h1')?.focus()` on first mount (with `tabIndex={-1}` on the H1).
- **ARIA:**
  - Trigger: `aria-label="Open account menu — signed in as {fullName}"` (the current `AppShell.tsx:638` aria-label is just "Account menu" — uninformative when a screen-reader user has multiple accounts open).
  - Menu: `role="menu"` (Base UI default).
  - Items: `role="menuitem"` (Base UI default); destructive items add `aria-description="Signs you out of Haven on this device"` for "Sign out".
  - Identity block: NOT focusable; marked as `<header>` inside the menu so it's announced as group context but not as a separate menuitem.
- **Screen-reader announcements:**
  - When the menu opens, the identity block is read first ("Sarah Chen, sarah@company.com, Owner at Sunny Acres Care").
  - Theme triplet uses radio semantics — `role="radiogroup"` on the wrapper, `role="menuitemradio"` on each option, `aria-checked` reflecting current state.
  - Unread "What's new" badge is announced as "What's new, 3 unread updates."
- **Contrast:**
  - Identity block muted text uses `text-muted-foreground` which is verified to meet 4.5:1 against `bg-muted/30` in both themes.
  - Avatar fallback initials use `text-foreground` on the gradient — gradients are selected from low-saturation tones to preserve contrast against white text in dark mode and dark text in light mode (the `avatar.tsx` primitive's `bg-muted text-sm text-muted-foreground` is the canonical fallback; this proposal upgrades the bg to the deterministic gradient but keeps the text-on-bg contrast contract).
- **Motion:**
  - Respect `prefers-reduced-motion`: collapse the `data-open:zoom-in-95` to a pure fade. Base UI does this if a `data-reduced-motion` attribute is set; add it at the layout level in Phase A.

---

## 7 · Component file structure

```
src/components/layout/UserMenu/
├── UserMenu.tsx              — the popover (desktop)
├── UserMenuSheet.tsx         — the sheet (mobile)
├── UserMenu.test.tsx
├── parts/
│   ├── IdentityBlock.tsx     — avatar + name + email + role + org
│   ├── ThemeTriplet.tsx      — Light / Dark / System radio set
│   ├── ViewAsSubmenu.tsx     — owner/org_admin only (Phase D)
│   ├── ShortcutsSheet.tsx    — opens via the "Keyboard shortcuts" item (Phase C)
│   └── ChangelogPreview.tsx  — "What's new" surface (Phase D)
└── hooks/
    ├── useUserProfile.ts     — joins user_profiles to auth.user; SWR with mutate-on-save
    ├── useUserOrganizations.ts — lists the user's orgs (for the switcher)
    └── useImpersonation.ts   — writes/reads the impersonation cookie (Phase D)

src/app/(admin)/admin/profile/
├── page.tsx                  — segmented control + tab routing via ?tab=
├── tabs/
│   ├── ProfileTab.tsx
│   ├── NotificationsTab.tsx
│   ├── SecurityTab.tsx
│   ├── SessionsTab.tsx
│   └── PreferencesTab.tsx
└── parts/
    ├── AvatarUpload.tsx
    └── PasswordChangeModal.tsx
```

**Reuse over custom:**
- `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarBadge` from `src/components/ui/avatar.tsx`.
- `DropdownMenu*` primitives from `src/components/ui/dropdown-menu.tsx`.
- `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle` from `src/components/ui/sheet.tsx` (already imported at `AppShell.tsx:64–68`).
- `Tooltip*` from `src/components/ui/tooltip.tsx` (`AppShell.tsx:69`).
- `Button`, `buttonVariants` for save bars (already used in the existing notifications page at `notifications/page.tsx:15`).
- `Skeleton` for loading states (`AppShell.tsx:70`).
- `useHavenAuth` from `@/contexts/haven-auth-context` — but **extend it** in Phase A to also surface `fullName` and `avatarUrl` (the schema already has them at `003_user_rbac.sql:7,10`; the context just doesn't select them at `haven-auth-context.tsx:54`).

**The single new primitive:**
- `IdentityBlock` is reusable enough that it should live under `src/components/ui/identity-block.tsx` and be consumable from anywhere that needs a "who am I?" chip (e.g., the AdminShell sidebar footer at `AdminShell.tsx:642–697` should consume it too, replacing its hand-rolled avatar + email + role rendering).

**`renderProfileMenu` deletion:**
- Once `UserMenu` is wired into the `userMenu` slot at `AppShell.tsx:766` and `AdminShell.tsx:766` (presumed sibling line), delete `renderProfileMenu` (`AppShell.tsx:632–688`) and `renderSidebarFooter` (`AdminShell.tsx:642–697`). The duplicated near-identical menus are a maintenance liability that the design consolidates.

---

## 8 · Out-of-scope (explicit)

This design intentionally does **not** cover:

| Concern | Why deferred |
|---|---|
| SSO / SAML enrollment | Org-admin surface, not personal. Belongs in `/admin/settings/sso`. |
| Billing & subscription | Enterprise contract, not seat-priced. Lives in the org admin area. |
| Team / member management | Already at `/admin/settings/users` (`page.tsx:36`). |
| Workspace creation / deletion | Org-admin scope. |
| Invite a teammate | Same. |
| Audit log viewing for *this* user | Useful, but the audit log lives at `Circle-of-Life-repo/src/lib/audit/`; surface in Sessions tab as a future enhancement, not Phase A. |
| Multi-region preferences (data-residency) | Not a current product capability; would mislead users to expose. |
| Account deletion / GDPR export | Compliance work; needs its own design with legal review. |
| Linking external accounts (Google, Microsoft, Apple) | SSO-adjacent. Out of scope until SSO ships. |
| Status (away / focus) | Wrong product vocabulary; Haven is not a chat product. |

---

## 9 · Why this beats today's surface (per-item gain)

| Item | What the executive gains over today's "email + Account Settings + Sign out" |
|---|---|
| Avatar with name + role + org | They see, in one glance, **whose account** they are using and in **which org**. Today they see only an email string — half useful, half noise. |
| **My profile** → real page | Today's "Account settings" link goes to **alert routing** (`AppShell.tsx:660` → `/admin/settings/notifications` → `notifications/page.tsx` which is `RouteRow` config). The proposed link goes where the label promises: their own account. The misdirection is a credibility leak every time it's clicked. |
| Notification preferences (personal) | Today the user has **no way** to silence non-critical pings on their phone after hours without disabling notifications at the OS level. With per-channel-per-severity preferences + quiet hours, they take control of their own attention. |
| Theme toggle moved in | Frees one slot in the topbar's 9-icon strip, which is at capacity (`AppShell.tsx:763–771`). The Theme picker also gains a **System** option, which the current binary topbar toggle (`AppShell.tsx:606–629`) can't express. |
| Keyboard shortcuts cheat sheet | Today the shortcuts exist (`AppShell.tsx:150–167`, `billing-invoice-ledger.tsx:648–676`) but are undiscoverable. Surfacing them creates the *perception* of a power product — the same trick Linear, Notion, and Superhuman pull. |
| "What's new" feed | The product ships weekly; nobody knows. A single `(•)` dot on the avatar after a release notifies every user, costs ~30 lines of code, and changes the felt velocity of the product overnight. |
| Org context in identity | Brokers (`dashboard-routing.ts:174`) and contracted org_admins may serve multiple organizations. Today they have to guess which org they're acting under. The identity block + org switcher solves this in one move. |
| Facility scope in menu | The topbar already has a facility scope picker (`AppShell.tsx:357–428`); the proposed menu echoes it inside the personal context block. Multi-facility users gain a second, sticky affordance — useful when scrolling has pushed the topbar out of mind. |
| **View as** role impersonation | Owners currently cannot see what their Caregivers see without creating a fake Caregiver login. With one-click read-only "View as Caregiver", they finally understand the mobile-first med-pass surface their staff lives in. This is the single highest-leverage executive empathy tool in the design. |
| Personal API tokens | Unlocks programmatic workflows (Slack-bot push of daily census, Sheets sync, etc.) without exposing the service-role key. Owners with engineering teams will use this within a week. |
| Sessions tab | Today, if a user's iPhone is lost, they have **no way** to invalidate that session short of changing their password. Sessions tab gives them per-device revocation — a basic security expectation in 2026. |
| MFA (Security tab) | Self-explanatory; should have been on day 1. |
| Avatar upload | A face on the menu is the difference between "I am using a piece of software" and "this software knows me." Cheap; outsized perception payoff. |

---

## 10 · Effort breakdown

| Phase | Sub-phase | Hours | Parallel-safe? | Depends on |
|---|---|---|---|---|
| **0** | Bug fix (`renderProfileMenu` error) — owned by separate agent | — | — | — |
| **A.1** | Extend `useHavenAuth` to select `full_name`, `avatar_url` from `user_profiles` (`haven-auth-context.tsx:54` — change `.select("app_role, organization_id")` → `.select("app_role, organization_id, full_name, avatar_url")`); add `fullName` + `avatarUrl` to the context return value at `haven-auth-context.tsx:101–110` | 1 | ✓ — schema columns already exist (`003_user_rbac.sql:7,10`) | Phase 0 done |
| **A.2** | Build `IdentityBlock` (`src/components/ui/identity-block.tsx`) + deterministic gradient avatar fallback | 3 | ✓ | A.1 |
| **A.3** | Build `UserMenu` (desktop popover) with Phase-A items only — Identity / My profile / Notification preferences / Help & docs / Sign out | 3 | ✓ | A.2 |
| **A.4** | Build `UserMenuSheet` (mobile sheet variant) | 2 | ✓ | A.3 |
| **A.5** | Wire `UserMenu` into the `userMenu` slot at `AppShell.tsx:766`; delete `renderProfileMenu` at `AppShell.tsx:632–688` | 1 | depends on A.3 | A.3 |
| **A.6** | Same wiring for `AdminShell.tsx:642–697` (sidebar footer) — consume `IdentityBlock` | 1 | depends on A.2 | A.2 |
| **A.7** | Stub `/admin/profile` page with Profile tab only (avatar upload + display name + email) | 4 | ✓ — write path only touches `user_profiles` columns that already exist | A.1 |
| **A.8** | Visual QA across light/dark + mobile breakpoints; a11y pass (keyboard, screen reader, focus order) | 2 | depends on A.3–A.7 | A.3–A.7 |
| | **Phase A subtotal** | **17h** | | |
| **B.1** | `/admin/profile` Notifications tab (channel matrix + quiet hours) | 5 | ✓ | A.7 |
| **B.2** | `/admin/profile` Security tab (password change modal + MFA enrollment) | 6 | ✓ | A.7 |
| **B.3** | `/admin/profile` Sessions tab (list active sessions, revoke per-device) | 4 | ✓ | A.7 |
| **B.4** | `/admin/profile` Preferences tab (theme/density/landing/timezone) — wire `data-density` to Tailwind variant | 4 | ✓ | A.7 |
| **B.5** | Add `useUserProfile` SWR hook + write-path mutators for all four tabs | 2 | depends on B.1–B.4 | B.1–B.4 |
| | **Phase B subtotal** | **21h** | | |
| **C.1** | Move theme toggle from `AppShell.tsx:606–629` into `UserMenu` as a tri-state radio group; delete `renderThemeToggle` from the topbar | 2 | ✓ | A.3 |
| **C.2** | Add `useUserOrganizations` hook + "Switch organization" submenu (only if > 1 org) | 3 | ✓ | A.3 |
| **C.3** | Add "Facility scope" echo submenu in the menu (reuses the same hooks as `renderFacilityScope` at `AppShell.tsx:357`) | 2 | ✓ | A.3 |
| **C.4** | Build `ShortcutsSheet` — overlay listing ⌘K + page-level shortcuts; wire from menu and from `?` global key | 3 | ✓ | — |
| **C.5** | Density preference end-to-end (Preferences tab → `data-density` → density-aware utilities on 6 high-traffic surfaces) | 4 | depends on B.4 | B.4 |
| | **Phase C subtotal** | **14h** | | |
| **D.1** | "View as" role impersonation — cookie + middleware enforcement (read-only via PostgREST RLS check) + visible top banner | 6 | needs RLS coordination | B.5 |
| **D.2** | "What's new" feed — `changelog` table or static JSON; unread dot on avatar; ChangelogPreview popover | 3 | ✓ | A.3 |
| **D.3** | Personal API tokens — issuance, list, revoke; redact secret after one view | 5 | ✓ | A.7 |
| | **Phase D subtotal** | **14h** | | |
| | **Grand total** | **66h** | | |

**Recommended sequencing:**
1. **Week 1, days 1–3** — Phase A (17h). Ships a credible top-right surface that already beats current state on every axis.
2. **Week 1, day 4 → Week 2, day 2** — Phase B (21h). Ships the dedicated profile page. After this, "Account settings" in the menu does what it says on the tin.
3. **Week 2, days 3–4** — Phase C (14h). Compresses topbar chrome, adds keyboard discoverability, completes the multi-tenant story.
4. **Week 3** — Phase D (14h). View-as + changelog + PATs. These are the items executives will tweet about.

Total: **66 hours** for one engineer, or **~9 working days** with one engineer running serial. With two engineers running in parallel (front-end can split tabs in Phase B, and Phase C is entirely parallel-safe with Phase B), this lands in **~5 working days**.

---

## Closing note

The avatar in the top-right is, for most users, the single highest-frequency-of-glance pixel on the page. It is currently a `UserCircle2` lucide icon (`AppShell.tsx:644`) that points to a stub menu that points to the wrong page. The proposed redesign is not extravagant — it's the same surface that Stripe, Vercel, Linear, and Notion have iterated to and that every modern enterprise app converges on, scaled to Haven's specific multi-tenant + multi-facility + multi-role complexity. None of the recommendations are speculative; every primitive (`Avatar`, `DropdownMenu`, `Sheet`, `Tooltip`, `Skeleton`, `Button`, `next-themes`) is already in the bundle, every schema column (`full_name`, `avatar_url`, `settings`) is already in `user_profiles`, and every role label already lives in `dashboard-routing.ts`. The work is **wiring + a dedicated page**, not net-new infrastructure.

The one thing this design asks the team to commit to that today's surface doesn't: **the avatar is a destination, not a stub.** Once that commitment lands, every subsequent feature (View as, PATs, changelog, sessions, MFA) inherits a sturdy home and the executive's instinct of "where would I go to control this?" terminates correctly on the first click.
