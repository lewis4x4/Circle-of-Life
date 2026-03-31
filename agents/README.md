# Agents

This folder defines **roles, gate order, and playbooks** for the autonomous segment + gate workflow.

- **`registry.yaml`** — canonical gate order, `north_star_mission`, and per-role metadata.
- **`playbooks/`** — human-readable instructions for each agent role (used by people and coding agents).
- **`templates/`** — copy/paste structures for handoffs and local gate notes.
- **`schemas/gate-report.schema.json`** — JSON shape for `test-results/agent-gates/*.json`.

The deterministic runner lives in **`scripts/agent-gates/run-segment-gates.mjs`** and is invoked via **`npm run segment:gates`**.
