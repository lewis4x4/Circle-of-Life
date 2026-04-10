# Segment handoff — {{segment_id}}

**See also:** Autonomous loop continuity (BOOT / FIND / RECORD) — `docs/Autonomous.md`.

## Summary

- **Segment id:** {{segment_id}}
- **Mission alignment:** `pass` | `risk` | `fail` — _one line why_
- **Scope:** what changed (files/areas)
- **Out of scope:** what was explicitly not done

## Implementation notes

- Key decisions
- Follow-ups / debt

## Verification

- Gate artifact path: `test-results/agent-gates/<timestamp>-{{segment_id}}.json`
- `npm run segment:gates -- --segment "{{segment_id}}"` result: PASS / FAIL

## Commit

- Intended conventional message: `feat:` / `fix:` / `chore:` + summary
