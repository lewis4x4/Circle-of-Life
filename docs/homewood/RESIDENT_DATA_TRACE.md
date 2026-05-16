# Homewood — Resident Data Trace

_Generated: 2026-05-16. Diagnostic conducted against `manfqmasfqppukpobpld.supabase.co`._

## Question

Where is Homewood's resident data? The brief states "Homewood facility data is already loaded into Supabase via the onboarding flow," but Sprint 1's audit found zero rows in `residents` for Homewood. This trace inspects every plausible source location.

## Findings

### Resident-shaped tables — all empty at Homewood

| Table | Homewood count | Total rows |
|---|---:|---:|
| `residents` | 0 | (audit confirmed) |
| `admission_cases` | 0 | — |
| `resident_contacts` | 0 | — |
| `resident_documents` | 0 | — |
| `resident_payers` | 0 | — |
| `family_resident_links` | 0 (org-scoped, no Homewood links) | — |
| `referral_leads` | 0 | — |
| `referral_hl7_inbound` | 0 | — |
| `admissions_checklist_items` | (table does not exist in schema cache) | — |

Two tables have non-zero rows but are configuration, not resident records:
- `family_portal_resident_rights_entries` — 12 rows (template content)
- `resident_observation_templates` — 5 rows (template content)

### `onboarding_responses` is not a resident store

Schema (from migration `108_onboarding_responses.sql`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK | **Not facility-scoped** — org-scoped only |
| `question_id` | text FK → `onboarding_questions` | One response per question per org |
| `value` | text | **Single text field, not structured JSON** |
| `confidence` | text | `confirmed` / `best_known` / `needs_review` |
| `entered_by_name`, `entered_by_user_id`, `updated_at` | | |
| UNIQUE (`organization_id`, `question_id`) | | One answer per question per org |

**Row count: 0.** Zero responses across the entire organization. The 94 questions in `onboarding_questions` span organizational policy, workflow, and infrastructure topics — not resident roster.

### What this means

1. **No resident data exists anywhere** in the live Supabase project for Homewood (or any COL organization).
2. **`onboarding_responses` was never designed to hold resident records.** It's a single-text-value-per-question store for org-level policy answers. Even if populated, it could not be promoted to `residents` rows.
3. **The "data already loaded" claim in the launch brief refers to physical plant + staff seed only** — migrations populated facilities, units, rooms (20), beds (36), and 16 staff records, but never resident data.

## Recommended import path

**Option C is closed.** No promotion from `onboarding_responses` is possible.

**Option A (CSV import) is the only viable path.** Build `scripts/homewood/import-residents.mjs` that reads a user-supplied CSV at `scripts/homewood/data/homewood-residents.csv`. Required columns per the user's earlier message:

`first_name, last_name, date_of_birth, preferred_name, room_number, primary_diagnosis, admit_date, gender, payer_type, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship`

The user provides the CSV. The script does the load. Idempotent on `(facility_id, first_name, last_name, date_of_birth)`.

### Before the import can run

1. User supplies the CSV (PII-handled appropriately; the file should be gitignored).
2. The script must look up `room_id` from `rooms` by `room_number` at the Homewood facility — 20 rooms exist, so each CSV row's `room_number` must match.
3. The script must look up or create `beds` for each room if the resident is going into a specific bed (each room may have multiple beds; 36 beds total / 20 rooms ≈ 1.8 beds per room).
4. Care plans, medications, family links, and other resident-adjacent records are out of scope for the initial import — they get layered in subsequent imports or via the application UI.

## Halt — do not build the import script yet

Per the user's instruction: "Do NOT write any import script yet. Just diagnose and report." This trace is the report. The user decides next steps.

## Open questions for the user

1. Is the resident roster ready to provide as a CSV? Approximate count?
2. Should residents be admitted as `status='active'` directly, or should we use `status='pending_admission'` and let staff promote them through the admissions workflow?
3. For residents without an assigned bed yet, should the script populate `bed_id` as NULL or fail loudly?
4. Care plans are required for active residents per Sprint 1's audit — should the import include a stub care plan per resident, or leave that to a follow-up import?
5. Do family contact details from the CSV automatically become `family_resident_links` rows (requires auth.users provisioning per contact), or stay as the residents-table's `responsible_party_*` and `emergency_contact_*` columns?
