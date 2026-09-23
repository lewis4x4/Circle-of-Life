# Homewood Lodge ALF — RBAC Access Matrix

Documents which app routes each `app_role` is expected to be able to load, and a script (`npm run homewood:verify-rbac`) that signs in as each role and asserts reality matches this table.

## Route matrix

> **Regenerated 2026-09-23 (COL-627)** for the COL-615 role model. This is the proxy (shell) layer: what happens when a signed-in role asks for a route. A page can still refuse a role it lets through, and what each role can *read* is enforced by RLS (e.g. housekeepers see resident name, room and logs only — migration 473). The cells come from `scripts/homewood/rbac-matrix.json`, which is generated from `src/lib/auth/rbac-matrix.ts`; `rbac-matrix.test.ts` fails if it drifts from the code, and `npm run homewood:verify-rbac` checks the deployed app against it.

- ✓ — served
- → `route` — sent to that role's own home
- ✗ login — sent to the login screen (no current role should ever get this)

| Route | `owner` | `facility_admin` | `med_tech` | `cook` | `housekeeper` | `recruiter` | `family` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `/admin` | → `/admin/executive` | ✓ | → `/med-tech` | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/residents` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/incidents` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/staff` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/finance` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/payroll` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/training` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/transportation` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/admin/reputation` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | ✓ | → `/family` |
| `/admin/referrals` | ✓ | ✓ | ✓ | → `/dietary` | → `/caregiver/housekeeper` | ✓ | → `/family` |
| `/admin/executive` | ✓ | → `/admin` | → `/med-tech` | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/caregiver` | → `/admin/executive` | → `/admin` | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/caregiver/tasks` | → `/admin/executive` | → `/admin` | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/caregiver/housekeeper` | → `/admin/executive` | → `/admin` | ✓ | → `/dietary` | ✓ | → `/admin/referrals` | → `/family` |
| `/med-tech` | → `/admin/executive` | → `/admin` | ✓ | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/dietary` | ✓ | ✓ | ✓ | ✓ | → `/caregiver/housekeeper` | → `/admin/referrals` | → `/family` |
| `/family` | → `/admin/executive` | → `/admin` | → `/med-tech` | → `/dietary` | → `/caregiver/housekeeper` | → `/admin/referrals` | ✓ |

## How the verifier works

`scripts/homewood/rbac-verify.mjs`:

1. Reads the matrix from `scripts/homewood/rbac-matrix.json` (generated from `src/lib/auth/rbac-matrix.ts`; `rbac-matrix.test.ts` keeps it equal to the shell-access code).
2. For each role, signs in via the canonical Homewood account.
3. For each (role, route) cell, fetches the route with that session's Supabase SSR cookie and expects the cell's outcome: served, sent to the named route, or sent to login.
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
