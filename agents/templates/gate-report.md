# Gate report (human summary) — {{segment_id}}

Machine-readable JSON: `test-results/agent-gates/{{artifact_name}}.json`

| Check | Required | Status | Notes |
|-------|----------|--------|-------|
| qa.migration-sequence | yes | | |
| qa.root-build | yes | | |
| qa.web-build | if apps/web | | |
| chaos.stress-suite | yes* | | *skip with `--no-chaos` |
| cdo.design-review | if `--ui` | | |

**Overall verdict:** PASS / FAIL  
**Mission alignment:** pass / risk / fail  
**Blocking failures:**  
