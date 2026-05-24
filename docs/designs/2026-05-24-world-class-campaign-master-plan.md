# World-Class Campaign — Master Plan

**Date:** 2026-05-24
**CEO Co-Pilot:** JARVIS
**Status:** ✅ APPROVED — proceed to build
**Source plans:**
- [Haven Insight Conversation Threads Architecture](./2026-05-24-haven-insight-threads-architecture.md)
- [Profile / Account Experience Design](./2026-05-24-profile-experience-design.md)
- [Hygiene + CI/CD Pipeline Plan](./2026-05-24-hygiene-pipeline-plan.md)
- [Profile menu failure root cause](inline — single-line fix in `src/lib/flags.ts`)

---

## CEO review verdict

All 4 sub-plans pass the moonshot bar. Each is grounded in real codebase patterns with file:line citations, ships with explicit acceptance criteria, and proposes the right architectural call (not the easy one). Highlights:

- **Threads:** private-by-default RLS, zero-latency auto-title via piggyback on existing SSE stream, sliding-window context + rolling summary at >12 turns, realtime cross-tab sync in v1.
- **Profile bug:** one-line fix in `src/lib/flags.ts` removes the `/settings/notifications` route from the broken V2 stub mapping; V1 page serves correctly.
- **Profile UX:** uncovered a credibility leak — current "Account settings" link points to facility-wide alert routing, not personal profile. 320px popover + 5-tab `/admin/profile` page, View-as impersonation, deterministic gradient avatars, theme toggle moved into menu.
- **Hygiene:** new `SECRETS-MANIFEST.md` as source of truth, changed-function-only Edge Function deploy CI (with `_shared` import detection + `config.toml` block diffing), refresh route wired with `risk-nightly-scorer` at `notify: false` for manual safety, pg_cron with DST guard for nightly automation.

No revisions needed. Approving for build.

---

## Scope decision

The 4 plans combined describe ~150+ engineering hours. Today, I'm shipping the **CRITICAL PATH** (~25-30h of agent work) that delivers the highest leverage and unblocks everything else. The rest is queued as named follow-ups.

### 🚀 SHIP TODAY (this session)

| # | Phase | Source plan | Why now |
|---|-------|-------------|---------|
| 1 | Profile bug fix (1-liner) | Profile diagnosis | Blocks every avatar click — top-priority |
| 2 | Chip fix commit (already in tree) | Earlier in session | Already done, just needs commit |
| 3 | Hygiene Phase A — docs + `SECRETS-MANIFEST.md` | Hygiene §1 | Closes drift; zero risk; high leverage |
| 4 | Hygiene Phase B — risk-nightly-scorer wired into refresh + UI copy + Exec Overview link rename | Hygiene §3-4 | Completes the executive refresh chain (5th KPI populates from the button); fixes user's "I clicked 15 times" mislabel pain |
| 5 | Hygiene Phase C — Edge Function deploy CI | Hygiene §2 | Eliminates manual `supabase functions deploy` forever |
| 6 | Threads P0 — migrations 274+275 (`exec_nlq_messages` table, RLS, RPCs) | Threads §1 | Unblocks all thread work |
| 7 | Threads P1 — BE: haven-ai-router thread append + auto-title + multi-turn context | Threads §2 | Activates threads on existing FE writes |
| 8 | Threads P2+P3 — FE: ConversationSidebar with rename/pin/delete + URL routing | Threads §3 | The world-class sidebar UX |
| 9 | Profile UX Phase A — UserMenu popover + IdentityBlock + minimal `/admin/profile` stub | Profile UX §A | Credibility unlock; uses existing schema |

### 🛬 QUEUED for next campaign (explicit deferrals)

| # | Item | Source plan | Why deferred |
|---|------|-------------|--------------|
| 10 | Threads P4 — realtime cross-tab sync + search bar | Threads §3.4 | Nice-to-have; doesn't block adoption |
| 11 | Threads P5 — telemetry instrumentation + Cypress smoke test | Threads §4.1 | Observability layer; can ship later |
| 12 | Profile UX Phase B — 5-tab profile page (Notifications/Security/Sessions/Preferences) | Profile UX §B | 21h on its own — own campaign |
| 13 | Profile UX Phase C — theme toggle move + shortcuts sheet + org switcher | Profile UX §C | Depends on Phase B |
| 14 | Profile UX Phase D — View-as impersonation + PATs + changelog feed | Profile UX §D | Premium executive features; own campaign |
| 15 | Hygiene Phase D — pg_cron nightly scheduler | Hygiene §5 | Requires Vault setup; own campaign |

