# Facility Operations — decisions pending the owner or integrator

Updated 2026-09-10. These are the questions the overnight work could not and did not answer. Each names the owner, the evidence, and what happens until it is decided. Nothing below has been guessed in code.

## Owner decisions

1. **Named individuals in source header labels (COL-132).** `activity-catalog.json` items AL-Y02 ("Fire Safety Inspection - Chad Croft") and AL-C08 ("Michelle Norris sent copy of contract") reproduce workbook header text naming people; the seed writes them permanently into `operation_activity_source_items.source_payload`. Options: redact the `sourceText` to a neutral label with an entry note before deployment, or accept workbook header wording as evidence. Until decided: the branch keeps the workbook text and the spec says so; do not deploy migration 336 without the ruling. Evidence: `col132-evidence/review-closure.json`.
2. **Whole-run fail-closed automation on population mismatch (COL-133).** The risk scorer and staffing computer stop the entire service run when one organisation's classified projection disagrees with its raw population. The reviewer suggested per-organisation continuation. The current behaviour is the conservative choice (partial coverage is never labelled complete); a per-organisation `continue` with deterministic ordering is a cheap change if preferred. Evidence: `col133-evidence/integration-review.json`.
3. **Open configuration questions Q01, Q02, Q07, Q08, Q10, Q11 (all HFO issues).** No answer was assumed. `needs_confirmation` remains the published state for every unanswered item. Answers are required only before the dependent rule or activation, not before foundation build.

## Integrator decisions (before merge, apply or deploy)

4. **Listing completed audit export jobs.** COL-133 hides completed export jobs from the requester's list; Finance's UI expects to list snapshot-bearing completed jobs for download. Retrieval stays authority-checked in the database, so allowing the list to show completed jobs that carry a snapshot would lose no protection. Decide at integration; the reconcile migration does not change the list policy. Evidence: `col133-evidence/finance-integration/resolution.json`.
5. **Merge order and migration numbers.** Finance's export-job column type change must apply before COL-133's export-job policies (PostgreSQL refuses ALTER TYPE on a column referenced by a policy; reproduced). Rehearsed order: Finance 336–342, then COL-132 catalog, COL-133 authority, COL-135 applicability, then the audit-export reconcile. Re-read the Haven hosted ledger (project manfqmasfqppukpobpld; numbered through 335 on 2026-09-10) immediately before assigning numbers, and update the seed script's hard-coded catalog migration filename in the same commit.
6. **Production dry-run of the catalog backfill (COL-132).** The 336 backfill aborts on cyclic or cross-site template lineage and writes audit rows for every existing template and instance. Run the dry-run against a current production snapshot before apply.

## Not decisions, just boundaries

- No hosted migration, deployment, schedule activation, external transmission or access grant happened overnight. Draft PRs #465 (COL-132), #466 (COL-133) and #467 (COL-135) exist for review only.
- Local PostgreSQL replays use Supabase stubs and synthetic fixtures; hosted Auth, Storage, browser and staff acceptance remain separate gates.
