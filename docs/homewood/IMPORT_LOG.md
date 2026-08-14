# Homewood — Resident Import Log (example stub)

_This file is a **de-identified example** for documentation and dry-run review shape only. Real import logs are written to `test-results/homewood-import/` (gitignored) and must never be committed._

_Generated: `2026-08-14T00:00:00.000Z` — mode: **DRY-RUN** (example)_

- Source CSVs:
  - `scripts/homewood/data/homewood-residents.csv.example` (example roster; 3 rows loaded)
- Facility: `Homewood Lodge ALF` (00000000-0000-0000-0002-000000000003)
- Organization: `00000000-0000-0000-0000-000000000001`

## Tally

| Outcome | Count |
|---|---:|
| DRY-OK | 3 |

## Per-row detail

| Source | Row | Name | Status | Detail |
|---|---:|---|---|---|
| scripts/homewood/data/homewood-residents.csv.example | 2 | Jane Example | DRY-OK | would create resident in room 1; payer=private_pay; emergency=John Example |
| scripts/homewood/data/homewood-residents.csv.example | 3 | Robert Sample | DRY-OK | would create resident in room 2; payer=medicaid_oss; emergency=Mary Sample |
| scripts/homewood/data/homewood-residents.csv.example | 4 | Mary Placeholder | DRY-OK | would create resident in room 3; payer=ltc_insurance; emergency=Susan Placeholder |

_Real imports: copy `homewood-residents.csv.example` to `homewood-residents.csv` (gitignored), run `npm run homewood:import-residents:dry-run`, review the log under `test-results/homewood-import/`._
