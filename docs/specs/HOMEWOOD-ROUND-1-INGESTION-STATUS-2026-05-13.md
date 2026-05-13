# Homewood Round 1 Real Ingestion Status — 2026-05-13

Generated: 2026-05-13T19:59:10.442Z

This report is intentionally PHI-safe. It records source coverage, parser readiness, and missing-source gaps only.

## What is now in place

- Seed reset path now preserves an empty onboarding shell instead of repopulating demo Homewood data.
- Homewood ingestion manifest defines 16 source categories and their target modules/entities.
- Round 1 parsers generate normalized artifacts for every manifest source category, including explicit gap artifacts when a source is missing.
- Insurance source-of-truth is resolved to `HOMEWOOD GL CERT.pdf` and `HOMEWOOD PROPERTY Policy.pdf`; duplicate uploads are ignored.
- QuickMar remains external; Haven expects a daily QuickMar export sample/folder for the n8n import workflow.

## Current artifact totals

- Normalized source artifacts: 16/16
- Parsed records: 63
- Ready records: 51
- Needs-review records: 10
- Parser-discovered gaps: 11

## Normalized artifacts generated

| Source ID | Records | Ready | Needs review | Gaps | Parser |
| --- | --- | --- | --- | --- | --- |
| src-activities | 0 | 0 | 0 | 1 | parse-remaining-ops@1.0.0 |
| src-admissions-checklists | 3 | 2 | 1 | 0 | parse-admissions-checklists@1.0.0 |
| src-ar | 2 | 2 | 0 | 1 | parse-billing@1.0.0 |
| src-dietary | 6 | 6 | 0 | 0 | parse-remaining-ops@1.0.0 |
| src-employees | 0 | 0 | 0 | 1 | parse-employees@1.0.0 |
| src-face-sheets | 0 | 0 | 0 | 1 | parse-face-sheets@1.0.0 |
| src-facility-master | 10 | 9 | 1 | 0 | parse-foundation@1.0.0 |
| src-incidents-grievances | 6 | 6 | 0 | 1 | parse-incidents-grievances@1.0.0 |
| src-inspections-vendors | 5 | 1 | 4 | 1 | parse-inspections-vendors@1.0.0 |
| src-insurance-docs | 6 | 4 | 0 | 0 | parse-insurance-docs@1.0.0 |
| src-kpis-standup | 1 | 0 | 1 | 0 | parse-remaining-ops@1.0.0 |
| src-medicaid-log | 0 | 0 | 0 | 1 | parse-billing@1.0.0 |
| src-quickmar-daily | 1 | 1 | 0 | 1 | parse-remaining-ops@1.0.0 |
| src-referrals-tour | 3 | 0 | 3 | 2 | parse-referrals-tour@1.0.0 |
| src-room-model | 20 | 20 | 0 | 0 | parse-foundation@1.0.0 |
| src-schedules | 0 | 0 | 0 | 1 | parse-remaining-ops@1.0.0 |

## Remaining gaps for second pass

| Source ID | Module | Round | Field/source | Reason |
| --- | --- | --- | --- | --- |
| src-activities | M12 | round_2 | Homewood activity calendar/source artifacts | Homewood activity calendar/source artifacts are not present locally yet. |
| src-ar | M6 | round_1 | current Homewood A/R | Local parse used non-2026 A/R source; current Homewood 2026 A/R is not present locally yet. |
| src-employees | M4 | round_1 | Employees Information.xlsx | Employee workbook is not present locally yet. Set HOMEWOOD_EMPLOYEES_PATH when the CFO spreadsheet is available. |
| src-face-sheets | M5 | round_1 | HW Face Sheets folder | Face sheets folder is not present locally yet. Set HOMEWOOD_FACE_SHEETS_PATH when the Drive folder is available. |
| src-incidents-grievances | M16 | round_1 | structured incident/grievance log workbook | Structured incident/grievance workbook is not present locally; only PDF forms/log templates were found. |
| src-inspections-vendors | M13 | round_1 | 2026 Inspections.xlsx | 2026 inspections workbook is not present locally at the expected Haven - Brian path. |
| src-medicaid-log | M6 | round_1 | Medicaid Log.xlsx | Medicaid Log workbook is not present locally yet. Set HOMEWOOD_MEDICAID_LOG_PATH when available. |
| src-quickmar-daily | M10 | round_1 | daily QuickMar export folder/header sample | Daily QuickMar export folder/header sample is not present locally yet. n8n workflow can be finalized once one export sample exists. |
| src-referrals-tour | M14 | round_1 | Referral Log.xlsx | Active referral log is not present locally yet. Set HOMEWOOD_REFERRAL_LOG_PATH when available. |
| src-referrals-tour | M14 | round_1 | tour form field extraction | Tour form PDFs are present but not text-extractable with local pdftotext; OCR/manual transcription required before field-level import. |
| src-schedules | M9 | round_2 | Homewood staff schedule / shift templates | Homewood staff schedule / shift template source is not present locally yet. |

## Next best step

Use the generated normalized artifacts as the Round 1 input package, import everything with `validationStatus: ready`, queue `needs_review` records for human review, and collect the listed gaps for Round 2. Do not wait on Round 2 sources before loading ready Round 1 data.
