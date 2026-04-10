# Track D — Phase 6 completion pass (execution log)

**Purpose:** Record **which Phase 6 module** is in focus for each bounded segment and what shipped. Authoritative module specs remain in `12-*` … `23-*`; [README.md](./README.md) § Track D lists example Enhanced gaps.

**First target (D1):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)).

**Rationale:** COL runs real resident transport and mileage workflows; the admin hub had **placeholder** “compliance” cards. **D1 slice:** replace mocks with **data-driven** expiry reminders from `driver_credentials` (license, medical card) and `fleet_vehicles` (insurance, registration) for the selected facility — operational visibility without new DDL.

**Deferred in D1 (still Track D backlog):** resident transport request scheduling UI, trip calendar, HL7 (Module 22), reputation sync (Module 23), training certificate uploads (Module 12), dietary cross-checks (Module 14).

**Gate artifact:** `test-results/agent-gates/2026-04-09T00-02-57-723Z-track-d-phase6-d1-transportation.json` (`npm run segment:gates -- --segment "track-d-phase6-d1-transportation" --ui --no-chaos`).

**Mission alignment:** **pass** — surfaces real compliance dates already governed by RLS; supports safer transport operations.

---

**D2 (2026-04-09):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)).

**Slice:** Replace mock “John Doe” / fake percentage bars on `/admin/training` with **RLS-backed** `competency_demonstrations` rows: attention queue for `draft` / `submitted` / `failed`, **recent passed** list, sidebar **counts** from the loaded batch (with disclaimer — not org-wide `training_compliance_snapshots`). Correct SYS label to Module 12.

**Gate artifact:** `test-results/agent-gates/2026-04-09T00-31-54-429Z-track-d-phase6-d2-training.json` (`npm run segment:gates -- --segment "track-d-phase6-d2-training" --ui --no-chaos`).

**Deferred:** Storage certificate uploads, Baya API, automated assignment (spec Enhanced).

---

**D3 (2026-04-09):** **Module 14 — Dietary & Nutrition** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)).

**Slice:** Replace mock NPO persona and fake “facility-wide” percentages on `/admin/dietary` with **RLS-backed** `diet_orders` data: **attention queue** for `draft`, `requires_swallow_eval`, or non-empty `aspiration_notes`; **roster** for other orders in the batch; sidebar **batch percentages** (thickened fluids, swallow-eval flagged, allergy constraints) with disclaimer. Correct SYS label to **Module 14**.

**Gate artifact:** `test-results/agent-gates/2026-04-09T00-35-52-241Z-track-d-phase6-d3-dietary.json` (`npm run segment:gates -- --segment "track-d-phase6-d3-dietary" --ui --no-chaos`).

**Mission alignment:** **pass** — uses existing clinical diet order rows under RLS; improves kitchen visibility without new DDL.

**Deferred:** Meal production sheets, vendor API, full menu cycle (spec Enhanced).

---

**D4 (2026-04-09):** **Module 22 — Referral CRM** ([22-referral-crm.md](./22-referral-crm.md)) + **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)).

**Slice:** On `/admin/referrals`, add **SYS Module 22** and **RLS-backed** `referral_hl7_inbound` **pending/failed counts** for the selected facility with link to the HL7 queue. On `/admin/reputation`, correct SYS label to **Module 23** (was mislabeled Module 10) and memoize draft vs posted reply lists for clearer rendering.

**Gate artifact:** `test-results/agent-gates/2026-04-09T00-41-37-766Z-track-d-phase6-d4-referral-crm-reputation.json` (`npm run segment:gates -- --segment "track-d-phase6-d4-referral-crm-reputation" --ui --no-chaos`).

**Mission alignment:** **pass** — surfaces real HL7 queue depth already governed by RLS; corrects module identity for operator trust.

**Deferred:** Full HL7 processor automation, external review API sync (spec Enhanced).

---

**D5 (2026-04-09):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **resident transport requests DDL + read-only hub list**.

**Slice:** Ship migration **`112`** — `resident_transport_requests` + enums `transport_type`, `transport_request_status`, RLS, audit. On `/admin/transportation`, load **upcoming** requests (appointment date ≥ today) with resident name join for visibility. No new create/edit form in this slice.

**Gate artifact:** `test-results/agent-gates/2026-04-09T00-47-20-706Z-track-d-phase6-d5-resident-transport-requests.json` (`npm run segment:gates -- --segment "track-d-phase6-d5-resident-transport-requests" --ui --no-chaos`).

**Mission alignment:** **pass** — closes a documented Track D gap (scheduling side) with governed clinical/ops data.

**Deferred:** Mileage link, driver–vehicle validation rules, full request CRUD UX.

---

**D6 (2026-04-09):** **Module 15 — Transportation** — **resident transport CRUD + mileage linkage**.

**Slice:** Migration **`113`** — `mileage_logs` (with `transport_request_id` FK), `fleet_vehicles.wheelchair_accessible`. **Routes:** `/admin/transportation/requests/new`, `/admin/transportation/requests/[id]` with zod validation; assign vehicle/driver with wheelchair + driver-credential checks; optional **`mileage_logs`** row when completing **`staff_personal_vehicle`** trips with miles entered (default rate `DEFAULT_MILEAGE_RATE_CENTS`). Hub links + vehicle form wheelchair flag.

**Gate artifact:** `test-results/agent-gates/2026-04-09T00-57-17-400Z-track-d-phase6-d6-transport-request-crud.json` (`npm run segment:gates -- --segment "track-d-phase6-d6-transport-request-crud" --ui --no-chaos`).

**Mission alignment:** **pass** — operational transport scheduling and reimbursement trail under RLS.

**Deferred:** Payroll export approval workflow, calendar view (org mileage rate shipped in **D10**).

---

**D7 (2026-04-09):** **Module 15 — Transportation** — **upcoming requests grouped by day (calendar-style)**.

**Slice:** On `/admin/transportation`, the **Upcoming resident transport** list is **grouped by `appointment_date`** with headings **Today** / **Tomorrow** / weekday date and a per-day trip count. No new DDL; same RLS-backed query as D5/D6.

**Deferred:** Full month/week grid, external calendar sync.

**Mission alignment:** **pass** — improves scanability of scheduled trips without expanding scope beyond Module 15 Core data already in use.

**Gate artifact:** `test-results/agent-gates/2026-04-09T01-39-18-521Z-track-d-phase6-d7-transport-day-groups.json` (`npm run segment:gates -- --segment "track-d-phase6-d7-transport-day-groups" --ui --no-chaos`).

---

**D8 (2026-04-09):** **Module 14 — Dietary & Nutrition** — **medication–texture cross-check visibility**.

**Slice:** Use existing `diet_orders.medication_texture_review_notes` (spec Core): include non-empty rows in the **attention queue** with badge **Med / texture review**, show notes in the card summary, and add sidebar batch **%** “Med / texture review noted.” Extends D3 without new DDL. Create/edit path already captures the field on `/admin/dietary/new`.

**Deferred:** Automated cross-check against `resident_medications` / pharmacy API (Enhanced).

**Mission alignment:** **pass** — human-entered pharmacy–texture review notes surface for kitchen and nursing alignment.

**Gate artifact:** `test-results/agent-gates/2026-04-09T01-45-04-373Z-track-d-phase6-d8-dietary-med-texture-review.json` (`npm run segment:gates -- --segment "track-d-phase6-d8-dietary-med-texture-review" --ui --no-chaos`).

---

**D9 (2026-04-09):** **Module 23 — Reputation** — **posted reply volume on hub**.

**Slice:** On `/admin/reputation`, add a fourth metric pillar **Posted Replies** (RLS-backed count from loaded `reputation_replies` with `status === "posted"`), alongside listings, drafts, and connect-listing CTA. No new DDL; external platform sync remains Enhanced/deferred.

**Mission alignment:** **pass** — operators see draft vs posted throughput without API integrations.

