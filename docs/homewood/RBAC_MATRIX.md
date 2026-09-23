# Homewood Lodge ALF — RBAC Access Matrix

Documents which app routes each `app_role` is expected to be able to load, and a script (`npm run homewood:verify-rbac`) that signs in as each role and asserts reality matches this table.

- ✓ — role is allowed to load the route (2xx response)
- ✗ — role is blocked (4xx, or redirect to `/login` / `/unauthorized`)
- △ — allowed with restrictions (footnoted)

## Route matrix

> **Roles updated 2026-09-22 (COL-615).** `nurse` and `caregiver` are retired login roles folded into `med_tech`, and `dietary` / `dietary_aide` are folded into `cook` (migration 468; see the Roles section in `AGENTS.md`). The `med_tech` column below is the union of what the old `nurse`, `caregiver` and `med_tech` columns allowed, and `cook` is the old `dietary` column. Not yet re-verified: `scripts/homewood/rbac-verify.mjs` still carries the pre-2026-09-22 columns (`nurse`, `caregiver`, `dietary`) and the `/admin/command` row, which no longer exists as a route. Both need regenerating against the live app before this matrix is treated as verified. `housekeeper` (floor app housekeeper paths only) and `recruiter` (`/admin/referrals`, pipeline and reputation only) are not in the verifier yet.

| Route | owner | facility_admin | med_tech | family | cook |
|---|:-:|:-:|:-:|:-:|:-:|
| `/admin/command` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `/admin/residents` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `/admin/incidents` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `/admin/staff` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/admin/finance` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/admin/payroll` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/admin/training` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `/admin/dietary` | ✓ | ✓ | ✗ | ✗ | △ ¹ |
| `/admin/transportation` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/admin/reputation` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/caregiver` | ✗ ² | ✗ ² | ✓ | ✗ | ✗ |
| `/caregiver/tasks` | ✗ ² | ✗ ² | ✓ | ✗ | ✗ |
| `/caregiver/meds` | ✗ ² | ✗ ² | ✓ | ✗ | ✗ |
| `/med-tech` | ✗ ² | ✗ ² | ✓ | ✗ | ✗ |
| `/family` | ✗ | ✗ | ✗ | ✓ | ✗ |
| `/dietary` | ✗ ² | ✗ ² | ✗ | ✗ | ✓ |
| `/login` | ✓ | ✓ | ✓ | ✓ | ✓ |

**Footnotes:**

¹ Cooks can edit their own dietary hub but cannot edit clinical care plans referenced from it.
² Admin-tier roles (owner, facility_admin) are routed to their admin home on sign-in. They have the rights to view shell-specific routes (`/caregiver`, `/med-tech`, `/dietary`), but the app's landing-redirect logic sends them to admin instead. The verifier reports those as "allowed with redirect" — not a failure. Med-Techs land on `/med-tech` and also use the floor app at `/caregiver`.

## How the verifier works

`scripts/homewood/rbac-verify.mjs`:

1. Reads this matrix from a structured constant inside the script (kept in sync with this doc).
2. For each role, signs in via the canonical Homewood account.
3. For each (role, route) cell, fetches the route with the authenticated cookie/header.
4. Compares the observed response against the expected cell value:
   - ✓ expected, observed 2xx → PASS
   - ✗ expected, observed 4xx or redirect to `/login`/`/unauthorized` → PASS
   - mismatch → FAIL with the observed status

If the matrix and reality disagree, the verifier fails. Per the brief: fix the middleware/RLS to make reality match the matrix — do not silently update the matrix to match broken reality.

## Re-running

```bash
BASE_URL=http://127.0.0.1:4310 npm run homewood:verify-rbac
```

Required env (same set as `homewood:verify-auth`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `HOMEWOOD_LAUNCH_PASSWORD` (falls back to `PHASE1_DEMO_PASSWORD` for local convenience)
- `BASE_URL` (required — no fallback)

The verifier writes a per-cell pass/fail summary to stdout and exits non-zero on any mismatch.
