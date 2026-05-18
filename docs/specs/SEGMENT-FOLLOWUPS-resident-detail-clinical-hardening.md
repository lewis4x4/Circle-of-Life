# Follow-up segments — resident detail clinical hardening (post-merge)

Ordered backlog after **resident-detail-clinical-hardening** ships on `main`. Scope each item as its own gated segment.

1. **`care_team_members` join + Care team card**  
   Loader on `care_team_members` (`resident_id`, role, primary flag, visits). Care team card reads join first; fallback to `residents.primary_physician_*`. Replace specialist count hack with collapsible list of members where `role = specialist` (once modeled).

2. **Feeding tube directive + directive audit history**  
   Persist `feeding_tube_directive` enum (none / permitted / trial / refused — exact values TBD). Deprecate diet-string heuristic seeding; record `migrated_from_diet_heuristic` where applicable. Add `resident_directives_history` (who, when, document ref, witness) for survey-facing provenance.

3. **`care_plan_review_due_date` on residents (or plan)**  
   Discrete due date defaulted from effective + 365 at migration; UI reads stored due date. Supports regulator cadence changes, physician-ordered intervals, and early scheduling without rewriting effective dates.

4. **`dx_category_mappings` (ICD-10 / normalized name → category)**  
   Seed from current keyword logic in `clinical-text-format.ts`; per-facility overrides; audits. Frontend consumes DB mapping instead of client-only grouping.

5. **Migration 159 hygiene + `qa.migrations-apply-postgres` required**  
   Fix `159_col_licensure_survey_data.sql` (`ahca_license_number` mismatch or ordering). Raise `migrations:apply`/`migrations:verify:pg` to **required** once clean replay passes.

6. **Clinical sidebar wrap (P20)**  
   Narrow rail fixes for “Medication management” / “Care plan reviews” two-line wraps — layout primitive tweak in clinical shell.

7. **Richer empty activity timeline**  
   Short-term polish; long-term unify care notes / family / vitals / incidents into a stream with compact previews.
