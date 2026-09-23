# CI gate — auth verification

_Generated: `2026-09-16T19:51:06.652Z` against `manfqmasfqppukpobpld.supabase.co`._

This gate verifies the **named CI accounts** in `HOMEWOOD_LAUNCH_ACCOUNTS` and nothing else.
It deliberately does not enumerate a facility's grants: Homewood Lodge's grantees are real
staff with their own passwords, and a gate that tried to sign them in could only pass by
holding their credentials or by putting test identities on the live launch facility (COL-443).

Roster integrity is the Data Health panel's job (COL-361), not this script's.

Re-run with `npm run homewood:verify-auth`. Set `BASE_URL` to additionally fetch each role's landing route.

> **Roles note (2026-09-22, COL-615):** this is a generated report from 2026-09-16. `nurse`, `caregiver` and `dietary` are retired login roles (folded into `med_tech` and `cook` by migration 468); the CI account map's legacy keys now expect the role each account holds today. See the Roles section in `AGENTS.md`.

## Top-line

- CI accounts verified: **7 / 7**
- Route-fetch mode: skipped (set BASE_URL to enable)

## Per-account detail

| Email | Expected role | Signed in | Role OK | Landing route | Route status | Reason |
|---|---|---|---|---|---|---|
| ci-owner@haven-ci.test | owner | ✅ | ✅ | /admin/command | — |  |
| ci-administrator@haven-ci.test | facility_admin | ✅ | ✅ | /admin/command | — |  |
| ci-nurse@haven-ci.test | nurse | ✅ | ✅ | /admin/command | — |  |
| care@oakridge.com | caregiver | ✅ | ✅ | /caregiver | — |  |
| medtech@oakridge.com | med_tech | ✅ | ✅ | /med-tech | — |  |
| family@oakridge.com | family | ✅ | ✅ | /family | — |  |
| food@oakridge.com | dietary | ✅ | ✅ | /dietary | — |  |

_Passwords are never logged or written. The shared CI password lives in 1Password under "Haven CI gates"._

