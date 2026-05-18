# P0 — RBAC enum leak audit (user-facing copy)

## Goal

Ensure **no user-visible label, title, helper text, or empty state** renders raw authorization enums from the session model (for example `org_admin`, `owner`, `facility_admin`, `staff`, `caregiver`). Permission is enforced in **APIs, RLS, and route guards**; surface copy should use **human phrasing** (“Administrator”, “Requires administrator role to edit”) or stay **generic**.

## Work

1. Search the `src/` tree for JSX/TSX strings containing role-like tokens (including underscore forms). Exclude legitimate server-only checks, migrations, specs, and policy code.
2. Flag any `template` / interpolation of `user.role`, `actor.app_role`, or similar into displayed text.
3. Fix leaks; prefer design-system patterns already used for capability-gated sections.
4. Optionally add an ESLint rule or codemod if leaks recur.

## Relationship to Haven

Communications **Online presence** formerly leaked `(owner / org_admin)` in a section title; that pattern must not repeat elsewhere.

Track remediation in a GitHub issue titled **“P0: RBAC enum leak audit (UI copy)”** and link the issue from the PR that closes the first batch of fixes.
