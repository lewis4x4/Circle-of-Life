# UI-V2 Execution Handoff — Claude Code build plan

**Status:** Planning — spec approved, S0 scaffolding uncommitted, S0 ready to execute
**Created:** 2026-04-24
**Owner:** Brian Lewis
**Spec:** `docs/specs/UI-V2-DESIGN-SYSTEM.md`
**Approval record:** `docs/specs/UI-V2-W0-APPROVAL.md`
**Branch:** `ui-v2` (do not commit to `main` until S12)

**How to resume:** open this file first. Everything needed is below or linked. Then open `docs/specs/UI-V2-DESIGN-SYSTEM.md` for component contracts, migrations, and template skeletons. Then `CLAUDE.md` + `AGENTS.md` for non-negotiables.

---

## The deal

Migrate the Haven admin shell to UI V2 (reference: Executive Command Center, Variant B — dark, role-scoped, cite-backed Copilot, threshold-driven callouts, audit-footer on every page).

Execution: **13 slices (S0–S12)**, each a single atomic commit on branch `ui-v2`. Each slice gated by `npm run segment:gates -- --segment "UI-V2-S<N>"` producing a JSON artifact in `test-results/agent-gates/`. No slice closes without a PASS verdict.

Caregiver (Shell B) and Family (Shell D) mobile shells inherit tokens only; they are out of scope for UI V2.

---

## Build rhythm (non-negotiable — inherited from `SLICE-EXECUTION-HANDOFF.md`)

1. Plan slice → build → self-review → fix errors → run gate → commit + push to `origin/ui-v2` → next slice.
2. **One atomic commit per completed slice.** No partial slices, no cross-slice commits.
3. `npm run segment:gates -- --segment "UI-V2-S<N>"` must produce a JSON artifact with `verdict: "PASS"` before calling a slice done. Add `--ui` for visual/routing changes. `--advisory-check <check-id>` only for explicit documented debt waivers.
4. Update `docs/specs/UI-V2-STATUS.md` after each slice (created in S0).
5. If a slice can't finish in one session, write `docs/specs/UI-V2-S<N>-EXECUTION-PLAN.md` with current progress so the next session resumes without context loss.

---

## The 13 slices (execute in order)

| # | Slice | Primary surface | Gate segment ID | Est. eng-days |
|---|---|---|---|---|
| **S0** | Scaffolding commit + W0 gate infra | `docs/specs/` + `scripts/agent-gates/` + PR template | `UI-V2-S0` | 0.5 |
| **S1** | Tokens + Tailwind + flags + scope + lint rules | `src/design-system/tokens.ts`, `tailwind.config.ts`, `src/lib/flags.ts`, `src/lib/scope.ts`, ESLint rules | `UI-V2-S1` | 1.5 |
| **S2** | Database migrations + RLS | `supabase/migrations/<N+1>–<N+3>` (`user_dashboard_preferences`, `facility_metric_targets`, `alert_audit_log`) | `UI-V2-S2` | 1 |
| **S3** | Primitives A — shell + chrome | `PageShell`, `TopBar`, `AuditFooter`, `FilterBar`, `ScopeSelector` | `UI-V2-S3` | 2 |
| **S4** | Primitives B — KPI | `KPITile`, `TrendDelta`, `Sparkline`, `HealthDot`, `SeverityChip` | `UI-V2-S4` | 2 |
| **S5** | Primitives C — alerts + AI | `Panel`, `PriorityAlertStack`, `ActionQueue`, `CopilotButton` + `CopilotDrawer` | `UI-V2-S5` | 2 |
| **S6** | Primitive D — DataTable | `DataTable` (customize, export, threshold coloring) + `/api/v2/preferences` + `/api/v2/thresholds` | `UI-V2-S6` | 2 |
| **S7** | Templates T1–T8 + W0 closeout | `src/design-system/templates/T1Dashboard.tsx` … `T8Inbox.tsx` + sign `UI-V2-W0-APPROVAL.md` | `UI-V2-S7` | 2 |
| **S8** | W1 — P0 Dashboards (4 pages) | `/admin`, `/admin/executive`, `/admin/quality`, `/admin/rounding` under `(admin)/v2/` | `UI-V2-S8` | 4 |
| **S9** | W2 — P0 List + Detail (8 pages) | Residents, Alerts, Incidents, Admissions + details | `UI-V2-S9` | 5 |
| **S10** | W3 + W4 — P0 analytics + P1 analytics/forms | Standup, Facility detail, Reports, Benchmarks, New-resident/admission forms | `UI-V2-S10` | 6 |
| **S11** | W5 — P1 Settings + remaining lists (12+ pages) | Assessments overdue, rounding queues, Users & Roles, Thresholds, Audit Log, Documents, Tasks, Claims, Staff | `UI-V2-S11` | 7 |
| **S12** | W6 — P2 cleanup + flag removal + merge | Remaining P2 routes, delete V1, remove `NEXT_PUBLIC_UI_V2`, merge `ui-v2` → `main` | `UI-V2-S12` | 5 |