**Gate artifact:** `test-results/agent-gates/2026-04-09T01-50-54-231Z-track-d-phase6-d9-reputation-posted-metric.json` (`npm run segment:gates -- --segment "track-d-phase6-d9-reputation-posted-metric" --ui --no-chaos`).

---

**D10 (2026-04-09):** **Module 15 — Transportation** — **organization mileage reimbursement rate**.

**Slice:** Migration **`114`** — `organization_transport_settings` (`mileage_reimbursement_rate_cents` per org, RLS + audit). **Routes:** `/admin/transportation/settings` (owner/org_admin edit; others read-only context). **Integration:** `transport/requests/[id]` completion with mileage uses `getOrganizationMileageRateCents`; hub links to settings. Fallback: `DEFAULT_MILEAGE_RATE_CENTS` when no row.

**Gate artifact:** `test-results/agent-gates/2026-04-09T02-13-30-573Z-track-d-phase6-d10-org-mileage-rate.json` (`npm run segment:gates -- --segment "track-d-phase6-d10-org-mileage-rate" --ui --no-chaos`).

**Mission alignment:** **pass** — owner-visible reimbursement configuration; rates snapshotted on `mileage_logs` at insert.

**Deferred:** Payroll export approval workflow, month/week calendar, external calendar sync.

---

**D12 (2026-04-09):** **Module 22 — Referral CRM** ([22-referral-crm.md](./22-referral-crm.md)) — **HL7 inbound queue processor (minimal MSH)**.

**Slice:** Edge Function **`process-referral-hl7-inbound`** — `POST` with optional **`organization_id`** and **`limit`**; auth **`x-cron-secret`** = **`PROCESS_REFERRAL_HL7_INBOUND_SECRET`**. Selects **`referral_hl7_inbound`** rows with **`status = pending`**, parses **MSH** (field separator at MSH[3]; **`MSH-9`** message type / trigger, **`MSH-10`** control id), updates to **`processed`** with **`message_control_id`** / **`trigger_event`** or **`failed`** with structured **`parse_error`** (e.g. `no_msh_segment`, **`duplicate_message_control_id`** on unique conflict). **No** **`referral_leads`** creation.

**Gate artifact:** `test-results/agent-gates/2026-04-09T15-14-29-975Z-track-d-d12-process-referral-hl7-inbound.json` (`npm run segment:gates -- --segment "track-d-d12-process-referral-hl7-inbound" --no-chaos`).

**Mission alignment:** **pass** — advances referral pipeline hygiene with governed queue data; parsing stays subordinate to explicit reconciliation rules.

---

**D13–D16 (2026-04-09):** **Enhanced batch** — modules **14** (Dietary), **15** (Transportation), **22** (Referral CRM).

- **D13 — Module 14** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **`/admin/dietary/clinical-review`** — facility-scoped resident selector (from **`diet_orders`**), primary diet order summary (IDDSI, allergies, texture, med/texture review notes) alongside **`resident_medications`** (read-only). **No** automated rule engine.

- **D14 — Module 15** ([15-transportation.md](./15-transportation.md)) — **`/admin/transportation/calendar`** — Sunday-start week strip with trip counts; **clickable day** agenda for **`resident_transport_requests`**; week navigation. **No** new DDL.

- **D15 — Module 15** ([15-transportation.md](./15-transportation.md)) — **`/admin/transportation/mileage-approvals`** — **`mileage_logs`** with **`approved_at` IS NULL** (pending) + recently approved; **owner / org_admin / facility_admin / nurse** may **Approve** or **Undo** when **`payroll_export_id`** is null. **No** payroll file generation.

- **D16 — Module 22** ([22-referral-crm.md](./22-referral-crm.md)) — **`/admin/referrals/hl7-inbound`** — for **`processed`** rows without **`linked_referral_lead_id`**, **Draft lead** inserts **`referral_leads`** with **`external_reference`** = `hl7:{inbound_id}`, optional **PID-5** name; duplicate **`external_reference`** surfaces a clear error. **No** Edge automation.

**Gate artifact:** `test-results/agent-gates/2026-04-09T15-54-30-576Z-track-d-d13-d16-enhanced-batch.json` (`npm run segment:gates -- --segment "track-d-d13-d16-enhanced-batch" --ui --no-chaos`).

**Mission alignment:** **pass** — human review for diet–med visibility, mileage approval before payroll export, and referral lead creation stays explicit and staff-controlled.

---

**D17 (2026-04-09):** **Module 13 — Payroll Integration** ([13-payroll-integration.md](./13-payroll-integration.md)) — **approved mileage → export lines**.

