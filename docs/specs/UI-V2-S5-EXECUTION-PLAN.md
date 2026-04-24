# UI-V2 Slice S5 — Primitives C (alerts + AI)

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §4 (primitives P07, P08, P09, P14) + §4.1 (PriorityAlertStack contract) + §7.3 (alert_audit_log) + ADR-004 (Copilot citations)
**Depends on:** S4 committed; S2 migrations live (`alert_audit_log` table)
**Est. eng-days:** 2

## Goal

Four primitives handle exception triage and AI surface. `<PriorityAlertStack>` ACK writes to `alert_audit_log` transactionally. `<CopilotButton>` / `<CopilotDrawer>` refuse to render unsourced suggestions.

## Files to deliver

### P07 — `<Panel>`

- `src/design-system/components/Panel/...`
- Wraps existing `V2Card` (`src/components/ui/moonshot/v2-card.tsx`) — do NOT duplicate card styles.
- Props: `{ title, subtitle?, info?, actionCta?, children }`.
- States: `default`, `withInfo`, `withActionCta`, `loading`, `error`.

### P08 — `<PriorityAlertStack>`

- `src/design-system/components/PriorityAlertStack/...`
- Props exactly per `§4.1 AlertItem[]`.
- ACK button onClick:
  1. Optimistic UI: remove from stack.
  2. POST `/api/v2/alerts/[id]/ack` (handler in this slice).
  3. Server writes `alert_audit_log` row + marks alert acknowledged, single transaction.
  4. Rollback on failure with toast.
- Route handler: `src/app/api/v2/alerts/[id]/ack/route.ts`.
- States: `empty`, `oneHigh`, `highMediumLow`, `ackInFlight`, `ackError`.

### P09 — `<ActionQueue>`

- `src/design-system/components/ActionQueue/...`
- Props: `{ items: { id, icon, label, sublabel, count, href }[] }`.
- Pure presentational. Count badge uses danger tone when >0.
- States: `empty`, `oneRow`, `manyRows`, `zeroCount`.

### P14 — `<CopilotButton>` + `<CopilotDrawer>`

- `src/design-system/components/CopilotButton/CopilotButton.tsx`
- `src/design-system/components/CopilotButton/CopilotDrawer.tsx` (internal, owned by button)
- `<CopilotButton>` is a button with `cite-backed` chip + sparkle icon. Opens `<CopilotDrawer>`.
- `<CopilotDrawer>` enforces: every suggestion item must carry `{ recordId, recordType, facilityId, generatedAt, modelVersion, citations: [{source, id, excerpt}] }`. Suggestions missing `citations.length > 0` are filtered out and logged (console.warn in dev).
- Accept `ack`, `act`, `dismiss` actions — each writes to a Copilot audit endpoint (stub in this slice, wire in S10 analytics slice).
- States: `closed`, `openEmpty`, `openWithSuggestions`, `openSuggestionSelected`.

## Additional requirements

1. ACK endpoint uses Supabase service-role client server-side; client-side `fetch` posts with user's JWT. RLS enforces facility membership.
2. ACK writes `{ alert_id, action: "ack", actor_id: auth.uid(), actor_role: role, facility_id, created_at: now() }` — audit table per §7.3.
3. Copilot filter logic + console warning is covered by a Vitest test (`CopilotDrawer.test.tsx`).
4. No new env vars or feature flags introduced in this slice.

## Gate command

```bash
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S5" --ui
```

## Acceptance

- Four primitives with 4-file pattern; CopilotButton additionally includes `CopilotDrawer.tsx` + `CopilotDrawer.test.tsx`.
- ACK Vitest test: mocks Supabase, asserts audit row insertion + optimistic UI.
- `<CopilotDrawer>` rejects uncited suggestion in test.
- axe-core zero violations.
- `npm run lint && npm run build` pass.
- Gate JSON PASS.
- `UI-V2-STATUS.md` S5 box ticked.

## Review hooks

- `agents/playbooks/security-rls-agent.md` — ACK endpoint RLS review.
- `agents/playbooks/chief-design-officer-agent.md`.
- `agents/playbooks/qa-agent.md`.

## Commit message

`feat(ui-v2-s5): primitives C — alerts + AI [UI-V2-S5]`

## Gotchas

- ACK must be idempotent — double-click on button, retry after network failure, etc., must not produce duplicate audit rows. Use `alert_id + action + actor_id` uniqueness guard in handler (SELECT before INSERT) rather than DB unique constraint (ACK can happen multiple times across a lifetime; only dedupe within a session window).
- CopilotDrawer citations format is the contract — Copilot backend (source unresolved — §16 open question 5) must emit this shape. If backend isn't ready, stub a fixture at `src/design-system/components/CopilotButton/__fixtures__/suggestions.json` and mark as stubbed until backend lands.