---

## Wave dispatch plan

### Wave 1 — Independent parallel (5 agents)

All touch different files. Cross-warning briefs warn each agent of siblings.

| Agent | Scope | Primary files |
|-------|-------|---------------|
| **B-1** | Profile bug fix + V2 stub timezone fix (bonus) | `src/lib/flags.ts`, `src/app/(admin)/admin/v2/settings/notifications/page.tsx` |
| **B-2** | Hygiene Phase A — docs + SECRETS-MANIFEST | `.env.example`, `AGENTS.md`, `supabase/functions/README.md`, `docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md`, NEW `docs/specs/SECRETS-MANIFEST.md` |
| **B-3** | Hygiene Phase B — refresh route + UI copy | `src/app/api/admin/executive/refresh/route.ts`, `route.test.ts`, `src/components/executive/ExecutiveOverviewPageClient.tsx` |
| **B-4** | Threads P0 — migrations | NEW `supabase/migrations/274_exec_nlq_threads.sql`, NEW `supabase/migrations/275_exec_nlq_threads_rpc.sql` |
| **B-5** | Hygiene Phase C — Edge Function deploy CI | NEW `.github/workflows/edge-functions-deploy.yml` |

### Wave 2 — Threads BE + FE (2 agents, both depend on B-4 migrations)

| Agent | Scope | Primary files |
|-------|-------|---------------|
| **B-6** | Threads P1 — BE: append-to-thread, auto-title, multi-turn | `supabase/functions/haven-ai-router/index.ts`, NEW `supabase/functions/_shared/router-context.ts` |
| **B-7** | Threads P2+P3 — FE sidebar + URL routing + actions | `src/app/(admin)/executive/nlq/page.tsx`, NEW `src/components/haven-insight/ConversationSidebar.tsx` |

### Wave 3 — Profile UX Phase A (1 agent, can run alongside Wave 2)

| Agent | Scope | Primary files |
|-------|-------|---------------|
| **B-8** | Profile UX Phase A — popover + IdentityBlock + `/admin/profile` stub | `src/contexts/haven-auth-context.tsx`, NEW `src/components/ui/identity-block.tsx`, NEW `src/components/layout/UserMenu/`, NEW `src/app/(admin)/admin/profile/page.tsx`, `src/components/layout/AppShell.tsx` (replace `renderProfileMenu`) |

### Wave 4 — Deploy

| Step | Action |
|------|--------|
| 1 | `git status` + verify all 3 waves complete |
| 2 | `git commit` everything with a multi-section message |
| 3 | `git push` → Netlify auto-deploys FE |
| 4 | `supabase functions deploy haven-ai-router --project-ref manfqmasfqppukpobpld` |
| 5 | `supabase db push --linked` (applies 274 + 275 migrations) |
| 6 | Smoke test: open `/admin/executive/nlq`, ask question, confirm thread saves, click avatar, confirm `/admin/profile` loads |

---

## Living progress tracker

| Wave | Agent | Status |
|------|-------|--------|
| 1 | B-1 Profile bug fix | ✅ complete (notifications V2 rewrite removed + AuditFooter timezone fallback hardened) |
| 1 | B-2 Hygiene Phase A docs | ✅ complete |
| 1 | B-3 Hygiene Phase B refresh | ✅ complete |
| 1 | B-4 Threads P0 migrations | ✅ complete |
| 1 | B-5 Edge Function deploy CI | ✅ complete |
| 2 | B-6 Threads P1 BE | ✅ complete |
| 2 | B-7 Threads P2+P3 FE | ✅ complete |
| 3 | B-8 Profile UX Phase A | ✅ complete |
| 4 | Commit + Push + Deploy | ⛔ blocked on Waves 1-3 |

Sub-agent boundary rule: only touch files inside your assigned scope per the table above. If you find issues outside your scope, note them at the bottom of this tracker — do not implement.

---

## Deferred items log

(populated by sub-agents when they find scope-out items during build)

—
