# legal_entities seed (pending AHCA data from client)

**Status:** schema-ready, data-pending, app-disconnected. Blocking nothing today.
**Owner:** Brian (data collection) → engineering (seed migration)
**Surfaced:** 2026-05-25 during phase1 migration deploy.

## What this is for

Circle of Life operates **5 facilities under 5 separate LLCs**, each with its own EIN and AHCA Assisted Living Facility license (Section 12 of the COL Technical Handoff — "Multi-Entity Awareness").

The `facilities` table tracks the buildings/operations. The `legal_entities` table tracks the **corporate compliance posture** of each LLC that owns/operates a facility:

| Column | Purpose |
|---|---|
| `entity_id` | FK to `entities` (the corporate-structure parent record — already populated). |
| `ahca_license_number` | The ALF license issued by Florida AHCA. **Pending — Brian obtaining from client.** |
| `ahca_license_expiration` | License renewal deadline. ALF licenses expire and must be renewed. |
| `last_survey_date` + `last_survey_result` | Most recent AHCA survey outcome — `PASSED_NO_CITATIONS`, `CITATIONS_ISSUED`, or `FOLLOW_UP_REQUIRED`. |
| `open_pocs` | Open **Plans of Correction** count. Auto-updated by trigger from `survey_deficiencies` once that table is wired in. POCs are the formal responses submitted to AHCA after a citation. |

## Why it matters

Once seeded, this table powers:

1. Compliance dashboards — "how many of our 5 LLCs have a license renewal within 90 days?"
2. Executive NLQ scenarios — "what's our AHCA risk exposure across all entities?"
3. The `background_screenings` table (also created in migration 283), which references staff per-entity for §435.04 compliance.
4. The multi-entity isolation requirement — a citation against the Homewood LLC must not appear under Plantation's compliance status, and vice versa.

## Why it's currently empty

Migration 283 only created the schema. The actual data was deferred because:
- AHCA license numbers and expirations weren't on hand.
- Survey history (`last_survey_date`, `last_survey_result`, `open_pocs`) wasn't well-defined yet.

No production code reads from `legal_entities` yet, so empty isn't breaking anything.

## What's needed before we seed

Per LLC (5 rows total):

- [ ] LLC legal name (already in `entities` table — see mapping below)
- [ ] AHCA ALF license number
- [ ] AHCA license expiration date
- [ ] Last AHCA survey date (if available)
- [ ] Last survey result — `PASSED_NO_CITATIONS` / `CITATIONS_ISSUED` / `FOLLOW_UP_REQUIRED`
- [ ] EIN (optional today; not in the table schema but worth recording for the followup)

## Mapping context (as of deploy)

**Production entities (5 real COL LLCs + 1 demo):**

| Entity ID | Name |
|---|---|
| `00000000-0000-0000-0001-000000000001` | Pine House, Inc. |
| `00000000-0000-0000-0001-000000000002` | Smith & Sorensen LLC |
| `00000000-0000-0000-0001-000000000003` | Sorensen, Smith & Bay, LLC |
| `00000000-0000-0000-0001-000000000004` | The Plantation on Summers, LLC |
| `00000000-0000-0000-0001-000000000005` | Grande Cypress ALF LLC |
| `11111111-1111-1111-1111-111111111112` | Haven Demo Operations LLC *(skip — demo)* |

**Production facilities:**

| Facility ID | Facility |
|---|---|
| `00000000-0000-0000-0002-000000000001` | Oakridge ALF |
| `00000000-0000-0000-0002-000000000002` | Rising Oaks ALF |
| `00000000-0000-0000-0002-000000000003` | Homewood Lodge ALF |
| `00000000-0000-0000-0002-000000000004` | Plantation ALF |
| `00000000-0000-0000-0002-000000000005` | Grande Cypress ALF |

**Inferred LLC↔facility mapping** (Brian to confirm):

| Facility | Likely LLC |
|---|---|
| Plantation ALF | The Plantation on Summers, LLC ✓ (name match) |
| Grande Cypress ALF | Grande Cypress ALF LLC ✓ (name match) |
| Oakridge ALF | one of {Pine House, Smith & Sorensen, Sorensen Smith & Bay} ❓ |
| Rising Oaks ALF | one of {Pine House, Smith & Sorensen, Sorensen Smith & Bay} ❓ |
| Homewood Lodge ALF | one of {Pine House, Smith & Sorensen, Sorensen Smith & Bay} ❓ |

## When ready — suggested migration

Filename: `supabase/migrations/<next-version>_legal_entities_seed.sql`

Template (replace `<…>` placeholders):

```sql
-- Seed legal_entities for COL's 5 LLCs.
-- Per Section 12 of the COL Technical Handoff.

INSERT INTO legal_entities (
  entity_id,
  organization_id,
  ahca_license_number,
  ahca_license_expiration,
  last_survey_date,
  last_survey_result,
  created_by
) VALUES
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', '<plantation-license>', '<plantation-exp>', '<survey-date or NULL>', 'PASSED_NO_CITATIONS', NULL),
  ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', '<grande-cypress-license>', '<grande-exp>', '<survey-date or NULL>', 'PASSED_NO_CITATIONS', NULL),
  -- Oakridge, Rising Oaks, Homewood Lodge entries — pending LLC mapping confirmation
  ('<oakridge-llc-id>',     '00000000-0000-0000-0000-000000000001', '<license>', '<exp>', NULL, 'PASSED_NO_CITATIONS', NULL),
  ('<rising-oaks-llc-id>',  '00000000-0000-0000-0000-000000000001', '<license>', '<exp>', NULL, 'PASSED_NO_CITATIONS', NULL),
  ('<homewood-llc-id>',     '00000000-0000-0000-0000-000000000001', '<license>', '<exp>', NULL, 'PASSED_NO_CITATIONS', NULL)
ON CONFLICT DO NOTHING;
```

**Convention reminder:** `created_by = NULL` for system seeds (or use a real `auth.users` id for deployer attribution). **Never** use the COL organization sentinel UUID `00000000-0000-0000-0000-000000000001` — that's an `organization_id`, not a `user_id`, and will fail `legal_entities_created_by_fkey`. The CI guard at `scripts/agent-gates/check-seed-uuid-sentinel.mjs` enforces this.

## Verifying after seed

```sql
-- Should return 5 rows
SELECT
  e.name AS llc,
  le.ahca_license_number,
  le.ahca_license_expiration,
  le.last_survey_result,
  le.open_pocs
FROM legal_entities le
JOIN entities e ON e.id = le.entity_id
WHERE le.organization_id = '00000000-0000-0000-0000-000000000001'
ORDER BY e.name;
```

## Related

- Migration: `supabase/migrations/283_phase1_compliance_skeleton.sql` (creates the table)
- Spec: `docs/specs/08-compliance-engine.md`
- Spec: `docs/specs/00-foundation-regulatory.md`
- Audit: `docs/issues/backend-terminology-leak-audit.md` (parallel work — surveys parlance)
