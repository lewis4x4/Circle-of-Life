# Homewood Ingestion Manifest — Round 1

Date: 2026-05-13
Facility: Homewood Lodge ALF
Purpose: Replace seed/demo onboarding assumptions with manifest-driven real data ingestion.

## Rules

- Import everything available in Round 1.
- If a source is missing, ambiguous, or not Homewood-specific, mark it as a gap and continue.
- Do not commit PHI or row-level resident/staff data to git.
- Every import artifact must retain source filename/folder, parser version, validation status, and gap notes.
- Infrastructure is not a blocker: Supabase Pro, S3, PITR/backups, and Drive/source permissions are handled.
- QuickMar is not being replaced: daily folder export -> n8n workflow -> Haven ingestion.
- M17 GL/property source-of-truth is resolved: `HOMEWOOD GL CERT.pdf` and `HOMEWOOD PROPERTY Policy.pdf` are authoritative; duplicate `* 2.pdf` uploads are ignored.

## Round 1 Sources

| Source ID | Module(s) | Source | Type | Target entities | Status | Gap behavior |
|---|---|---|---|---|---|---|
| src-facility-master | M1, M2 | Management / Facilities Information | document/table | organization, legal entities, facility profile | ready_to_parse | If admin/manager conflicts with prior notes, mark `needs_review`. |
| src-room-model | M3 | Homewood readiness packet / facility master | structured known model | rooms, beds, capacity | ready_to_parse | If source conflicts, preserve both and flag review. |
| src-employees | M4 | Haven - Brian / Employees Information.xlsx | xlsx | staff, users, facility access, PHI permissions | ready_to_parse | Empty facility rows become Round 2 gaps. |
| src-face-sheets | M5, M7, M10, M11, M15 | Haven - Brian / HW Face Sheets folder | folder/docx/PDF | residents, contacts, physician, pharmacy, insurance, allergies/diet | ready_to_parse_sensitive | Missing service-plan/ADL details become M7 gap rows. |
| src-ar | M6 | Accounts Receivables folder + Homewood A/Rs | xlsx | payer/rate records, balances, billing contacts | ready_to_parse_sensitive | Missing rate/effective-date fields become resident-specific gaps. |
| src-medicaid-log | M6 | Daily Logs / Medicaid Log.xlsx | xlsx | Medicaid tracking, payer/provider status | ready_to_parse_sensitive | Unmatched resident names become review rows. |
| src-quickmar-daily | M10 | Daily QuickMar export folder | file drop via n8n | medication profiles, med-pass import, exception records | ready_for_workflow_design | Unknown export format/header versions are quarantined. |
| src-admissions-checklists | M14 | `operations/compliance-checklists/admin-log.md` + `lmh-admin-mgr-log.md` | markdown reference | move-in checklist definitions | parsed_reference | Active prospect rows still require referral/inquiry source. |
| src-referrals-tour | M14 | Daily Logs / Referral Log.xlsx + Tour Inquiry/Checklist/Survey | xlsx/forms | admissions pipeline, referral sources, tour intake | ready_to_parse | If org-wide and not Homewood-filterable, mark `needs_review`. |
| src-incidents-grievances | M16 | Incident forms/logs + Grievance Reports Log.xlsx | forms/xlsx | incident workflows, grievance taxonomy, risk escalation | ready_to_parse | Claims-routing owner gaps go to Round 2. |
| src-insurance-docs | M17 | `HOMEWOOD GL CERT.pdf`, `HOMEWOOD PROPERTY Policy.pdf`, bond/loss-run docs | PDF/docs | compliance documents, source-of-truth groups | source_resolved | Date extraction can be later; source decision is not blocked. |
| src-inspections-vendors | M13, M18 | 2026 Inspections.xlsx + Maintenance Contact List | xlsx/PDF | inspection schedules, vendor contacts, maintenance dependencies | ready_to_parse_needs_scope_review | If Plantation-heavy, mark Homewood-specific vendor confirmation as gap. |
| src-dietary | M11 | Kitchen Temp Log.xlsx + food service logs + face-sheet diet/allergy fields | xlsx/docs | dietary logs, diet/allergy profiles | ready_to_parse | Missing resident-specific texture/assistance fields become gaps. |
| src-activities | M12 | activity calendar/source artifacts if present | calendar/docs | activity plans, attendance rules | gap_pending_source | If no Homewood activity source found, Round 2. |
| src-schedules | M9 | staff schedule / shift templates / assignment sheets | schedule/xlsx | shift templates, assignments, call-off rules | gap_pending_source | Do not block other modules. |
| src-kpis-standup | M19 | Standup Call Log + launch KPI definitions | xlsx/docs | scoreboard/KPI definitions | ready_to_parse | Missing Homewood-specific KPI owner becomes Round 2. |

## Import Order

1. M1/M2 facility/entity master.
2. M3 rooms/beds.
3. M4 staff/users/PHI permissions.
4. M5 residents.
5. M15 responsible-party/family/emergency contacts.
6. M6 payer/rate/A/R/Medicaid data.
7. M14 admissions/referrals.
8. M7 care/service-plan/ADL data if extractable.
9. M9 schedules if source found.
10. M10 QuickMar/n8n daily export path.
11. M11 dietary.
12. M16 incidents/grievances.
13. M13/M18 maintenance/vendors/inspections.
14. M17 documents/compliance metadata.
15. M19 KPIs/standup.

## Round 2 Gap Queue Seeds

- Homewood staff schedule / shift templates / call-off process if not located.
- Homewood-specific care level / ADL / service-plan details if face sheets/1823/CSP are insufficient.
- Homewood-specific vendor list if inspection artifacts are not Homewood-applicable.
- Facility leadership reconciliation if Facilities Information conflicts with prior Michelle Norris usage.
- Active admissions pipeline if Referral Log cannot be filtered to Homewood.
- Final rounds owner/resolution if contradiction remains open.
