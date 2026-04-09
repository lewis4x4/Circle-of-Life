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

## Track D — plan (remaining)

**Segments D1–D10:** Closed in repo with gate artifacts above. This completes the **Phase 6 Core visibility / workflow** slices we prioritized for COL (transport, training, dietary, referrals, reputation), plus **D10** org mileage rate.

**Not in scope for D1–D10 (deferrals + Enhanced — pick with owner priority):**

| Module | Backlog |
|--------|---------|
| **12** | ~~Storage certificate PDF uploads~~ (migration `115` + training hub); ~~org-wide hub list~~ (D20); ~~demonstrations **CSV**~~ (D21); ~~`training_programs` + `staff_training_completions` hub + CSV~~ (D38); ~~**log completion** form~~ (D39); ~~completion **PDF** + `117` storage RLS~~ (D40); ~~**inservice** session + attendee DDL~~ (D41 / `118`); ~~inservice **hub** + CSV + **new session** form~~ (D42); ~~attendee→**`staff_training_completions`** (catalog program on save)~~ (D43); Baya/API, automated assignment, scheduled `training_compliance_snapshots` |
| **13** | ~~Mileage → `payroll_export_lines`~~ (D17); ~~generic **CSV** download on batch~~ (D18); ~~**batches list CSV** on hub~~ (D26); vendor-specific serializers, time-record worker |
| **14** | ~~Read-only diet + med panel~~ (D13); ~~**diet orders CSV** on hub~~ (D23); ~~read-only **liquid vs thickened-fluid** advisory on clinical review~~ (D50); ~~read-only **solid oral vs pureed food** advisory~~ (D51); full Edge med–texture automation (pending clinical rules); meal production; vendor API; full menu cycle |
| **15** | ~~Week calendar + mileage approval queue~~ (D14, D15); ~~**transport requests CSV** on hub~~ (D24); ~~**mileage logs CSV** on approvals~~ (D25); full month grid, external calendar sync |
| **22** | ~~Minimal **MSH** queue processor~~ (D12); ~~manual **Draft lead** from HL7~~ (D16); ~~**HL7 queue CSV**~~ (D22); ~~**pipeline leads CSV** on hub~~ (D27); MLLP, full ADT parse, auto-**`referral_leads`** |
| **23** | ~~**Replies CSV** export on hub~~ (D19); ~~**accounts CSV** on hub~~ (D28); ~~Google OAuth **connect** + **`119`** token table~~ (D44); ~~**manual** Google review import~~ (D45); ~~**cron** Google review import~~ (D46); ~~**Yelp Fusion** manual import~~ (D47); ~~**Google** reply post~~ (D48); ~~**Yelp** reply post (Partner API)~~ (D49) |
| **11** | ~~**Staff roster CSV** on `/admin/staff`~~ (D29); ~~**Certifications CSV** on `/admin/certifications`~~ (D30); ~~**Time records CSV** on `/admin/time-records`~~ (D31); ~~**Staffing snapshots CSV** on `/admin/staffing`~~ (D32); ~~**Schedule weeks CSV** on `/admin/schedules`~~ (D33); ~~**Schedule week detail + shift assignments CSV**~~ (D35); ~~**Shift swap requests hub + CSV**~~ (D36); ~~**Shift swap approve/deny**~~ (D37); full scheduling builder UX depth, bulk time approve depth |

**Authoritative README narrative:** [README.md](./README.md) — section **Track D — Phase 6 completion pass**.

**Next segment:** Record as **D52+** in this file when a new bounded slice ships; use migration **`120+`** only when DDL is required ([README.md](./README.md) next free migration).

**Prioritized Enhanced plan (D11+ options, order, checklists):** [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./TRACK-D-ENHANCED-BACKLOG-PLAN.md).
