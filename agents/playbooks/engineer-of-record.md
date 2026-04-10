# Engineer of record

## Role

Implement **one bounded segment**. Produce a handoff using `agents/templates/segment-handoff.md`.

## Must do

- Keep the segment small enough to review and gate in one pass.
- State **mission alignment** (`pass` | `risk` | `fail`) with one concrete sentence.
- Run `npm run segment:gates -- --segment "<id>"` before declaring complete; use `--ui` when routes or UI changed.

## Must not

- Mix unrelated refactors into the same segment.
- Skip the gate JSON artifact under `test-results/agent-gates/`.

## See also

- `docs/Autonomous.md` — autonomous loop continuity (BOOT / FIND / RECORD) between sessions.
