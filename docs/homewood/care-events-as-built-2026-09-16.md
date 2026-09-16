# Care events as built, 2026-09-16

What spec 07A actually delivers on `main` and on the hosted projects, measured rather than assumed, and the gap list that keeps Homewood Lodge on paper.

COL-354 is not a new incident module. Spec `docs/specs/07A-something-happened-capture.md` is the incident design. This document is the audit that decides what still has to be built before the paper incident form, the paper Incident Reports Log, the paper witness statement and the fax to the physician can stop.

Method: every database row below was produced by replaying all 414 migrations onto a run-owned scratch PostgreSQL 17 cluster and running the probes kept beside this run's evidence (`discovery-section9-probe.sql`, `discovery-escalation-tick.sql`). Hosted rows are read-only queries against the two projects. No production row was written.

---

## 1. Spec 07A section 9 acceptance, on main

| # | Acceptance item | Verdict | Evidence |
|---|---|---|---|
| 1 | `typecheck`, `lint`, `test`, `build` exit 0; `test` includes level-cases parity | PASS | Unit 7 gate outputs; parity runs inside `npm run test` and again inside the replay |
| 2 | Migrations 400 to 403 replay clean; `migrations:check` passes | PASS | `[migrations:verify:pg] PASS (414 migration files, 74 SQL probes, level parity; native PostgreSQL with Supabase stubs)`; `[care-events:parity] PASS (105 cases, psql)` |
| 3 | Playwright walks three taps for each of the eight tiles | PASS (suite present, run in Unit 7) | `tests/care-events/three-taps.spec.ts`, `playwright.homewood.config.ts` project `care-events` |
| 4 | Level 3 Fall as caregiver produces the whole fan-out | PASS | `level=3 incident=GRA-2026-0001`; `incidents=1 followups=22 watch=1 exec_alerts=1 deliveries=16`; `fall_witnessed=f injury_severity=minor` |
| 5 | Level 4 Wandering "Not found yet" writes both AHCA clocks | PASS | `level=4 obligations=2 ahca_flag=t` |
| 6 | `acknowledge_care_event` stamps the administrator and stops the clock; `care_event_escalation_tick` adds the next step | PASS | `status=acknowledged administrator_notified=t`; clock advanced 11 minutes, steps `0,1` became `0,1,2` |
| 7 | Same `client_event_id` twice returns the same event and no second incident | PASS | `same_id=t rows=1 replayed_flag=true` |
| 8 | RLS: family excluded, cross facility blocked, caregiver cannot change the level | PASS | `family_visible_rows=0`; `facility_b_caregiver_sees=0`; level update `rejected` |
| 9 | No surface renders `level_1` to `level_4` raw | PASS | No raw enum token reaches JSX text; `formatLevelWord` covers the care-event read paths |
| 10 | `v_incident_reports_log` returns the paper log's columns | PASS | All eleven columns present; five rows for the seeded facility |

Ten of ten pass. The capture layer spec 07A describes is real and it works.

Two probe results first read as failures on items 6 and 8. Both were defects in the probe, not in the build, and both are worth recording because the next person will hit them:

- Item 6 acknowledged one care event and then asserted against a different, later one, because later fixtures in the same probe also derived to Level 3 once the first event's watch instance existed. The probe now captures the acknowledged id.
- Item 8 could not see the reporter column guard because `submit_care_event` sets `haven.care_event_definer` with `set_config(..., is_local => true)`, which is transaction-local, not function-local. The probe ran everything in one transaction, so the flag from the earlier submit was still set. PostgREST gives every request its own transaction, so this cannot leak in production; a probe that shares a transaction has to clear the flag itself.

## 2. Hosted state, read only

| Object | Production `manfqmasfqppukpobpld` | Haven HFO Staging `iwcnajanvjvynolltflw` |
|---|---|---|
| `care_events`, `care_event_deliveries`, `incident_followup_protocols`, `care_event_escalation_policies` | 4 of 4 present | 4 of 4 present |
| `v_resident_timeline`, `v_incident_reports_log` | 2 of 2 present | 2 of 2 present |
| Care-event functions | 11 of 11 present | 7 of 7 queried present |
| `incident-photos` bucket | private, limit 15728640, 5 image MIME types | private, limit 15728640, 5 image MIME types |
| Ledger 400 to 403 | all four, by numbered version | all four, by numbered version |
| Configuration rows | protocols 18, policies 12, routes 48 | protocols 18, policies 12 |
| `care_events` rows | 0 | 2 |
| `care-event-dispatcher` | ACTIVE, version 2 | not queried |

Nothing from 400 to 403 is missing and the dispatcher is deployed. COL-426 was opened when both hosted ledgers appeared to stop at 399; COL-444 has since applied and ledgered them, so COL-426's premise no longer holds. Go-live remains gated on the runbook preconditions, not on schema. Both tables above are commented onto COL-426 and COL-434.

## 3. Gap list