**Total: ≈40 eng-days.** Matches spec §13 estimate (72 eng-days including QA/DevOps/Security overhead).

---

## Current state (2026-04-24)

### Uncommitted WIP on `main` — move to `ui-v2` in S0

Files already written (not committed):
- `docs/specs/UI-V2-DESIGN-SYSTEM.md`
- `docs/specs/UI-V2-W0-APPROVAL.md`
- `docs/specs/UI-V2-EXECUTION-HANDOFF.md` (this file)
- `scripts/agent-gates/sentry-smoke.mjs`
- `scripts/agent-gates/ui-v2-issue-acceptance.mjs`
- `.github/PULL_REQUEST_TEMPLATE/ui-v2.md`
- `scripts/agent-gates/run-segment-gates.mjs` (edited — UI-V2-guarded checks)
- `package.json` (edited — `smoke:sentry`, `smoke:ui-v2-issues` scripts)

### Audit result (2026-04-24)

Most recent completion audit: **0/7** across W0–W6. Correctly failed because:
- Audit ran on `main` (wrong branch).
- Files above were uncommitted.
- `SENTRY_AUTH_TOKEN` returned 401.
- Gate runner hung on `qa.migrations-apply-postgres` without `SKIP_PG_VERIFY=1`.
- S1+ deliverables don't exist yet.

S0 exists to flip the first four items green.

---

## Prerequisites (clear before S0 runs)

1. **Git branch:** `git checkout -B ui-v2 origin/main`.
2. **Sentry env** (`.env.local` + Netlify):
   ```
   SENTRY_ORG=blackrockai
   SENTRY_PROJECT=javascript-nextjs-col
   SENTRY_AUTH_TOKEN=<user token w/ project:read + event:read + org:read>
   ```
   Verify:
   ```
   curl -s -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
     https://sentry.io/api/0/organizations/blackrockai/ | jq .slug
   ```
   Must return `"blackrockai"`. If 401, regenerate token at `https://sentry.io/settings/account/api/auth-tokens/`.
3. **Gate runner unblock:** export `SKIP_PG_VERIFY=1` for local runs OR start Docker Desktop.
4. **Netlify env** (owner sets):
   `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_UI_V2=false` (stays false until S12).
5. **GitHub CLI authed:** `gh auth status` shows logged in.

---

## Non-negotiable rules (inherited — full text in `AGENTS.md`)

