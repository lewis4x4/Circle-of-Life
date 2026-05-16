# Homewood Resident Import — CSV Schema

The resident-import script (`scripts/homewood/import-residents.mjs`) reads `scripts/homewood/data/homewood-residents.csv` and creates one resident plus related rows per CSV row.

The real CSV is **gitignored**. Only the `.example` file is committed. Real resident data must never be committed.

## Columns

All columns are required in the header (the file must have all 12 column names). Some values may be left empty per row — see the table.

| Column | Type | Required per row | Notes |
|---|---|---|---|
| `first_name` | text | yes | |
| `last_name` | text | yes | |
| `preferred_name` | text | no — may be empty | Stored in `residents.preferred_name` |
| `date_of_birth` | YYYY-MM-DD | yes | Used as part of the idempotency key |
| `gender` | enum | yes | One of `male`, `female`, `other`, `prefer_not_to_say` |
| `room_number` | text | yes | Must match an existing `rooms.room_number` at Homewood |
| `admit_date` | YYYY-MM-DD | yes | Sets `residents.admission_date` and `resident_status_history.effective_from` |
| `primary_diagnosis` | text | no — may be empty | Free-text clinical diagnosis |
| `payer_type` | enum | yes | One of `private_pay`, `medicaid_oss`, `ltc_insurance`, `va_aid_attendance`, `other` |
| `emergency_contact_name` | text | yes | |
| `emergency_contact_phone` | text | yes | |
| `emergency_contact_relationship` | text | no — may be empty | Free-text (e.g. `son`, `daughter`, `niece`, `power of attorney`) |

## Rows created per CSV row

| Table | Always created | Idempotency |
|---|---|---|
| `residents` | yes | `(facility_id, first_name, last_name, date_of_birth)` — exact match → update; otherwise insert |
| `resident_payers` | yes (`is_primary=true`) | skipped if a primary payer already exists for the resident |
| `resident_contacts` | yes (if `emergency_contact_name` is set; `contact_type='emergency'`) | one emergency contact per resident; subsequent runs update in place |
| `resident_status_history` | yes (initial `active` row) | skipped if an open `active` row already exists |

## Lookups

- `facility_id` is fixed to `00000000-0000-0000-0002-000000000003` (override with `HOMEWOOD_FACILITY_ID` env var).
- `organization_id` is fetched from `facilities` for the Homewood row.
- `room_id` is looked up by `rooms.room_number` filtered to Homewood. If a CSV row references a `room_number` that doesn't exist at Homewood, the row is reported as `FAILED` and no rows are written.

## What is *not* imported

The script intentionally does not touch:

- `bed_id` (the row's specific bed within a room) — leave to staff to assign in the UI
- `care_plans`, `care_plan_items`, `care_plan_tasks` — separate post-import workflow
- `resident_medications` — separate post-import workflow
- `family_resident_links` — requires provisioning a family auth user per link
- `resident_documents` — file uploads, out of scope for CSV import
- `admission_cases` — workflow-state tracking, populated as the resident moves through real admission flows
- `assessments` — clinical assessments captured by staff

These are intentional gaps. The CSV gives Homewood a working roster; the rest is layered on by staff in the application UI or by follow-up imports.

## Running the import

```bash
# 1. Copy and fill in the real roster (file is gitignored)
cp scripts/homewood/data/homewood-residents.csv.example scripts/homewood/data/homewood-residents.csv
$EDITOR scripts/homewood/data/homewood-residents.csv

# 2. Dry-run to validate (no DB writes)
npm run homewood:import-residents:dry-run

# 3. Real import
npm run homewood:import-residents
```

Both commands write `docs/homewood/IMPORT_LOG.md` summarizing per-row outcome. The log includes resident names — the user reviews it locally; only `.example`-derived logs should be committed.

## Re-runs

Re-running the script is safe. Existing residents (matched by the idempotency key) are updated in place; new rows are inserted; orphans are not deleted. If a roster correction is needed, edit the CSV and re-run; rows that match an existing resident will UPDATE, not duplicate.