The eight tiles, the level engine, the fan-out, the escalation ladder, the administrator completion form, both views and the dispatcher are built. What is missing is everything between a captured event and a piece of paper an administrator can hand to a physician or a surveyor.

### 3.1 Witness statements (spec 07A section 5, Appendix A "Incident Form, Section 3")

Tasks are generated. They cannot be completed.

| # | Gap | Where |
|---|---|---|
| W1 | Seeded at `min_level = 'level_3'`, so a Heads-up event produces no witness task | `403_care_events_seed_col.sql:35` |
| W2 | The reporter receives a witness statement task for the event they reported | `402_care_events_functions.sql:950-969` has no reporter exclusion |
| W3 | No completion path takes "I saw it", "I did not see it" or "I arrived after" | No such function exists in `public` |
| W4 | `/caregiver/followups` reads `condition_changes` and never touches `incident_followups`, so a witness task is invisible to the person assigned it | `src/app/(caregiver)/followups/page.tsx:62` |
| W5 | Any caregiver at the facility can complete any other caregiver's task | `022_incident_reporting_rls.sql:54` is `FOR ALL`, facility-scoped, with no assignee test. The probe completed caregiver A's task as caregiver B |
| W6 | Completed statements appear on no surface, printed or otherwise | Not present in the care event card or the incident detail |

### 3.2 Attachments (spec 07A section 2, Appendix A)

| # | Gap | Where |
|---|---|---|
| A1 | The bucket accepts images only; a scanned paper form or a faxed physician order is a PDF | `400_care_events.sql:179` |
| A2 | The bucket limit is 15 MB, below the 20 MB a phone photograph of a full page reaches | `400_care_events.sql:178` |
| A3 | `incident_photos` has no `kind`, so a photograph, a scanned form and a physician order are indistinguishable | Table from `021_incident_reporting_schema.sql` |
| A4 | No cap on how many files one incident carries | `append_care_event_note` appends without counting |
| A5 | The administrator completion form cannot attach anything; `CareEventPhotos` only displays | `AdminCareEventPageClient.tsx` renders no upload control |
| A6 | The caregiver uploader is `accept="image/*"` | `ReportReceiptActions.tsx:89` |

What is already right and must stay right: the bucket is private, the read, insert and delete policies scope on `haven.organization_id()` and `haven.accessible_facility_ids()`, and signed URLs last 300 seconds.

### 3.3 Paper artifacts with no Haven equivalent

| Paper | Status |
|---|---|
| Incident Form Sections 1 to 4 in COL's layout | No print view exists |
| Physician notification sheet for the fax | No print view exists |
| Incident Reports Log in the paper column order | `v_incident_reports_log` exists and `/admin/incidents/reports-log` reads it, but there is no print layout |
| Taxonomy review packet for Jessica and Michelle to sign | Does not exist |

### 3.4 Physician fields

`residents.primary_physician_name`, `residents.primary_physician_phone` and `residents.primary_physician_fax` all exist (migration `386_resident_record_intake.sql`). The physician notification sheet can print a real fax number. No gap.

### 3.5 Owner decisions D1 to D7

None of the seven decisions in spec 07A section 8 is recorded in the repository or in Linear. They exist only as the spec's own table. Every one is filed in this run and every one is a runbook precondition or a note against it.

## 4. Findings outside this run's gap items

| Finding | Detail |
|---|---|
| A second incident capture form survives alongside spec 07A (**COL-452**) | `src/components/med-tech/IncidentModal.tsx:21-25` still asks a med tech to pick the severity from a four-item list. That is spec 07A diagnosis finding 2 ("the caregiver picks the severity level") and section 10's first forbidden pattern, on a surface the 07A build did not convert. `/admin/incidents/new` is a second such door |
| `audit_log` cannot hold a read event | `audit_log.action` is `CHECK (action = ANY (ARRAY['INSERT','UPDATE','DELETE']))`, so a print is recorded as an `INSERT` of a synthetic `table_name`. This run follows the COL-353 `survey_print_pack_record` pattern rather than inventing a second one. Consolidation is tracked on COL-379 |
| The definer flag is transaction-local, not function-local (**COL-454**) | `set_config('haven.care_event_definer', '1', true)` stays set for the rest of the transaction after the function returns. Harmless under PostgREST, which gives each request its own transaction, and a trap for any future probe or batch caller that shares one |
| No SQL probe covers care events (**COL-453**) | `supabase/tests/` has 74 `review_*.sql` probes and none for 400 to 403. This run adds one for the paths it builds |

## 5. What this means for paper

Filing an incident in Haven works today: three taps, no typing, a server-derived level, a real incident number, the whole regulatory fan-out and a delivery ledger. COL-354's first acceptance line is met.

Paper stays because of the last mile. An administrator cannot print the form COL's binder expects, cannot produce the sheet that goes to the physician by fax, cannot hand a surveyor the Incident Reports Log in its familiar column order, and cannot collect a witness statement from the aide standing in front of her. Those four, plus the taxonomy packet Jessica and Michelle sign against, are what this run builds. Retirement itself stays gated on Michelle's signature.
