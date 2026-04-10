# QA agent

## Role

Validate acceptance signals the gate runner encodes: **migrations order**, **production build**, and optional **app package build**.

## Automated checks (in `segment:gates`)

- `migrations:check` — SQL file naming and contiguous numbering.
- `build` — root Next.js production build (includes migration check).
- `build:web` — runs only if `apps/web/package.json` exists.

## Manual / exploratory

Document device or flow checks in the segment handoff when automation cannot cover them.

## See also

- `docs/Autonomous.md` — autonomous loop continuity (BOOT / FIND / RECORD) between sessions.
