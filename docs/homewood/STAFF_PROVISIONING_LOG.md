# Homewood — Staff Auth Provisioning Log

_Generated: `2026-05-16T22:14:07.538Z` — mode: **DRY-RUN**_

- Facility: `Homewood Lodge ALF` (00000000-0000-0000-0002-000000000003)
- Organization: `00000000-0000-0000-0000-000000000001`
- Source: `staff` rows where `user_id IS NULL` AND `deleted_at IS NULL`
- Flow: Supabase `inviteUserByEmail` — each employee clicks the link in their inbox and sets their own password on first sign-in. No shared launch password.

## Tally

| Outcome | Count |
|---|---:|
| DRY-WOULD-INVITE | 16 |

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
| Kimora Hall | ki********@icloud.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to ki********@icloud.com |
| Holly Berry | hj*********@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to hj*********@gmail.com |
| Kayla Smith | ka************@icloud.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to ka************@icloud.com |
| Cecilia Ramirez | ra***********@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to ra***********@gmail.com |
| Kristin Hurley | kr***************@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to kr***************@gmail.com |
| Jennifer Martinez | je******************@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to je******************@gmail.com |
| Charlene Elmore | ce*****************@gmail.com | administrator | facility_admin | DRY-WOULD-INVITE | app_role=facility_admin; would email invite to ce*****************@gmail.com |
| Kyneisha Coverson | ky********@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to ky********@gmail.com |
| Rebecca Ross | re***********@aim.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to re***********@aim.com |
| Kymeisha Coverson | li*********@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to li*********@gmail.com |
| Na-shia Freeman | na**************@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to na**************@gmail.com |
| Kaci Vicencio | ka*************@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to ka*************@gmail.com |
| Malida Gaskins | aa**************@gmail.com | assistant_administrator | facility_admin | DRY-WOULD-INVITE | app_role=facility_admin; would email invite to aa**************@gmail.com |
| Abbigail Hall | Ab******@icloud.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to Ab******@icloud.com |
| Kayla Winberley | ka******@icloud.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to ka******@icloud.com |
| Rita Salas | ri**********@gmail.com | resident_aide | caregiver | DRY-WOULD-INVITE | app_role=caregiver; would email invite to ri**********@gmail.com |

## Notes

- Emails in the Per-staff detail table are redacted (first 2 chars + domain). Full addresses live in `staff.email` and `auth.users.email`, never in git.
- Passwords are never stored or transmitted by this script. Each employee sets their own password when they click the invite link.
- Re-running the script is safe — staff rows with `user_id` already set are skipped. Re-invited emails are linked to their existing `auth.users` row instead of creating duplicates.
- Each user is granted `user_facility_access` for the Homewood facility. Without this grant, sign-in works but the user sees an empty workspace.