1. **RLS first** — every new table enables RLS + policies before data enters.
2. **Audit everything** — `haven_capture_audit_log` trigger on new clinical/financial tables; `audit_log` has no UPDATE or DELETE policies.
3. **Soft deletes only** — `deleted_at timestamptz NULL`; queries filter `WHERE deleted_at IS NULL`.
4. **Money in cents** — `integer`, never `numeric`/`float`/`money`.
5. **UTC timestamptz** — frontend converts to `America/New_York`.
6. **UUID PKs** — `uuid DEFAULT gen_random_uuid()`.
7. **Denormalized `organization_id` + `facility_id`** on RLS-filtered tables.
8. **No secrets in code** — `.env.local` only, never committed.
9. **One slice = one atomic commit** — gate PASS artifact required.
10. **No raw color / raw spacing after S1** — ESLint-enforced via `no-raw-color`, `no-raw-spacing`, `require-kpi-info`.
11. **No Paperclip** — Haven executes through Claude Code; Paperclip is BlackRock AI client work only.
12. **Read COL Alignment Notes** in each referenced spec before implementing.

---

## Per-slice anatomy (required for every slice)

Every slice commit must contain:
1. Code scoped to the slice (no cross-slice bleed).
2. Storybook stories for any new primitive: `loaded`, `empty`, `error` states.
3. Vitest unit tests for logic; snapshot tests for rendered output.
4. `@axe-core/playwright` accessibility test for any visual primitive.
5. Migration files + RLS policies (if DB slice).
6. Updated `docs/specs/UI-V2-STATUS.md` with the slice box ticked.
7. Gate JSON artifact at `test-results/agent-gates/*-UI-V2-S<N>.json` with `verdict: "PASS"` and every `required: true` check at `status: "passed"` (or documented `advisory_override: true`).
8. Commit message: `feat(ui-v2-s<N>): <slice name> [UI-V2-S<N>]`.

---

## Launch protocol — run this at the start of every slice

In a Claude Code session at `/Users/brianlewis/Circle of Life/Circle-of-Life`:

1. `git fetch origin && git checkout ui-v2 && git pull`
2. Read this file + `docs/specs/UI-V2-DESIGN-SYSTEM.md` + `CLAUDE.md` + `AGENTS.md`.
3. Open `docs/specs/UI-V2-S<N>-EXECUTION-PLAN.md` — if it doesn't exist, author it from the "Files to deliver" + "Acceptance" sections below.
4. Read any relevant playbook under `agents/playbooks/` (see Appendix A).
5. Implement the slice. Honor non-negotiables.
6. Self-review the diff. Fix obvious issues before gating.
7. Run: `npm run lint && npm run build`.
8. Run: `SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S<N>"` (add `--ui` if the slice touches routes or visual components).
9. If gate PASS: `git add -p`, commit with slice commit message, `git push origin ui-v2`.
10. If gate FAIL: fix, re-run gate. Do NOT move to next slice.
11. Update `docs/specs/UI-V2-STATUS.md` — tick slice box, record gate artifact filename.

---

## Slice S0 — Scaffolding commit + W0 gate infrastructure

**Goal:** Commit the already-written scaffolding to `ui-v2`. Confirm gate infrastructure runs end-to-end.

**Files to deliver** (all already exist in working tree — just stage + commit):
- `docs/specs/UI-V2-DESIGN-SYSTEM.md`
- `docs/specs/UI-V2-W0-APPROVAL.md`
- `docs/specs/UI-V2-EXECUTION-HANDOFF.md` (this file)
- `docs/specs/UI-V2-STATUS.md` (NEW — slice tracker; create in S0)
- `scripts/agent-gates/sentry-smoke.mjs`
- `scripts/agent-gates/ui-v2-issue-acceptance.mjs`
- `.github/PULL_REQUEST_TEMPLATE/ui-v2.md`
- `scripts/agent-gates/run-segment-gates.mjs` (modified)
- `package.json` (modified)

