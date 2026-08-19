# Homewood — Staff Auth Provisioning Log

_Generated: `2026-08-19T19:55:12.939Z` — mode: **INVITE**_

- Facility: `Homewood Lodge ALF` (00000000-0000-0000-0002-000000000003)
- Organization: `00000000-0000-0000-0000-000000000001`
- Source: `staff` rows where `user_id IS NULL` AND `deleted_at IS NULL`
- Flow: Supabase `inviteUserByEmail` — each employee clicks the link in their inbox and sets their own password on first sign-in. No shared launch password.

## Tally

| Outcome | Count |
|---|---:|
| INVITED | 16 |
| SKIP-NO-EMAIL | 4 |

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
| Jackie Ramirez |  | administrator | facility_admin | SKIP-NO-EMAIL | staff.email is empty; populate before a later invite pass |
| Charlene Elmore |  | assistant_administrator | facility_admin | SKIP-NO-EMAIL | staff.email is empty; populate before a later invite pass |
| Jackie Ramirez |  | administrator | facility_admin | SKIP-NO-EMAIL | staff.email is empty; populate before a later invite pass |
| Charlene Elmore |  | assistant_administrator | facility_admin | SKIP-NO-EMAIL | staff.email is empty; populate before a later invite pass |
| Kimora Hall | ki********@icloud.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=d6c23a33-2604-4c1a-b2c9-f119d14120bd; facility access granted |
| Holly Berry | hj*********@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=4d36c0ec-3093-4f35-8c1a-96ef558decc5; facility access granted |
| Kayla Smith | ka************@icloud.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=a3f666ba-1800-4405-8991-6cfbb12bb3c8; facility access granted |
| Cecilia Ramirez | ra***********@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=6c31f9c3-f407-45d3-8ac3-b3c3bf112100; facility access granted |
| Kristin Hurley | kr***************@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=fa7832b4-4178-429d-b9ff-b978d30d1a16; facility access granted |
| Jennifer Martinez | je******************@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=0493e12a-8eea-4678-a642-0bcbeefb5ec9; facility access granted |
| Charlene Elmore | ce*****************@gmail.com | administrator | facility_admin | INVITED | app_role=facility_admin; user_id=47060e71-0a0d-4436-84f0-b8a153204e11; facility access granted |
| Kyneisha Coverson | ky********@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=f9b1a15b-b3e4-447f-8a8b-c28cdc70ffa8; facility access granted |
| Rebecca Ross | re***********@aim.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=b7d0401e-4b0e-4544-bd28-73b9c5cb2fb6; facility access granted |
| Kymeisha Coverson | li*********@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=710d9d2b-b67f-4cb4-b530-e59b08233ed1; facility access granted |
| Na-shia Freeman | na**************@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=f35b2ebd-e0d1-40db-b464-56750ad3abd8; facility access granted |
| Kaci Vicencio | ka*************@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=37b23de7-7284-4270-b90a-b48fe801a85e; facility access granted |
| Malida Gaskins | aa**************@gmail.com | assistant_administrator | facility_admin | INVITED | app_role=facility_admin; user_id=26d194ca-fae0-49b5-9a15-db1c385f3d77; facility access granted |
| Abbigail Hall | Ab******@icloud.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=d24f2421-531d-4962-9b57-7a53814e8c61; facility access granted |
| Kayla Winberley | ka******@icloud.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=49dfc301-85c1-42ca-9719-2ec71dc3d42e; facility access granted |
| Rita Salas | ri**********@gmail.com | resident_aide | caregiver | INVITED | app_role=caregiver; user_id=92e16159-5465-4da6-9ce7-d0f5231753ba; facility access granted |

## Notes

- Emails in the Per-staff detail table are redacted (first 2 chars + domain). Full addresses live in `staff.email` and `auth.users.email`, never in git.
- Passwords are never stored or transmitted by this script. Each employee sets their own password when they click the invite link.
- Re-running the script is safe — staff rows with `user_id` already set are skipped. Re-invited emails are linked to their existing `auth.users` row instead of creating duplicates.
- Each user is granted `user_facility_access` for the Homewood facility. Without this grant, sign-in works but the user sees an empty workspace.

