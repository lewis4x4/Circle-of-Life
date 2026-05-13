# Homewood Round 1 Hydrated State Summary

Generated: 2026-05-13T20:09:54.816Z

- Output: `facility-launch-center/data/homewood-round1-state.json`
- Normalized artifacts consumed: 16/16
- Review queue records: 10
- Gap records: 11
- Documents imported: 4
- Rooms imported: 20
- Facility readiness after Round 1 import: 22

## Remaining gaps

| Module | Source ID | Field/source | Reason |
| --- | --- | --- | --- |
| M6 | src-ar | current Homewood A/R | Local parse used non-2026 A/R source; current Homewood 2026 A/R is not present locally yet. |
| M6 | src-medicaid-log | Medicaid Log.xlsx | Medicaid Log workbook is not present locally yet. Set HOMEWOOD_MEDICAID_LOG_PATH when available. |
| M14 | src-referrals-tour | Referral Log.xlsx | Active referral log is not present locally yet. Set HOMEWOOD_REFERRAL_LOG_PATH when available. |
| M14 | src-referrals-tour | tour form field extraction | Tour form PDFs are present but not text-extractable with local pdftotext; OCR/manual transcription required before field-level import. |
| M10 | src-quickmar-daily | daily QuickMar export folder/header sample | Daily QuickMar export folder/header sample is not present locally yet. n8n workflow can be finalized once one export sample exists. |
| M16 | src-incidents-grievances | structured incident/grievance log workbook | Structured incident/grievance workbook is not present locally; only PDF forms/log templates were found. |
| M13 | src-inspections-vendors | 2026 Inspections.xlsx | 2026 inspections workbook is not present locally at the expected Haven - Brian path. |
| M12 | src-activities | Homewood activity calendar/source artifacts | Homewood activity calendar/source artifacts are not present locally yet. |
| M4 | src-employees | Employees Information.xlsx | Employee workbook is not present locally yet. Set HOMEWOOD_EMPLOYEES_PATH when the CFO spreadsheet is available. |
| M5 | src-face-sheets | HW Face Sheets folder | Face sheets folder is not present locally yet. Set HOMEWOOD_FACE_SHEETS_PATH when the Drive folder is available. |
| M9 | src-schedules | Homewood staff schedule / shift templates | Homewood staff schedule / shift template source is not present locally yet. |

## Import rule

This state is generated from normalized Round 1 artifacts and the empty onboarding shell. Demo fixture state is not used.
