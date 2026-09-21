# QA Documentation

Manual testing guides, bug reporting, and triage. Driven by the
[running-bug-review-board](https://github.com/) skill — see
`~/.agents/skills/running-bug-review-board/SKILL.md` for the full
workflow.

## Documents

| Document | Audience | Purpose |
|----------|----------|---------|
| [QA_GATES.md](./QA_GATES.md) | Engineering, QA | Pass/fail gate checklists per phase |
| [bug-reports/README.md](./bug-reports/README.md) | QA | How to file bugs and triage workflow |
| [bug-reports/_template.md](./bug-reports/_template.md) | QA | Copy for each new bug report |
| [runs/](./runs/) | QA, engineering | Per-shard run reports + coordinator merges |
| `phase-NN-<slug>-manual-test-plan.md` | QA, UAT | Step-by-step scenarios per phase |

## Workflow

```
1. Run manual test plan → 2. Mark gate or file bug → 3. Bug review (BRB)
                       → 4. Fix or defer → 5. Re-test → 6. Sign off phase
```

1. **Setup** — start dev server, mobile viewport (375px primary),
   incognito for fresh users.
2. **Execute** — Follow the phase manual test plan; check off scenarios
   as you go.
3. **Gate** — Update pass/fail in [QA_GATES.md](./QA_GATES.md).
4. **Bugs** — Copy [bug-reports/_template.md](./bug-reports/_template.md)
   → `bug-reports/BUG-NNN-short-title.md`.
5. **Review** — Engineering triages open bugs weekly (or before phase
   sign-off).

## Test environment

| Item | Value |
|------|--------|
| Local URL | http://localhost:3000 |
| Viewport | 375px minimum (mobile-first) |
| Fresh users | Incognito / private window + new test account |
| Auth test fixtures | See test-accounts reference in the skill |

## Suggested test personas

| Persona | Purpose |
|---------|---------|
| **Admin** | Creates groups, invites, manages roles |
| **Member A** | First invite signup |
| **Member B** | Second user via same multi-use invite link |

Keep test account passwords in your team's password manager — do not
commit credentials.
