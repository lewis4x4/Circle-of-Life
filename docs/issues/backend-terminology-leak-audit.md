# Backend terminology leak audit (user-facing copy)

Single pass across product UI helper text, placeholders, banners, tables, empty states.

## Forbidden patterns in user-visible strings

Case-insensitive scan for leaked implementation detail, including:

- `RLS`, row level security  
- `Supabase`, `pg_cron`, `cron-driven`  
- `metadata`, `schema`, table names used as jargon  
- `RPC`, `edge function`, `migration`  

Prefer operator language (“for the selected scope,” “scheduled billing,” “activity log”) and link to docs/admin settings where ops need depth.

## Parity with other audits

Treat like RBAC enum leak audit and UUID-as-attribution sweep: inventory, classify (block / fix inline / doc-only), patch, design review.