**Slice:** **`/admin/payroll/[id]`** — draft batches show **Import mileage into batch**: loads **`mileage_logs`** with **`approved_at` set**, **`payroll_export_id` IS NULL**, **`trip_date`** within batch period; inserts **`payroll_export_lines`** (`line_kind` = `mileage_reimbursement`, idempotency `mileage:{log_id}`) and sets **`mileage_logs.payroll_export_id`**. Hub batches link to detail; payroll hub SYS label corrected to **Module 13**. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T15-01-34-839Z-track-d-d17-payroll-mileage-lines.json` (`npm run segment:gates -- --segment "track-d-d17-payroll-mileage-lines" --ui --no-chaos`).

**Mission alignment:** **pass** — reimbursement stays tied to approved trips and an explicit batch before external payroll handoff.

---

**D18 (2026-04-09):** **Module 13 — Payroll Integration** ([13-payroll-integration.md](./13-payroll-integration.md)) — **batch export CSV download**.

**Slice:** **`/admin/payroll/[id]`** — **Download CSV** builds RFC-style rows from loaded **`payroll_export_lines`** (idempotency key, staff names, `line_kind`, `amount_cents`, JSON **`payload`**). Client-side download only; **no** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-02-24-050Z-track-d-d18-payroll-batch-csv.json` (`npm run segment:gates -- --segment "track-d-d18-payroll-batch-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — finance staff can hand off structured line data to external payroll without expanding vendor integrations in-app.

---

**D19 (2026-04-09):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **replies CSV export**.

**Slice:** **`/admin/reputation`** — **Download replies CSV** queries up to **500** **`reputation_replies`** rows for the facility (with **`reputation_accounts`** label + platform), RFC-style CSV. **No** OAuth, **no** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-05-57-682Z-track-d-d19-reputation-replies-csv.json` (`npm run segment:gates -- --segment "track-d-d19-reputation-replies-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — operators can archive and hand off reply workflow data without automated platform sync.

---

**D20 (2026-04-09):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **org-wide competency hub**.

**Slice:** **`/admin/training`** when the header selector is **All facilities** loads the **latest 50** **`competency_demonstrations`** rows **without** a facility filter; **RLS** limits rows to accessible facilities. **Facility name** is shown on each card in org-wide mode. **+ New Demonstration** is disabled until a single facility is selected (unchanged create flow). **No** new DDL; **not** `training_compliance_snapshots`.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-12-12-498Z-track-d-d20-training-org-wide-hub.json` (`npm run segment:gates -- --segment "track-d-d20-training-org-wide-hub" --ui --no-chaos`).

**Mission alignment:** **pass** — multi-site owners see a single cross-facility queue under existing governance.

---

**D21 (2026-04-09):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **competency demonstrations CSV export**.

**Slice:** **`/admin/training`** — **Download demonstrations CSV** queries up to **500** **`competency_demonstrations`** rows ( **`staff`**, **`facilities(name)`** joins), RFC-style CSV including **attachment storage paths**; respects **single facility** or **All facilities** (RLS). **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-27-19-086Z-track-d-d21-training-demos-csv.json` (`npm run segment:gates -- --segment "track-d-d21-training-demos-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — staff can archive demonstration records for surveys or handoffs without Baya API integration.

---

**D22 (2026-04-09):** **Module 22 — Referral CRM** ([22-referral-crm.md](./22-referral-crm.md)) — **HL7 inbound queue CSV export**.

**Slice:** **`/admin/referrals/hl7-inbound`** — **Download queue CSV** queries up to **500** **`referral_hl7_inbound`** rows for the **selected facility** (metadata + **`raw_message`**). **No** MLLP, **no** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-30-21-849Z-track-d-d22-hl7-inbound-csv.json` (`npm run segment:gates -- --segment "track-d-d22-hl7-inbound-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — operators can hand off queue contents to hospitals or archives without automated ingestion.

---

**D23 (2026-04-09):** **Module 14 — Dietary & Nutrition** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **diet orders CSV export**.

**Slice:** **`/admin/dietary`** — **Download diet orders CSV** queries up to **500** **`diet_orders`** rows for the **selected facility** (**`residents(first_name, last_name)`** join), RFC-style CSV. **No** automated cross-check, **no** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-33-20-426Z-track-d-d23-diet-orders-csv.json` (`npm run segment:gates -- --segment "track-d-d23-diet-orders-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — kitchen and clinical staff can archive IDDSI and constraint data for handoffs without vendor integrations.

---

**D24 (2026-04-09):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **resident transport requests CSV export**.

**Slice:** **`/admin/transportation`** — **Download transport CSV** queries up to **500** **`resident_transport_requests`** rows for the **selected facility** (**`residents(first_name, last_name)`** join), RFC-style CSV. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-36-46-714Z-track-d-d24-transport-requests-csv.json` (`npm run segment:gates -- --segment "track-d-d24-transport-requests-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — staff can archive trip scheduling data for audits or handoffs without external calendar sync.

---

**D25 (2026-04-09):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **mileage logs CSV export**.

**Slice:** **`/admin/transportation/mileage-approvals`** — **Download mileage CSV** queries up to **500** **`mileage_logs`** rows for the **selected facility** (**`staff`**, **`residents`** joins), RFC-style CSV. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T16-39-49-130Z-track-d-d25-mileage-logs-csv.json` (`npm run segment:gates -- --segment "track-d-d25-mileage-logs-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — finance and ops can reconcile reimbursements outside the payroll batch CSV without changing approval rules.

---

**D26 (2026-04-09):** **Module 13 — Payroll Integration** ([13-payroll-integration.md](./13-payroll-integration.md)) — **payroll export batches list CSV**.

**Slice:** **`/admin/payroll`** — **Download batches CSV** queries up to **500** **`payroll_export_batches`** rows for the **selected facility**, RFC-style CSV. **No** vendor API worker, **no** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-00-26-890Z-track-d-d26-payroll-batches-csv.json` (`npm run segment:gates -- --segment "track-d-d26-payroll-batches-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — operators can archive batch metadata for audits alongside line-level export on batch detail.

---

**D27 (2026-04-09):** **Module 22 — Referral CRM** ([22-referral-crm.md](./22-referral-crm.md)) — **referral leads pipeline CSV export**.

**Slice:** **`/admin/referrals`** — **Download leads CSV** queries up to **500** **`referral_leads`** rows for the **selected facility** (**`referral_sources(name)`** join), RFC-style CSV. **No** MLLP, **no** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-03-52-499Z-track-d-d27-referral-leads-csv.json` (`npm run segment:gates -- --segment "track-d-d27-referral-leads-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — admissions staff can archive pipeline PII under existing RLS without automated HL7 lead creation.

---

**D28 (2026-04-09):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **reputation accounts CSV export**.

**Slice:** **`/admin/reputation`** — **Download accounts CSV** queries up to **500** **`reputation_accounts`** rows for the **selected facility**, RFC-style CSV. **No** OAuth/sync APIs, **no** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-06-55-466Z-track-d-d28-reputation-accounts-csv.json` (`npm run segment:gates -- --segment "track-d-d28-reputation-accounts-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — staff can archive listing metadata alongside replies export without third-party API keys.

---

**D29 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **staff roster CSV export**.

**Slice:** **`/admin/staff`** — **Download roster CSV** queries up to **500** **`staff`** rows (active only), RFC-style CSV; **excludes** **`ssn_last_four`** and **`date_of_birth`** from columns. Facility filter matches the live directory when a valid facility is selected. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-10-51-740Z-track-d-d29-staff-roster-csv.json` (`npm run segment:gates -- --segment "track-d-d29-staff-roster-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — operators can archive roster fields under RLS without expanding integration scope.

---

**D30 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **staff certifications CSV export**.

**Slice:** **`/admin/certifications`** — **Download certifications CSV** queries up to **500** **`staff_certifications`** rows (active only) plus **`staff_display_name`** from **`staff`**, RFC-style CSV. Facility filter matches the live matrix when a valid facility is selected. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-15-37-370Z-track-d-d30-certifications-csv.json` (`npm run segment:gates -- --segment "track-d-d30-certifications-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — compliance staff can archive credential rows under RLS without certificate storage or OAuth scope.

---

**D31 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **time records CSV export**.

**Slice:** **`/admin/time-records`** — **Download time records CSV** queries up to **500** **`time_records`** rows (active only) plus **`staff_display_name`** from **`staff`**, RFC-style CSV. Facility filter matches the live list when a valid facility is selected. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-19-28-514Z-track-d-d31-time-records-csv.json` (`npm run segment:gates -- --segment "track-d-d31-time-records-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — payroll prep can archive punches under RLS without vendor-specific payroll serializers.

---

**D32 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **staffing ratio snapshots CSV export**.

**Slice:** **`/admin/staffing`** — **Snapshots CSV** queries up to **500** **`staffing_ratio_snapshots`** rows, RFC-style CSV (includes **`staff_detail`** as **`staff_detail_json`**). Facility filter matches snapshot query when a valid facility is selected. **No** new DDL; exception-first mock UI unchanged.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-26-02-598Z-track-d-d32-staffing-snapshots-csv.json` (`npm run segment:gates -- --segment "track-d-d32-staffing-snapshots-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — operators can archive ratio history under RLS without replacing mock scheduling widgets in this slice.

---

**D33 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **schedule weeks (`schedules`) CSV export**.

**Slice:** **`/admin/schedules`** — **Download schedule weeks CSV** queries up to **500** **`schedules`** rows (active only), RFC-style CSV. Facility filter matches the hub list when a valid facility is selected. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-28-19-979Z-track-d-d33-schedule-weeks-csv.json` (`npm run segment:gates -- --segment "track-d-d33-schedule-weeks-csv" --ui --no-chaos`).

**Mission alignment:** **pass** — schedule containers export for audits without drag-drop builder scope.

---

**D34 (2026-04-09):** **Admin hub CSV helpers** — **shared `csvEscapeCell` + `triggerCsvDownload`** (`src/lib/csv-export.ts`).

**Slice:** Remove duplicate CSV escape/download implementations from all admin pages that already ship hub CSV exports (training, reputation, certifications, dietary, time-records, staffing, transportation, payroll hub + batch detail, referrals + HL7 inbound, mileage approvals); **`/admin/staff`** and **`/admin/schedules`** already imported the shared module. **No** DDL, **no** CSV column changes.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-43-58-315Z-track-d-d34-csv-export-consolidation.json` (`npm run segment:gates -- --segment "track-d-d34-csv-export-consolidation" --ui --no-chaos`).

**Mission alignment:** **pass** — single escaping/download path reduces drift and keeps exports predictable for audits.

---

**D35 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **schedule week detail + shift assignments CSV**.

**Slice:** **`/admin/schedules/[id]`** — read-only list of **`shift_assignments`** for the week container (up to **500**), **`staff_display_name`** in CSV; facility mismatch warning when the header facility does not match the schedule. **`/admin/schedules/new`** redirects to the new week’s detail page. **No** DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-51-29-200Z-track-d-d35-schedule-week-detail.json` (`npm run segment:gates -- --segment "track-d-d35-schedule-week-detail" --ui --no-chaos`).

**Mission alignment:** **pass** — closes the broken hub link to week detail and gives operators RLS-backed assignment export without building the full scheduling grid.

---

**D36 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **shift swap requests hub + CSV**.

**Slice:** **`/admin/shift-swaps`** — read-only **`shift_swap_requests`** list (up to **500**) with requesting/covering **`staff`** names; **Download CSV** with display name columns; Workforce nav link. **No** approve/deny workflow in this slice. **No** DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T17-59-06-961Z-track-d-d36-shift-swap-requests-hub.json` (`npm run segment:gates -- --segment "track-d-d36-shift-swap-requests-hub" --ui --no-chaos`).

**Mission alignment:** **pass** — surfaces COL shift-swap records under existing RLS for `facility_admin` / `nurse` oversight without OAuth or clinical automation scope.

---

**D37 (2026-04-09):** **Module 11 — Staff Management** ([11-staff-management.md](./11-staff-management.md)) — **shift swap approve / deny (pending only)**.

**Slice:** **`/admin/shift-swaps`** — **Approve** sets `status=approved`, `approved_at`, `approved_by`; **Deny** (modal + required reason) sets `status=denied`, `denied_reason`, clears approval fields. **No** DDL; relies on existing **`staff_update_shift_swap_requests`** RLS.

**Gate artifact:** `test-results/agent-gates/2026-04-09T18-04-15-351Z-track-d-d37-shift-swap-approve-deny.json` (`npm run segment:gates -- --segment "track-d-d37-shift-swap-approve-deny" --ui --no-chaos`).

**Mission alignment:** **pass** — completes manager workflow on existing swap rows with audit fields; no scheduling engine scope creep.

---

**D38 (2026-04-09):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **`training_programs` + `staff_training_completions` DDL + hub read list + CSV**.

**Slice:** Migration **`116`** — enums, catalog table, completion log, RLS, audit, FL mandatory program seeds for COL org. **`/admin/training`** — **Staff training completions** table (last **50**) with **Download completions CSV** (up to **500**). **No** completion create/edit UX in this segment.

**Gate artifact:** `test-results/agent-gates/2026-04-09T18-29-47-023Z-track-d-d38-staff-training-completions.json` (`npm run segment:gates -- --segment "track-d-d38-staff-training-completions" --ui --no-chaos`).

**Mission alignment:** **pass** — governed training completion visibility for audits; catalog seed matches Florida regulatory table in spec.

---

**D39 (2026-04-09):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **log `staff_training_completions` (manual entry)**.

**Slice:** **`/admin/training/completions/new`** — single-facility form (staff, program, dates, delivery, optional provider/certificate/notes); hub **+ Log completion** link. **No** new DDL; **no** attachment upload in this segment.

**Gate artifact:** `test-results/agent-gates/2026-04-09T18-41-32-018Z-track-d-d39-training-completion-log.json` (`npm run segment:gates -- --segment "track-d-d39-training-completion-log" --ui --no-chaos`)

**Mission alignment:** **pass** — closes the documented gap between catalog/completions table and operator data entry for Florida-mandated training tracking.

---

**D40 (2026-04-09):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **optional PDF on `staff_training_completions` + storage RLS**.

**Slice:** Migration **`117`** — extend **`competency-certificates`** read policy for paths **`…/tc/{completion_id}/…`**. **`/admin/training/completions/new`** optional PDF upload; hub **PDF** column. **`trainingCompletionCertificatePath`** in `competency-storage.ts`.

**Gate artifact:** `test-results/agent-gates/2026-04-09T18-48-12-134Z-track-d-d40-training-completion-pdf.json` (`npm run segment:gates -- --segment "track-d-d40-training-completion-pdf" --ui --no-chaos`)

**Mission alignment:** **pass** — Baya/external certificate PDFs can be stored and audited without OAuth or new buckets.

---

**D41 (2026-04-10):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **`inservice_log_sessions` + `inservice_log_attendees` DDL**.

**Slice:** Migration **`118`** — in-service session header + attendee sign-in rows, facility-scoped RLS (admin write; facility read + self on attendees), audit triggers. **`src/types/database.ts`** updated. **No** training hub UI or auto-**`staff_training_completions`** trigger in this segment.

**Gate artifact:** `test-results/agent-gates/2026-04-09T18-54-32-966Z-track-d-d41-inservice-sessions-ddl.json` (`npm run segment:gates -- --segment "track-d-d41-inservice-sessions-ddl" --no-chaos`)

**Mission alignment:** **pass** — digitalizes COL paper sign-in data model under existing RLS patterns; UI/logging of completions remains follow-up.

---

**D42 (2026-04-10):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **in-service hub list + CSV + new session form**.

**Slice:** **`/admin/training`** — last **50** **`inservice_log_sessions`** (attendee count); **Download in-service CSV** (up to **500**). **`/admin/training/inservice/new`** — create session + **`inservice_log_attendees`** (staff checkboxes). **No** auto-**`staff_training_completions`** from attendees (deferred). **`FRONTEND-CONTRACT.md`** routes updated.

**Gate artifact:** `test-results/agent-gates/2026-04-09T19-02-07-941Z-track-d-d42-inservice-hub-ui.json` (`npm run segment:gates -- --segment "track-d-d42-inservice-hub-ui" --ui --no-chaos`)

**Mission alignment:** **pass** — operators can record group training sign-in digitally under RLS; completion automation stays explicit follow-up.

---

**D43 (2026-04-10):** **Module 12 — Training & Competency** ([12-training-competency.md](./12-training-competency.md)) — **in-service save → `staff_training_completions` (catalog program)**.

**Slice:** **`/admin/training/inservice/new`** — when a **training program** is selected, after **`inservice_log_attendees`** insert, batch insert **`staff_training_completions`** per attendee (`in_person`, session date/hours, evaluator = signed-in user, notes reference session id). On failure: delete attendees + soft-delete session. **No** new migration. Spec business rule 5 updated.

**Gate artifact:** `test-results/agent-gates/2026-04-09T20-39-46-632Z-track-d-d43-inservice-completion-automation.json` (`npm run segment:gates -- --segment "track-d-d43-inservice-completion-automation" --ui`)

**Mission alignment:** **pass** — ties group sign-in to catalog compliance rows without duplicating manual completion entry when a program applies.

---

**D44 (2026-04-10):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **Google OAuth connect + server-only token storage**.

**Slice:** Migration **`119`** — **`reputation_google_oauth_credentials`** (RLS on, no user policies; service role in API routes). **`/admin/reputation/integrations`** + hub link; **`GET/DELETE`** API routes for status/disconnect; **`GET`** `/api/reputation/oauth/google` + **`/callback`** for Business Profile scope. Env contract in spec + `.env.example`. **Deferred:** automated review fetch / Yelp / API posting.

**Gate artifact:** `test-results/agent-gates/2026-04-09T22-39-00-595Z-track-d-d44-reputation-google-oauth.json` (`npm run segment:gates -- --segment "track-d-d44-reputation-google-oauth" --ui`)

**Mission alignment:** **pass** — owner-controlled external integration path without changing manual reply workflows; tokens not exposed to client.

---

**D45 (2026-04-10):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **manual Google review import (owner-triggered)**.

**Slice:** **`POST /api/reputation/sync/google`** — refresh token → Business Profile API v4 list reviews per **`reputation_accounts`** (`platform = google_business`); resolve location via **`external_place_id`** (full `accounts/…/locations/…`, numeric id, or label↔title match); insert new **`reputation_replies`** rows (`draft`, placeholder `reply_body`, idempotent on **`external_review_id`**). **`/admin/reputation/integrations`** — **Import Google reviews now**. **`refreshAccessToken`** in **`google-oauth.ts`**; helpers in **`google-business-reviews.ts`**. **No** new migration.

**Gate artifact:** `test-results/agent-gates/2026-04-09T22-43-40-346Z-track-d-d45-reputation-google-review-sync.json` (`npm run segment:gates -- --segment "track-d-d45-reputation-google-review-sync" --ui`)

**Mission alignment:** **pass** — surfaces public reviews into operator-controlled draft workflow without auto-posting or Yelp.

---

**D46 (2026-04-10):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **cron-triggered Google review import**.

**Slice:** **`POST /api/cron/reputation/google-reviews`** — `x-cron-secret` = **`REPUTATION_GOOGLE_CRON_SECRET`**; optional body **`organization_id`**; service-role **`runGoogleReviewSync`** for each credential row; **`created_by`** = **`connected_by`**; skip if **`connected_by`** null. Refactor manual sync to **`src/lib/reputation/run-google-review-sync.ts`**. **`.env.example`** documents cron secret.

**Gate artifact:** `test-results/agent-gates/2026-04-09T22-47-05-809Z-track-d-d46-reputation-google-review-cron.json` (`npm run segment:gates -- --segment "track-d-d46-reputation-google-review-cron" --ui`)

**Mission alignment:** **pass** — scheduled import reuses the same draft-only path; secret-gated server job.

---

**D47 (2026-04-10):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **Yelp Fusion manual review import**.

**Slice:** **`POST /api/reputation/sync/yelp`** — owner-only; **`YELP_FUSION_API_KEY`**; **`reputation_accounts`** with **`platform = yelp`**, **`external_place_id`** = Yelp business id; Fusion **≤3** excerpts per business; **`runYelpReviewSync`** + **`yelp-fusion.ts`**. Integrations status **`yelpFusionConfigured`**; second card **Import Yelp reviews now**. **No** new migration.

**Gate artifact:** `test-results/agent-gates/2026-04-09T22-50-04-308Z-track-d-d47-reputation-yelp-fusion-import.json` (`npm run segment:gates -- --segment "track-d-d47-reputation-yelp-fusion-import" --ui`)

**Mission alignment:** **pass** — draft-only ingestion; API key server-side; Yelp excerpt limit documented.

---

**D48 (2026-04-10):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **post draft reply to Google (`updateReply`)**.

**Slice:** **`POST /api/reputation/replies/[id]/post-google`** — RLS; OAuth refresh; **`buildGoogleReviewResourceName`** + **`putGoogleReviewReply`**; hub draft **textarea** (save on blur), **Post reply to Google** + **Record posted (manual)**. **No** new migration.

**Gate artifact:** `test-results/agent-gates/2026-04-09T23-15-38-515Z-track-d-d48-reputation-google-post-reply.json` (`npm run segment:gates -- --segment "track-d-d48-reputation-google-post-reply" --ui`)

**Mission alignment:** **pass** — human-authored reply text via existing draft workflow; Google API only after OAuth.

---

**D49 (2026-04-10):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **post draft reply to Yelp (Partner public comment)**.

**Slice:** **`POST /api/reputation/replies/[id]/post-yelp`** — RLS; **`postYelpPublicReviewResponse`** (`partner-api.yelp.com`); env **`YELP_PARTNER_API_KEY`** or **`YELP_FUSION_API_KEY`**; integrations status **`yelpPartnerPostConfigured`**; hub **Post reply to Yelp** for **`platform = yelp`** + **`external_review_id`**. **No** new migration.

**Gate artifact:** `test-results/agent-gates/2026-04-09T23-22-25-530Z-track-d-d49-reputation-yelp-post-reply.json` (`npm run segment:gates -- --segment "track-d-d49-reputation-yelp-post-reply" --ui`)

**Mission alignment:** **pass** — same draft workflow as Google; external post only with operator-edited body (not import placeholder).

---

**D50 (2026-04-10):** **Module 14 — Dietary** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **read-only liquid-form vs thickened-fluid hint** on clinical review.

**Slice:** **`src/lib/dietary/med-fluid-diet-hints.ts`** — when **`iddsi_fluid_level`** is not thin/unassessed and an **active** med’s **`form`** matches liquid-like keywords, show an **advisory** callout on **`/admin/dietary/clinical-review`** (pharmacy/prescriber confirm). **No** Edge job, **no** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-09T23-24-37-055Z-track-d-d50-dietary-clinical-review-fluid-hint.json` (`npm run segment:gates -- --segment "track-d-d50-dietary-clinical-review-fluid-hint" --ui`)

**Mission alignment:** **pass** — surfaces a common operational mismatch for human follow-up; explicitly not automated clinical decision-making.

---

**D51 (2026-04-10):** **Module 14 — Dietary** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **read-only solid oral form vs pureed/liquidized food hint** on clinical review.

**Slice:** **`solidOralFormVsPureedFoodHint`** in **`med-fluid-diet-hints.ts`** — when **`iddsi_food_level`** is **`level_3_liquidized`** or **`level_4_pureed`** and an **active** med’s **`form`** matches solid-or oral patterns (excludes liquid-like forms). **No** Edge job, **no** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-09T23-26-46-594Z-track-d-d51-dietary-solid-oral-puree-hint.json` (`npm run segment:gates -- --segment "track-d-d51-dietary-solid-oral-puree-hint" --ui`)

**Mission alignment:** **pass** — prompts pharmacy follow-up for crush/compound decisions without automating clinical conclusions.

---

**D52 (2026-04-10):** **Module 14 — Dietary** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **expand solid-oral vs diet hint to IDDSI food levels 5–6**.

**Slice:** **`isTextureModifiedFoodForSolidOralHint`** + **`solidOralFormVsTextureModifiedFoodHint`** — same **`med-fluid-diet-hints.ts`**; triggers for **`level_5_minced_moist`** and **`level_6_soft_bite_sized`** in addition to **D51** levels 3–4. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-09T23-28-43-213Z-track-d-d52-dietary-solid-oral-texture-levels-expanded.json` (`npm run segment:gates -- --segment "track-d-d52-dietary-solid-oral-texture-levels-expanded" --ui`)

**Mission alignment:** **pass** — broader operational prompt for texture-modified diets; still advisory-only.

---

**D53 (2026-04-10):** **Module 14 — Dietary** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **IDDSI labels in med–diet hint callouts** on clinical review.

**Slice:** **`/admin/dietary/clinical-review`** — when a hint shows, display **primary order fluid (IDDSI)** on the liquid/thickened callout and **primary order food (IDDSI)** on the solid-or/texture callout (`formatEnumLabel`). **No** helper or migration changes.

**Gate artifact:** `test-results/agent-gates/2026-04-09T23-30-30-715Z-track-d-d53-dietary-clinical-review-hint-iddsi-labels.json` (`npm run segment:gates -- --segment "track-d-d53-dietary-clinical-review-hint-iddsi-labels" --ui`)

**Mission alignment:** **pass** — clearer operator context at point of alert; no automated clinical decision.

---

**D54:** **Module 14 — Dietary** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **canonical `/admin/dietary` URL** (redirect stray `/dietary`).

**Slice:** **`next.config.ts`** `redirects` — **`/dietary`** and **`/dietary/:path*`** → **`/admin/dietary`** (permanent). Route-group `(admin)` otherwise exposes Module 14 at a non-shell path. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-03-44-597Z-track-d-d54-dietary-canonical-path-redirect.json` (`npm run segment:gates -- --segment "track-d-d54-dietary-canonical-path-redirect"`)

**Mission alignment:** **pass** — aligns URLs with admin shell contract; no clinical automation.

---

**D55 (2026-04-10):** **Platform — Admin shell canonical URLs** (`FRONTEND-CONTRACT.md`)

**Slice:** **`next.config.ts`** `redirects` — for each hub that has both **`(admin)/<segment>/page.tsx`** and **`admin/<segment>/page.tsx`**, **`/<segment>`** and **`/<segment>/:path*`** → **`/admin/<segment>`** (permanent). Extends **D54** (dietary-only) to **billing, certifications, dietary, executive, finance, incidents, insurance, payroll, reports, reputation, residents, schedules, search, staff, staffing, time-records, training, transportation, vendors**. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-06-14-016Z-track-d-d55-admin-shell-canonical-redirects.json` (`npm run segment:gates -- --segment "track-d-d55-admin-shell-canonical-redirects" --ui`)

**Mission alignment:** **pass** — consistent operator-facing URLs with the admin shell; no clinical automation.

---

**D56 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **month calendar** on transport hub calendar route.

**Slice:** **`/admin/transportation/calendar`** — **Week** / **Month** toggle; month view uses a Sunday-start grid (including leading/trailing days outside the month, muted), trip counts per day, prev/next month, **This month**; same **`resident_transport_requests`** query pattern as week view with a wider date range (**500** row limit). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-09-40-067Z-track-d-d56-transportation-calendar-month-view.json` (`npm run segment:gates -- --segment "track-d-d56-transportation-calendar-month-view" --ui`)

**Mission alignment:** **pass** — clearer scheduling visibility for operators; no automated routing or billing.

---

**D57 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **ICS export** on calendar route.

**Slice:** **`/admin/transportation/calendar`** — **Download `.ics`** builds an iCalendar file from **`resident_transport_requests`** already loaded for the active week or month (same query window as the grid). **`src/lib/transportation/transport-requests-ics.ts`**; **`triggerFileDownload`** in **`src/lib/csv-export.ts`**. **No** migration; **not** OAuth/webcal.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-12-12-086Z-track-d-d57-transport-calendar-ics-export.json` (`npm run segment:gates -- --segment "track-d-d57-transport-calendar-ics-export" --ui`)

**Mission alignment:** **pass** — operator handoff to external calendars without automating clinical or billing decisions.

---

**D58 (2026-04-10):** **Module 13 — Payroll** ([13-payroll-integration.md](./13-payroll-integration.md)) — **import approved `time_records`** into export lines.

**Slice:** **`/admin/payroll/[id]`** (draft) — second import card: approved **`time_records`** with **`clock_in`** in pay period (**`America/New_York`** wall bounds via **`payPeriodClockBoundsUtc`**), **`line_kind`** **`time_record_hours`**, **`time_record_id`** + hour **`payload`**, idempotency **`time_record:{id}`**; **`amount_cents`** null. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-15-27-115Z-track-d-d58-payroll-import-approved-time-records.json` (`npm run segment:gates -- --segment "track-d-d58-payroll-import-approved-time-records" --ui`)

**Mission alignment:** **pass** — payroll handoff data for workforce ops; rates remain with the vendor.

---

**D59 (2026-04-10):** **Module 13 — Payroll** ([13-payroll-integration.md](./13-payroll-integration.md)) — **flat CSV** export preset on batch detail.

**Slice:** **`/admin/payroll/[id]`** — **`Download CSV (flat)`** alongside existing full CSV: parsed **`hours`** / **`miles`** from line **`payload`** for **`time_record_hours`** and **`mileage_reimbursement`**; **`src/lib/payroll/payroll-export-csv.ts`**. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-17-48-135Z-track-d-d59-payroll-export-flat-csv.json` (`npm run segment:gates -- --segment "track-d-d59-payroll-export-flat-csv" --ui`)

**Mission alignment:** **pass** — easier vendor handoff without changing pay rules in-app.

---

**D60 (2026-04-10):** **Module 11 — Staff / time** ([11-staff-management.md](./11-staff-management.md)) — **bulk approve** on time records hub.

**Slice:** **`/admin/time-records`** — **Approve all pending (N)** for loaded rows with **`clock_out`** and **`approved`** false, facility-scoped; **`updated_by`** + **`approved_*`** set. **No** migration. **RLS:** requires roles allowed by existing **`time_records`** UPDATE policy (not **`nurse`** for others’ rows).

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-20-17-056Z-track-d-d60-time-records-bulk-approve.json` (`npm run segment:gates -- --segment "track-d-d60-time-records-bulk-approve" --ui`)

**Mission alignment:** **pass** — faster payroll readiness for supervisors without changing pay math.

---

**D61 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **Add to Google Calendar** on request detail.

**Slice:** **`/admin/transportation/requests/[id]`** — **`buildGoogleCalendarTemplateUrl`** (`src/lib/transport/google-calendar-template-url.ts`): pre-filled **title** (resident + destination), **details** (purpose + notes), **location** (destination name/address); **1-hour** window from **`appointment_date`** + **`appointment_time`** (default **09:00** if time blank). Opens **`calendar.google.com`** in a new tab — **not** OAuth, **not** live sync. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-23-14-953Z-track-d-d61-transport-request-google-calendar.json` (`npm run segment:gates -- --segment "track-d-d61-transport-request-google-calendar" --ui`)

**Mission alignment:** **pass** — staff can place trips on personal calendars without bidirectional integration.

---

**D62 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **Outlook** compose deeplink on request detail.

**Slice:** **`/admin/transportation/requests/[id]`** — **`buildOutlookCalendarComposeUrl`** (`src/lib/transport/google-calendar-template-url.ts`): same **title** / **details** / **location** / **window** as D61; **`outlook.office.com`** deeplink with **`startdt`** / **`enddt`** (ISO). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-25-33-177Z-track-d-d62-transport-request-outlook-calendar.json` (`npm run segment:gates -- --segment "track-d-d62-transport-request-outlook-calendar" --ui`)

**Mission alignment:** **pass** — Microsoft 365–heavy operators can file trips without live sync.

---

**D63 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **single-trip `.ics`** on request detail.

**Slice:** **`/admin/transportation/requests/[id]`** — **`Download .ics`** via **`buildTransportRequestsIcs`** (`src/lib/transportation/transport-requests-ics.ts`) + **`triggerFileDownload`**; same **TZID** / all-day rules as **D57**; reflects current form fields (date, time, destination, purpose, status). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-27-49-517Z-track-d-d63-transport-request-ics-download.json` (`npm run segment:gates -- --segment "track-d-d63-transport-request-ics-download" --ui`)

**Mission alignment:** **pass** — Apple Calendar and other ICS clients get the same trip without live sync.

---

**D64 (2026-04-10):** **Module 13 — Payroll** ([13-payroll-integration.md](./13-payroll-integration.md)) — **vendor handoff** CSV on batch detail.

**Slice:** **`/admin/payroll/[id]`** — **`buildPayrollLinesCsvVendorHandoff`** in **`src/lib/payroll/payroll-export-csv.ts`**: repeats **`period_start`** / **`period_end`**, same **hours** / **miles** extraction as D59, **`amount_usd`** from **`amount_cents`**. Not ADP/Gusto proprietary layouts. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-30-14-190Z-track-d-d64-payroll-vendor-handoff-csv.json` (`npm run segment:gates -- --segment "track-d-d64-payroll-vendor-handoff-csv" --ui`)

**Mission alignment:** **pass** — clearer spreadsheet handoff without changing pay rules in-app.

---

**D65 (2026-04-10):** **Module 22 — Referral CRM / HL7** ([22-referral-crm.md](./22-referral-crm.md)) — **Copy raw** on inbound queue.

**Slice:** **`/admin/referrals/hl7-inbound`** — per-row **Copy raw** copies full **`raw_message`** to the clipboard; brief **Copied** state. **No** migration; **no** MLLP.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-32-39-542Z-track-d-d65-hl7-inbound-copy-raw.json` (`npm run segment:gates -- --segment "track-d-d65-hl7-inbound-copy-raw" --ui`)

**Mission alignment:** **pass** — faster partner troubleshooting without auto-ingest or PHI expansion beyond existing queue visibility.

---

**D66 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — calendar **deep link** + request detail link.

**Slice:** **`/admin/transportation/calendar`** — read **`?date=YYYY-MM-DD`** (optional **`?view=week|month`**) on load; aligns **`weekAnchor`**, **`monthAnchor`**, **`selectedDay`**. **`/admin/transportation/requests/[id]`** — **View on transportation calendar** → same **`?date=`** (appointment date). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-35-18-314Z-track-d-d66-transport-calendar-date-query.json` (`npm run segment:gates -- --segment "track-d-d66-transport-calendar-date-query" --ui`)

**Mission alignment:** **pass** — operators jump from a trip to the facility calendar context without live sync.

---

**D67 (2026-04-10):** **Module 22 — Referral CRM / HL7** ([22-referral-crm.md](./22-referral-crm.md)) — inbound queue **status filter**.

**Slice:** **`/admin/referrals/hl7-inbound`** — **All** / **pending** / **processed** / **failed** / **ignored** filters loaded rows client-side; **Showing N of M** count. **Download queue CSV** was full-scope at ship (**D68** aligns export with filter). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-37-47-484Z-track-d-d67-hl7-inbound-status-filter.json`

**Mission alignment:** **pass** — faster triage without changing ingest rules or auto-leads.

---

**D68 (2026-04-10):** **Module 22 — Referral CRM / HL7** ([22-referral-crm.md](./22-referral-crm.md)) — **queue CSV respects status filter**.

**Slice:** **`/admin/referrals/hl7-inbound`** — **Download queue CSV** applies the same **status** filter as the hub when not **All** (Supabase query **`.eq("status", …)`**, up to **500** rows); filename suffix **`_<status>`** when filtered. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-40-29-588Z-track-d-d68-hl7-inbound-csv-status-filter.json`

**Mission alignment:** **pass** — exports match triage focus without changing ingest or auto-leads.

---

**D69 (2026-04-10):** **Module 13 — Payroll** ([13-payroll-integration.md](./13-payroll-integration.md)) — **hours split CSV** on batch detail.

**Slice:** **`/admin/payroll/[id]`** — fourth download **`Download CSV (hours split)`**: **`buildPayrollLinesCsvHoursSplit`** — **`regular_hours`**, **`overtime_hours`**, **`total_hours`** (time lines) plus period, idempotency, staff, **`line_kind`**, **`miles`**, **`amount_usd`**; **`total_hours`** matches existing flat hours logic. **No** migration; not vendor-proprietary layouts.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-43-11-260Z-track-d-d69-payroll-csv-hours-split.json`

**Mission alignment:** **pass** — clearer spreadsheet handoff for REG/OT without changing pay rules or vendor APIs.

---

**D70 (2026-04-10):** **Module 22 — Referral CRM** ([22-referral-crm.md](./22-referral-crm.md)) — **pipeline leads status filter + CSV**.

**Slice:** **`/admin/referrals`** — **All** + each **`referral_lead_status`** filters the **50** loaded rows client-side; **Showing N of M**. **Download leads CSV** applies **`.eq("status", …)`** when not **All** (up to **500**); filename **`referral-leads-YYYY-MM-DD_<status>.csv`** when filtered. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-45-33-699Z-track-d-d70-referral-leads-status-filter.json`

**Mission alignment:** **pass** — faster pipeline triage and scoped export without auto-ingest or HL7 changes.

---

**D71 (2026-04-10):** **Module 22 — Referral CRM / HL7** ([22-referral-crm.md](./22-referral-crm.md)) — **HL7 inbound queue search**.

**Slice:** **`/admin/referrals/hl7-inbound`** — **Search** input (client-side) filters loaded rows by substring on **control ID**, **trigger**, **parse error**, **raw**; stacks with **status** filter; **Download queue CSV** unchanged (status + **500** cap only). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-47-46-654Z-track-d-d71-hl7-inbound-search.json`

**Mission alignment:** **pass** — faster partner troubleshooting without MLLP or auto-leads.

---

**D72 (2026-04-10):** **Module 22 — Referral CRM** ([22-referral-crm.md](./22-referral-crm.md)) — **pipeline leads search**.

**Slice:** **`/admin/referrals`** — **Search** input (client-side) on loaded rows: substring match on **name**, **phone**, **email**, **source**, **external_reference**, **notes**, **id**, **status**; stacks with **status** filter; **Download leads CSV** unchanged (status + **500** cap). List query adds **email**, **phone**, **external_reference**, **notes** for search. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-50-14-364Z-track-d-d72-referral-pipeline-search.json`

**Mission alignment:** **pass** — faster lead lookup without changing pipeline rules or HL7.

---

**D73 (2026-04-10):** **Module 13 — Payroll** ([13-payroll-integration.md](./13-payroll-integration.md)) — **payroll hub batch status filter + CSV**.

**Slice:** **`/admin/payroll`** — **All** + each **`payroll_export_batch_status`** filters **50** loaded rows client-side; **Showing N of M**; summary card count matches **filtered** list. **Download batches CSV** applies **`.eq("status", …)`** when not **All** (up to **500**); filename **`payroll-export-batches-YYYY-MM-DD_<status>.csv`** when filtered. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-52-55-103Z-track-d-d73-payroll-hub-status-filter.json`

**Mission alignment:** **pass** — faster batch triage without changing export line rules or vendor integrations.

---

**D74 (2026-04-10):** **Module 13 — Payroll** ([13-payroll-integration.md](./13-payroll-integration.md)) — **payroll hub batch search**.

**Slice:** **`/admin/payroll`** — **Search** (client-side) filters **display** rows by substring on **period_start** / **period_end**, **provider**, **notes**, **id**, **status**; stacks with **D73** **status** filter; KPI card uses **display** count; **Download batches CSV** unchanged (**status** + **500** only). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-55-12-291Z-track-d-d74-payroll-hub-search.json`

**Mission alignment:** **pass** — faster batch lookup without changing pay export semantics.

---

**D75 (2026-04-10):** **Module 23 — Reputation** ([23-reputation.md](./23-reputation.md)) — **replies CSV status scope**.

**Slice:** **`/admin/reputation`** — **Replies CSV** dropdown (**All** / **draft** / **posted** / **failed**) scopes the **Download replies CSV** query (up to **500** rows); filename suffix **`_draft`**, **`_posted`**, or **`_failed`** when not **All**. Hub list columns unchanged. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T00-59-05-074Z-track-d-d75-reputation-replies-csv-status.json` (`npm run segment:gates -- --segment "track-d-d75-reputation-replies-csv-status" --ui`)

**Mission alignment:** **pass** — operators can export only failed or draft replies for handoff without changing posting APIs or review import behavior.

---

**D76 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **transport hub status filter + CSV scope**.

**Slice:** **`/admin/transportation`** — **Status** dropdown (**All** + each **`transport_request_status`**) filters the **25** loaded upcoming trips client-side; **Showing N of M**; empty state when no rows match. **Download transport CSV** applies **`.eq("status", …)`** when not **All** (up to **500**); filename suffix **`_<status>`** before **`.csv`**. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T01-05-14-434Z-track-d-d76-transport-hub-status-csv.json` (`npm run segment:gates -- --segment "track-d-d76-transport-hub-status-csv" --ui`)

**Mission alignment:** **pass** — faster trip triage and scoped export without changing transport request lifecycle rules or calendar routes.

---

**D77 (2026-04-10):** **Module 14 — Dietary** ([14-dietary-nutrition.md](./14-dietary-nutrition.md)) — **diet hub status filter + CSV scope**.

**Slice:** **`/admin/dietary`** — **Status** dropdown (**All** + **`draft`** / **`active`** / **`discontinued`**) filters the **50** loaded **`diet_orders`** client-side; **Showing N of M**; KPI count matches **filtered** rows; attention queue + **Therapeutic Context** bars use **filtered** data; empty state when no rows match. **Download diet orders CSV** applies **`.eq("status", …)`** when not **All** (up to **500**); filename suffix **`_<status>`** when filtered. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T01-08-35-354Z-track-d-d77-dietary-hub-status-csv.json` (`npm run segment:gates -- --segment "track-d-d77-dietary-hub-status-csv" --ui`)

**Mission alignment:** **pass** — triage and export stay within existing diet order workflow; no automated med–texture Edge job.

---

**D78 (2026-04-10):** **Module 15 — Transportation** ([15-transportation.md](./15-transportation.md)) — **mileage approvals CSV scope**.

**Slice:** **`/admin/transportation/mileage-approvals`** — **CSV** dropdown (**All rows** / **Pending approval only** / **Approved only**) scopes the export query (up to **500**); **`.is("approved_at", null)`** or **`.not("approved_at", "is", null)`** when filtered; filename **`mileage-logs-YYYY-MM-DD_pending.csv`** or **`_approved.csv`** when not **All**. Pending / approved **tabs** unchanged. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T01-11-53-288Z-track-d-d78-mileage-approvals-csv-scope.json` (`npm run segment:gates -- --segment "track-d-d78-mileage-approvals-csv-scope" --ui`)

**Mission alignment:** **pass** — scoped reimbursement export without changing approval rules or payroll export integration.

---

**D79 (2026-04-10):** **Module 11 — Staff / Time** ([11-staff-management.md](./11-staff-management.md)) — **time records CSV approval scope**.

**Slice:** **`/admin/time-records`** — **Download time records CSV** applies the same **approval** filter as the hub (**All approval states** / **Approved** / **Not approved**): **`.eq("approved", true|false)`** when not **All** (up to **500** rows); filename **`time-records-YYYY-MM-DD_approved.csv`** or **`_not_approved.csv`** when filtered. **Search** remains **list-only** (documented in UI). **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T01-15-00-948Z-track-d-d79-time-records-csv-approval-scope.json` (`npm run segment:gates -- --segment "track-d-d79-time-records-csv-approval-scope" --ui`)

**Mission alignment:** **pass** — payroll prep exports can match approval state without changing bulk approve or clock semantics.

---

**D80 (2026-04-10):** **Module 11 — Staff** ([11-staff-management.md](./11-staff-management.md)) — **staff roster CSV hub filter scope**.

**Slice:** **`/admin/staff`** — **Download roster CSV** exports **`staff`** rows whose ids match the **filtered hub list** (search, role, status, certification); full columns per D29; order follows the hub list. Filename **`staff-roster-YYYY-MM-DD_filtered.csv`** when any hub filter is non-default; **`staff-roster-YYYY-MM-DD.csv`** when all filters are default. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T01-19-28-362Z-track-d-d80-staff-roster-csv-hub-scope.json` (`npm run segment:gates -- --segment "track-d-d80-staff-roster-csv-hub-scope" --ui`)

**Mission alignment:** **pass** — roster exports align with on-screen filters without broadening PHI columns or changing RLS.

---

**D81 (2026-04-10):** **Module 11 — Certifications** ([11-staff-management.md](./11-staff-management.md)) — **certifications CSV hub filter scope**.

**Slice:** **`/admin/certifications`** — **Download certifications CSV** exports **`staff_certifications`** rows whose ids match the **filtered hub list** (search, timeline, record status); **`staff_display_name`** joined as in D30; order follows the hub list. Filename **`staff-certifications-YYYY-MM-DD_filtered.csv`** when any hub filter is non-default; **`staff-certifications-YYYY-MM-DD.csv`** when all filters are default. **No** migration.

**Gate artifact:** `test-results/agent-gates/2026-04-10T01-22-26-071Z-track-d-d81-certifications-csv-hub-scope.json` (`npm run segment:gates -- --segment "track-d-d81-certifications-csv-hub-scope" --ui`)

**Mission alignment:** **pass** — credential exports align with on-screen filters without changing certification schema or RLS.

---

## Track D — plan (remaining)

**Segments D1–D10:** Closed in repo with gate artifacts above. This completes the **Phase 6 Core visibility / workflow** slices we prioritized for COL (transport, training, dietary, referrals, reputation), plus **D10** org mileage rate.

**Not in scope for D1–D10 (deferrals + Enhanced — pick with owner priority):**

| Module | Backlog |
|--------|---------|
| **12** | ~~Storage certificate PDF uploads~~ (migration `115` + training hub); ~~org-wide hub list~~ (D20); ~~demonstrations **CSV**~~ (D21); ~~`training_programs` + `staff_training_completions` hub + CSV~~ (D38); ~~**log completion** form~~ (D39); ~~completion **PDF** + `117` storage RLS~~ (D40); ~~**inservice** session + attendee DDL~~ (D41 / `118`); ~~inservice **hub** + CSV + **new session** form~~ (D42); ~~attendee→**`staff_training_completions`** (catalog program on save)~~ (D43); Baya/API, automated assignment, scheduled `training_compliance_snapshots` |
| **13** | ~~Mileage → `payroll_export_lines`~~ (D17); ~~generic **CSV** download on batch~~ (D18); ~~**batches list CSV** on hub~~ (D26); ~~**hub batch status filter + batches CSV**~~ (D73); ~~**hub batch search** (client-side)~~ (D74); ~~approved **`time_records`** → lines~~ (D58); ~~**flat** CSV (hours/miles columns)~~ (D59); ~~**vendor handoff** CSV (period + USD)~~ (D64); ~~**hours split** CSV (REG/OT/total)~~ (D69); ADP/Gusto **proprietary** column templates |
| **14** | ~~Read-only diet + med panel~~ (D13); ~~**diet orders CSV** on hub~~ (D23); ~~**hub status filter + CSV scope**~~ (D77); ~~read-only **liquid vs thickened-fluid** advisory on clinical review~~ (D50); ~~read-only **solid oral vs texture-modified food** (IDDSI 3–6)~~ (D51–D52); ~~hint callouts show IDDSI food/fluid labels~~ (D53); full Edge med–texture automation (pending clinical rules); meal production; vendor API; full menu cycle |
| **15** | ~~Week calendar + mileage approval queue~~ (D14, D15); ~~**transport requests CSV** on hub~~ (D24); ~~**hub status filter + CSV scope**~~ (D76); ~~**mileage logs CSV** on approvals~~ (D25); ~~**mileage CSV pending/approved scope**~~ (D78); ~~full month grid~~ (D56); ~~calendar **`.ics` export**~~ (D57); ~~request detail **Google + Outlook** one-way compose links~~ (D61, D62); ~~request detail **single-trip `.ics`**~~ (D63); ~~calendar **`?date=`** deep link + request **View on calendar**~~ (D66); external calendar **live sync** |
| **22** | ~~Minimal **MSH** queue processor~~ (D12); ~~manual **Draft lead** from HL7~~ (D16); ~~**HL7 queue CSV**~~ (D22); ~~**pipeline leads CSV** on hub~~ (D27); ~~**pipeline status filter + CSV**~~ (D70); ~~**pipeline search** (client-side)~~ (D72); ~~**Copy raw** on inbound queue~~ (D65); ~~**status filter** on inbound queue~~ (D67); ~~**CSV export respects status filter**~~ (D68); ~~**queue search** (client-side)~~ (D71); MLLP, full ADT parse, auto-**`referral_leads`** |
| **23** | ~~**Replies CSV** export on hub~~ (D19); ~~**replies CSV** **status** scope~~ (D75); ~~**accounts CSV** on hub~~ (D28); ~~Google OAuth **connect** + **`119`** token table~~ (D44); ~~**manual** Google review import~~ (D45); ~~**cron** Google review import~~ (D46); ~~**Yelp Fusion** manual import~~ (D47); ~~**Google** reply post~~ (D48); ~~**Yelp** reply post (Partner API)~~ (D49) |
| **11** | ~~**Staff roster CSV** on `/admin/staff`~~ (D29); ~~**staff roster CSV hub filter scope**~~ (D80); ~~**Certifications CSV** on `/admin/certifications`~~ (D30); ~~**certifications CSV hub filter scope**~~ (D81); ~~**Time records CSV** on `/admin/time-records`~~ (D31); ~~**time records CSV approval scope**~~ (D79); ~~**Staffing snapshots CSV** on `/admin/staffing`~~ (D32); ~~**Schedule weeks CSV** on `/admin/schedules`~~ (D33); ~~**Schedule week detail + shift assignments CSV**~~ (D35); ~~**Shift swap requests hub + CSV**~~ (D36); ~~**Shift swap approve/deny**~~ (D37); ~~**Bulk approve** pending time punches~~ (D60); full scheduling builder UX depth |

**Authoritative README narrative:** [README.md](./README.md) — section **Track D — Phase 6 completion pass**.

**Next segment:** Record as **D82+** in this file when a new bounded slice ships; use migration **`120+`** only when DDL is required ([README.md](./README.md) next free migration).

**Prioritized Enhanced plan (D11+ options, order, checklists):** [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./TRACK-D-ENHANCED-BACKLOG-PLAN.md).