**`docs/specs/UI-V2-STATUS.md` content** (create fresh):
```md
# UI-V2 Status

- [ ] S0 — Scaffolding commit + gate infra
- [ ] S1 — Tokens + Tailwind + flags + scope + lint
- [ ] S2 — Migrations + RLS
- [ ] S3 — Primitives A (shell + chrome)
- [ ] S4 — Primitives B (KPI)
- [ ] S5 — Primitives C (alerts + AI)
- [ ] S6 — DataTable
- [ ] S7 — Templates T1–T8 + W0 closeout
- [ ] S8 — W1 P0 dashboards
- [ ] S9 — W2 P0 list+detail
- [ ] S10 — W3+W4 analytics + forms
- [ ] S11 — W5 settings + lists
- [ ] S12 — W6 cleanup + flag removal + merge
```

**Gate command:**
```
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S0"
```

**Acceptance:**
- Branch `ui-v2` exists and tracks `origin/ui-v2`.
- All files listed above are committed in a single commit.
- `npm run smoke:sentry` exits 0 (PASS or SKIP — NOT FAIL).
- `npm run smoke:ui-v2-issues` exits 0 (no closed `ui-v2` labeled issues yet).
- Gate JSON at `test-results/agent-gates/*-UI-V2-S0.json` has `verdict: "PASS"`.
- S0 box ticked in `UI-V2-STATUS.md`.

**Commit message:** `feat(ui-v2-s0): W0 scaffolding + gate infrastructure [UI-V2-S0]`

---

## Slice S1 — Tokens + Tailwind + flags + scope + lint rules

**Goal:** Every future primitive can consume design tokens via Tailwind semantic classes. Feature flag gates V2 routes. `useScope()` preserves Owner/Group/Facility/DateRange through URL search params. ESLint fails builds that ship raw color/spacing.

**Files to deliver:**
- `src/design-system/tokens.ts` — full token tree per `UI-V2-DESIGN-SYSTEM §3`.
- `tailwind.config.ts` — token wiring per `UI-V2-DESIGN-SYSTEM §3` (extend colors, fontFamily, borderRadius, boxShadow).
- `src/lib/flags.ts` — exports `uiV2(): boolean` reading `process.env.NEXT_PUBLIC_UI_V2`.
- `src/lib/scope.ts` — exports `useScope(): [Scope, (partial: Partial<Scope>) => void]` reading/writing URL search params (`owner`, `group`, `facility[]`, `start`, `end`). Zod-validated.
- `src/middleware.ts` — edit existing. When `uiV2()` is true AND `/admin/v2/<segment>/page.tsx` exists, rewrite `/admin/<segment>` → `/admin/v2/<segment>`. Otherwise fall through to V1.
- `eslint-rules/no-raw-color.mjs` — inline ESLint rule blocking hex (`#[0-9a-f]`) and `rgb(` literals in `.tsx`/`.ts` files under `src/design-system/components/**`, `src/app/(admin)/v2/**`.
- `eslint-rules/no-raw-spacing.mjs` — inline rule blocking raw `px`/`em`/`rem` values in `className` attribute strings inside the same scope.
- `eslint-rules/require-kpi-info.mjs` — rule flagging `<KPITile>` usage missing `info` prop when `value` is computed (best-effort).
- `eslint.config.mjs` — register the three rules against the scoped paths above.
- `src/design-system/tokens.test.ts` — Vitest snapshot guard on the token export shape.
- `src/lib/scope.test.ts` — Vitest tests: URL round-trip, Zod validation rejects malformed input.

**Gate command:**
```
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S1"
```

**Acceptance:**
- `npm run lint` passes. If pre-existing files fail the new rules, add them to `.eslintignore` with an `// TODO(ui-v2): migrate` comment OR use `--advisory-check qa.eslint` and record in `docs/specs/PHASE1-WAIVER-LOG.md`.
- `npm run build` passes.
- `tokens.ts` exports exactly match `UI-V2-DESIGN-SYSTEM §3`.
- `uiV2()` returns `false` in test env unless `NEXT_PUBLIC_UI_V2=true`.
- `useScope()` round-trips `{ownerId, groupId, facilityIds[], dateRange}` through URL.
- Middleware rewrite unit-tested for: V2 route exists + flag on, V2 route missing + flag on, flag off.
- Gate JSON PASS.

