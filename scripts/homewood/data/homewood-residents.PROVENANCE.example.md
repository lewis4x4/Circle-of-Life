# homewood-residents.csv — Data Provenance (example stub)

This file documents the **shape** of a local provenance note for Homewood resident CSV imports. It contains **no real resident identifiers**.

Real provenance dumps (field-level source tracing, discrepancy notes, phone normalization flags) must stay **local and gitignored**. Copy this stub when needed:

```bash
cp scripts/homewood/data/homewood-residents.PROVENANCE.example.md \
   scripts/homewood/data/homewood-residents.PROVENANCE.md
```

The gitignored `homewood-residents.PROVENANCE.md` path is listed in `.gitignore`.

## What a real provenance note covers (categories only)

| Category | Description |
|---|---|
| Source documents | A/R workbook, face sheets, owner corrections |
| Field mapping | Which source column maps to each CSV column |
| Derived fields | Rules applied (e.g. payer_type from MCD provider column) |
| Discrepancies | AR vs face-sheet spelling differences |
| Data quality flags | Blank cells, mashed phone/email cells, implausible DOB |
| Excluded fields | SSN, Medicaid ID, allergies — not in import schema |

## Example-only row (not a real person)

| Field | Example value |
|---|---|
| first_name / last_name | Jane / Example |
| date_of_birth | 1942-03-15 |
| room_number | 1 |
| payer_type | private_pay |
