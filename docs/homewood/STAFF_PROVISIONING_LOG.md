# Homewood — Staff Auth Provisioning Log

_Generated: `2026-05-16T22:01:48.850Z` — mode: **DRY-RUN**_

- Facility: `Homewood Lodge ALF` (00000000-0000-0000-0002-000000000003)
- Organization: `00000000-0000-0000-0000-000000000001`
- Source: `staff` rows where `user_id IS NULL` AND `deleted_at IS NULL`

## Tally

| Outcome | Count |
|---|---:|
| DRY-WOULD-PROVISION | 16 |

## staff_role → app_role mapping in effect

| staff_role | app_role |
|---|---|
| administrator | facility_admin |
| assistant_administrator | facility_admin |
| resident_aide | caregiver |
| cna | caregiver |
| lpn | nurse |
| rn | nurse |
| med_tech | med_tech |
| dietary_staff | dietary |
| dietary_manager | dietary |
| activities_director | coordinator |
| maintenance | maintenance_role |
| housekeeping | housekeeper |
| driver | maintenance_role |

## Per-staff detail

| Name | Email (redacted) | staff_role | app_role | Action | Detail |
|---|---|---|---|---|---|
| Kimora Hall | ki********@icloud.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Holly Berry | hj*********@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Kayla Smith | ka************@icloud.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Cecilia Ramirez | ra***********@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Kristin Hurley | kr***************@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Jennifer Martinez | je******************@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Charlene Elmore | ce*****************@gmail.com | administrator | facility_admin | DRY-WOULD-PROVISION | app_role=facility_admin; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Kyneisha Coverson | ky********@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Rebecca Ross | re***********@aim.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Kymeisha Coverson | li*********@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Na-shia Freeman | na**************@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Kaci Vicencio | ka*************@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Malida Gaskins | aa**************@gmail.com | assistant_administrator | facility_admin | DRY-WOULD-PROVISION | app_role=facility_admin; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Abbigail Hall | Ab******@icloud.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Kayla Winberley | ka******@icloud.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |
| Rita Salas | ri**********@gmail.com | resident_aide | caregiver | DRY-WOULD-PROVISION | app_role=caregiver; password from HOMEWOOD_LAUNCH_PASSWORD; grant facility access |

## Notes

- Emails in the Per-staff detail table are redacted (first 2 chars + domain). The full address is in `staff.email` and `auth.users.email` — never in git.
- Passwords are never written to this log. Sign-ins use `HOMEWOOD_LAUNCH_PASSWORD` from the environment.
- Re-running this script is safe — staff with `user_id` already set are skipped (the lookup filter excludes them).
- Each new user is granted `user_facility_access` for the Homewood facility. Without this grant, sign-in works but the user sees an empty workspace.

