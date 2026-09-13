# COL-245 — document inspection, 2026-09-13

Scope as filed: the COL-154 and COL-159 contracts, handoffs and issue descriptions that still described the work as unmerged and cited the provisional migration numbers.

Method: every migration filename in `docs/` was compared against the current `origin/main` tree (`837281a9`) by matching the stable name suffix and flagging a different number. That found stale references in about sixty files, far beyond this issue's scope; the split below is deliberate.

## Corrected

Each of these now carries a dated **Integration status corrected 2026-09-13 (COL-245)** block at the top. The original bodies are left intact as history, and every block repeats that merged is not applied, applied is not deployed, and deployed is not accepted.

| Document | What was stale | What it now states |
|---|---|---|
| `COL-154-HANDOFF.md` | "Nothing is merged to `main`"; migration `347_hfo_drill_generator_sources.sql` | merged in `main`; migration is `359_…`; slot 347 now holds `347_hfo_activity_catalog.sql`; PR477 closed as superseded; the excluded UI was delivered by COL-241 / COL-242 in `837281a9` |
| `COL-159-HANDOFF.md` | "Nothing is merged to `main`"; migrations `348_…` and `347_…` | merged in `main`; migration is `360_…`; the COL-154 migration it stacks on is `359_…`; slot 348 now holds `348_hfo_current_authority.sql`; PR479 closed as superseded; the excluded UI is COL-244 |
| `col154-evidence/engineering-contracts.md` | "provisional stack-local slot" `347_…`; COL-147 mechanism as `346_…`; "nothing is merged"; "no UI" | migration `359_…`; mechanism `358_hfo_source_links.sql`; source merged; UI closed by COL-241 / COL-242 |
| `col159-evidence/engineering-contracts.md` | provisional `348_…`; COL-154 adapters as `347_…`; "nothing is merged"; "or UI" | migration `360_…`; COL-154 migration `359_…`; source merged; UI being closed by COL-244 |

Linear descriptions corrected the same day:

- **COL-154** — "Implementation not started" replaced with the merged state, the integrated migration number, the closed PR477 and the COL-241 / COL-242 follow-on.
- **COL-159** — the same, with `360_…`, the closed PR479 and COL-244.

Both still state that hosted apply, deployment and staff acceptance are not established, and that production remains at migration 339.

## Inspected and deliberately left unchanged

| Documents | Reason |
|---|---|
| `col154-evidence/` and `col159-evidence/` `verification.json`, `independent-review.json`, `independent-review.md`, `linear-state.json`, `concurrency.txt` | Dated evidence of what was verified at the time. Editing them would falsify the record rather than correct it. The corrected contract in the same folder names the current state. |
| `col217-evidence/integration-manifest.json`, `col217-evidence/staging/*`, `col132-evidence/*`, `col133-evidence/*`, `col135/137/139/142/143/144/145/146/147/152/153-evidence/*` | Same reason: applied-source manifests, gate logs and review records are history. `col217-evidence/integration-manifest.json` is in fact the record *of* the renumbering. |
| `docs/facility-operations/evidence/*`, `docs/finance-integration/*.json`, `docs/remediation/2026-09-review/*` | Dated run and release records. |

## Stale references found outside this issue's scope

Reported rather than silently fixed. These are live documents, not evidence, and each cites one or more renumbered migration:

- **Specs (source of truth for what to build):** `27-facility-operations-catalog.md` (336→347), `-authority.md` (337→348), `-applicability.md` (338→349), `-evaluator.md` (339→350), `-occurrences.md` (340→351), `-receipts.md` (341→353), `-issues.md` (342→354), `-evidence.md` (343→355), `-corrections.md` (344→356), `-recovery.md` (345→357).
- **Handoffs for the earlier lanes:** COL-132, COL-133, COL-135, COL-137, COL-139, COL-142, COL-143, COL-144, COL-145, COL-146, COL-147, COL-152, COL-153 — each cites its own pre-renumber slot.
- **`STAGING-INTEGRATION-PACKAGE.md`** carries two different superseded numbering runs at once and is the most misleading of the set.
- Unrelated older drift also exists (`HAVEN-BUILD-VERIFICATION-REPORT.md`, `KB-NEXT-ROADMAP.md`, `MIGRATION-REPLAY-HARDENING.md`, the payroll review's `341_payroll_source_freshness.sql` versus the current `334_…`).

Recommendation: one bounded follow-up issue for the ten specs plus `STAGING-INTEGRATION-PACKAGE.md`, since a spec with a wrong migration number is the reference an implementer actually follows. The thirteen earlier handoffs are lower value and could be batched with it or left as history with a single pointer.

## Not established by this pass

No code changed. No test claim is made beyond the segment gates recorded in `col245-evidence/verification.json`. No hosted apply, deployment or acceptance, and no statement here asserts that any human reviewed or approved these corrections.
