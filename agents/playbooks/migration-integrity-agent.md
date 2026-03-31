# Migration integrity agent

## Contract

Enforced by `scripts/check-migration-order.mjs` (default dir: `supabase/migrations`):

- Filename pattern: `NNN_snake_case_description.sql` (`NNN` = three digits).
- No duplicate numeric prefixes.
- Contiguous sequence from `001` through `N` with **no gaps**.
- Empty directory **passes** (no migrations yet).

## Override

Set `MIGRATIONS_DIR` to point at another folder if the project adopts a different layout.
