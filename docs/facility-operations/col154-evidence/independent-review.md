# COL-154 independent review (Haven GATE package)

**Status: APPROVED AFTER FIXES** (source-only SQL/runtime review; every fix re-verified)

An independent, read-only reviewer seat examined migration `347_hfo_drill_generator_sources.sql`, its probe, the adjusted 346 probe, the race script and the routes against the three acceptance criteria, running its own scenarios inside rolled-back transactions on the native clone. Its verdict before fixes was **APPROVE WITH FIXES**: one blocking finding, one high, three should-fix, seven notes.

| # | Finding | Disposition |
|---|---|---|
| F1 | Final fire drill corrected to `tornado` stranded its receipt | **Fixed**: type changes to/from tornado refused on a final log; probed |
| F2 | Void after the asset was retired left a false completion | **Fixed**: refused by name under the COL-133 retired-subject boundary; probed; OWNER-DECISIONS 3k(xii) |
| F3 | Voided drill blocks re-entry at the same slot (220 unique) | **Documented** (3k(x)); constraint change is an integrator decision because the legacy upsert depends on it |
| F4 | `deleted_at` not re-checked after `FOR UPDATE` | **Fixed** in every finalize/correct/void |
| F5 | Migration self-check global and silent on missing org | **Fixed**: scoped to the two source keys; NOTICE |
| F6 | Contract said `version_recorded_at` where code uses `finalized_at` | **Fixed** (document) |
| F7 | Cross-person correction is on-behalf and needs a reason | **Documented and probed** (3k(ix)) |
| F8 | Legacy upsert with identical content on a final row is silent; evidence paths frozen | **Documented** (3k(x)) |
| F9 | Request keys unique globally (as 346) | Accepted, single organisation |
| F10 | Same key, two different records from two sessions → generic 23505 | **Fixed**: request-key lock first in every command |
| F11 | Opposite-direction concurrent moves could deadlock (346) | Accepted, inherited, safe failure |
| F12 | `voided` list filter missing from the contract | **Fixed** (document) |

| Requirement | Result |
|---|---|
| Final approved drill/source log satisfies once; separate review stays outstanding | PASS |
| Two generators; correction/void/replay; failed observation leaves the issue open | PASS |
| No self-test or photo alone; no invented Homewood day/time or deadline | PASS |

Re-verification after the fixes: both native probes PASS, race script **6/6 PASS**, vitest 43 files / 533 tests PASS, typecheck and lint PASS, strict segment gate re-run (see `verification.json`).

Machine-readable: `col154-evidence/independent-review.json`.
