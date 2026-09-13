# Fable 5.1 — COL-159 / HFO-22 handoff

**[HFO-22] Connect dietary, facility services and general admin evidence**
Issue UUID: `1ed5af55-72be-4b41-af3a-0c6fb718333b` · COL-159
Owner: Brian reserved **Fable 5.1** (not Sol). Haven orchestrates + GATE. Lewi reviews + Linear closeout.

## Prior stack (do not mutate)
- COL-154 Done — tip `47455a13`, draft PR #477
- COL-147 Done — tip `a625b75a`, draft PR #476
- COL-143 parked In Progress — hosted Storage; source PR #472 tip `45ea4ea9` untouched tonight

## Worktree / branch
- Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Dietary Admin`
- Branch: `codex/hfo-col159-dietary-admin` @ `47455a13`
- Do not edit COL-147 / COL-154 / COL-143 worktrees for feature work

## Scope
Complete AL coverage pass for meals/substitutions/menu approval, sanitation, stock, filters/inspections, calendar/marketing/mail and service/license evidence.
Source items: AL-D01, AL-D02, AL-D03, AL-D11, AL-D16, AL-W01, AL-W03, AL-W04, AL-M01, AL-M08, AL-M10, AL-M11, AL-A07, AL-A08, AL-Y01–AL-Y07

## Acceptance
1. Every remaining Daily/Weekly/Monthly/Audit/Quarterly/Yearly item has an accessible capture/source path or specifically identified question; no silent omissions.
2. Meal-level records and audit/performance are distinct; relevant equipment/site applicability controls tasks.
3. Composite checks preserve evidence components; service recording does not silently advance unrelated lifecycle; outbound content not auto-published.

## Hard opens — do not invent
Q09, Q11, Q14, Q28.

## Delivery
Contract first. Recheck migration slot (347 taken on this stack — next free likely 348). Segment gates + IR. Draft PR vs `codex/hfo-col154-drill-generators`. **Ping Haven/Lewi the moment draft PR + segment GATE PASS land.** Done = reviewed gated unmerged source. No merge/deploy. COL-143 hosted stays parked.
