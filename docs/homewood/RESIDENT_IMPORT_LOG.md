# Homewood — Live Resident Import Log (example stub)

_This file is a **de-identified example** for documentation and dry-run review shape only. Real import logs are written to `test-results/homewood-import/` (gitignored) and must never be committed._

_Generated: `2026-08-14T00:00:00.000Z` — mode: **DRY-RUN** (example)_

- Source CSVs:
  - `scripts/homewood/data/homewood-residents.csv.example` (example roster; 3 rows loaded)
- Facility: `Homewood Lodge ALF` (00000000-0000-0000-0002-000000000003)
- Organization: `00000000-0000-0000-0000-000000000001`
- Purge deterministic demo residents: `no`

## Tally

| Outcome | Count |
|---|---:|
| would_create | 3 |
| demo residents soft-deleted/planned | 0 |

## Per-row detail

| Source | Row | Resident | Room/Bed | Status | Detail |
|---|---:|---|---|---|---|
| scripts/homewood/data/homewood-residents.csv.example | 2 | Jane Example | 1A | would_create | bed=1A; payer=private_pay; contact=John Example |
| scripts/homewood/data/homewood-residents.csv.example | 3 | Robert Sample | 2A | would_create | bed=2A; payer=medicaid_oss; contact=Mary Sample |
| scripts/homewood/data/homewood-residents.csv.example | 4 | Mary Placeholder | 3A | would_create | bed=3A; payer=ltc_insurance; contact=Susan Placeholder |

_Real imports: use `npm run import:homewood-residents:dry` and review the log under `test-results/homewood-import/`._
