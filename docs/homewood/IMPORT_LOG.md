# Homewood — Resident Import Log

_Generated: `2026-05-16T22:00:40.272Z` — mode: **DRY-RUN**_

- Source CSV: `scripts/homewood/data/homewood-residents.csv.example`
- Facility: `Homewood Lodge ALF` (00000000-0000-0000-0002-000000000003)
- Organization: `00000000-0000-0000-0000-000000000001`

## Tally

| Outcome | Count |
|---|---:|
| DRY-OK | 3 |

## Per-row detail

| Row | Name | Status | Detail |
|---:|---|---|---|
| 2 | Jane Doe | DRY-OK | would create resident in room 1; payer=private_pay; emergency=John Doe |
| 3 | Robert Sample | DRY-OK | would create resident in room 2; payer=medicaid_oss; emergency=Mary Sample |
| 4 | Mary Placeholder | DRY-OK | would create resident in room 3; payer=ltc_insurance; emergency=Susan Placeholder |

_Names appear in this log because the user runs the import locally and reviews the result. The log is committed only when no real PII has been imported — i.e. when the source CSV is `homewood-residents.csv.example`. Real-import logs stay local._

