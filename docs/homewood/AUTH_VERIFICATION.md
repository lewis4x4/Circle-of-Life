# Homewood Lodge ALF — Auth Verification

_Generated: `2026-05-16T14:47:42.010Z` against `manfqmasfqppukpobpld.supabase.co` (facility `00000000-0000-0000-0002-000000000003`)._

Re-run with `npm run homewood:verify-auth`. Set `BASE_URL=http://127.0.0.1:4310` (or your deploy) to additionally fetch each role's landing route.

## Top-line

- Homewood `user_facility_access` grants: **8**
- Accounts with matching `auth.users` row: **8**
- Orphan grants (user_id without auth row): **0**
- Accounts that authenticate with the configured password and resolve to the expected role: **6 / 8**
- Route-fetch mode: skipped (set BASE_URL to enable)

## Per-role summary

| Role | Accounts | Passed | Failed |
|---|---:|---:|---:|
| caregiver | 2 | 2 | 0 |
| facility_admin | 1 | 1 | 0 |
| nurse | 1 | 1 | 0 |
| org_admin | 1 | 0 | 1 |
| owner | 3 | 2 | 1 |

## Per-account detail

| Email | Expected role | Signed in | Role OK | Landing route | Route status | Reason |
|---|---|---|---|---|---|---|
| blewis@lewisinsurance.com | owner | ❌ | ❌ | /admin/command | — | signInWithPassword: Invalid login credentials |
| sarah.williams@circleoflifealf.com | nurse | ✅ | ✅ | /admin/command | — |  |
| james.thompson@circleoflifealf.com | caregiver | ✅ | ✅ | /caregiver | — |  |
| jessicamurphy@circleoflifecommunities.com | org_admin | ❌ | ❌ | /admin/command | — | signInWithPassword: Invalid login credentials |
| admin@circleoflifealf.com | owner | ✅ | ✅ | /admin/command | — |  |
| milton.smith@circleoflifealf.com | owner | ✅ | ✅ | /admin/command | — |  |
| maria.garcia@circleoflifealf.com | caregiver | ✅ | ✅ | /caregiver | — |  |
| jessica.murphy@circleoflifealf.com | facility_admin | ✅ | ✅ | /admin/command | — |  |

_Passwords are never logged or written. Sign-in attempts use `HOMEWOOD_LAUNCH_PASSWORD` from the environment._

