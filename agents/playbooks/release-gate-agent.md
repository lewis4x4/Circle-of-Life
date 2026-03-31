# Release gate agent

## Role

Aggregate **GO / NO-GO** from the deterministic runner output.

## Rules

- Any **required** failed check ⇒ overall **FAIL**.
- **Mission misalignment** (`fail`) can block even if all checks are green—document waiver if overriding.
- The JSON artifact in `test-results/agent-gates/` is the machine-readable source of truth.

## After GO

Stage **only** segment files, one atomic commit, push, then start the next segment.