**Commit message:** `feat(ui-v2-s1): design tokens + flags + scope + lint rules [UI-V2-S1]`

---

## Slices S2–S12 — execution plans authored at checkout

For each slice S2 through S12:
1. At start of the slice, **create `docs/specs/UI-V2-S<N>-EXECUTION-PLAN.md`** using S0/S1 inline plans above as the template.
2. Fill in: Goal, Files to deliver, Gate command, Acceptance, Commit message.
3. Resolve any `UI-V2-DESIGN-SYSTEM.md §16` open questions that block the slice. Update §16 with resolutions.
4. Execute per the Launch Protocol.

The slice table (§ "The 13 slices") is the contract for what each slice contains. `UI-V2-DESIGN-SYSTEM.md` is the source of truth for component contracts (§4), page templates (§5), page-to-template mapping (§6), migration DDL + RLS (§7), routing + flag strategy (§8), acceptance criteria (§10), authorization matrix (§11), and rollback (§12).

---

## Appendix A — Agent playbook references

Use existing Haven playbooks at `agents/playbooks/` for specialized review on complex slices. Do NOT bring in new agent files.

| When | Playbook |
|---|---|
| S2 (DB migrations + RLS) | `agents/playbooks/security-rls-agent.md` + `agents/playbooks/migration-integrity-agent.md` |
| S3–S7 (primitives + templates) | `agents/playbooks/chief-design-officer-agent.md` |
| Any slice | `agents/playbooks/engineer-of-record.md`, `agents/playbooks/qa-agent.md` |
| S7, S12 (major gates) | `agents/playbooks/release-gate-agent.md` |
| S8–S12 (page migrations at scale) | `agents/playbooks/performance-agent.md` |

---

## Appendix B — Parallelization (optional)

S3/S4/S5/S6 are independent primitive batches. They can run in parallel via git worktrees IF needed:

```
git worktree add ../col-ui-v2-s3 ui-v2-s3
git worktree add ../col-ui-v2-s4 ui-v2-s4
# separate Claude Code sessions per worktree
# each commits to its own branch
# merge ui-v2-s3..s6 → ui-v2 before starting S7
```

Default for a solo operator: **sequential** S3 → S4 → S5 → S6. Simpler merge flow.

---

## Appendix C — Rollback

- **Slice-level:** `git revert <commit>` on `ui-v2`.
- **Feature flag:** set `NEXT_PUBLIC_UI_V2=false` in Netlify → redeploy. All routes fall through to V1.
- **Database:** run rollback SQL in `UI-V2-DESIGN-SYSTEM.md §12` — drops the three V2 tables in the safe order.
- **Full abort:** `git branch -D ui-v2` + revert Netlify env + drop tables. V1 untouched.

---

## Appendix D — Audit contract

After each slice, the completion audit will read:
- `test-results/agent-gates/*-UI-V2-S<N>.json` — must exist, `verdict: "PASS"`.
- `docs/specs/UI-V2-STATUS.md` — slice box must be ticked.
- `git log origin/ui-v2 --grep "UI-V2-S<N>" --oneline` — must return exactly one commit.
- For S7: `docs/specs/UI-V2-W0-APPROVAL.md` §4 must have all 8 boxes ticked + §5 signature populated.
- For S12: `git log origin/main --grep "UI-V2-S12" --oneline` — one commit on main; `rg "NEXT_PUBLIC_UI_V2" src/` returns zero matches (flag removed).

---

## Ready to execute

Open a fresh Claude Code session at `/Users/brianlewis/Circle of Life/Circle-of-Life`. Paste:

> Read `docs/specs/UI-V2-EXECUTION-HANDOFF.md`. Execute Slice S0 per its inline execution plan. Do not proceed to S1 until S0 gate is PASS and committed to `origin/ui-v2`.

End of handoff.
