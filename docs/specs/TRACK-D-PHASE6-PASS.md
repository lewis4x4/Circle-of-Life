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

**D17 (2026-04-09):** **Module 13 — Payroll Integration** ([13-payroll-integration.md](./13-payroll-integration.md)) — **approved mileage → export lines**.

**Slice:** **`/admin/payroll/[id]`** — draft batches show **Import mileage into batch**: loads **`mileage_logs`** with **`approved_at` set**, **`payroll_export_id` IS NULL**, **`trip_date`** within batch period; inserts **`payroll_export_lines`** (`line_kind` = `mileage_reimbursement`, idempotency `mileage:{log_id}`) and sets **`mileage_logs.payroll_export_id`**. Hub batches link to detail; payroll hub SYS label corrected to **Module 13**. **No** new DDL.

**Gate artifact:** `test-results/agent-gates/2026-04-09T15-01-34-839Z-track-d-d17-payroll-mileage-lines.json` (`npm run segment:gates -- --segment "track-d-d17-payroll-mileage-lines" --ui --no-chaos`).

**Mission alignment:** **pass** — reimbursement stays tied to approved trips and an explicit batch before external payroll handoff.

---

## Track D — plan (remaining)

**Segments D1–D10:** Closed in repo with gate artifacts above. This completes the **Phase 6 Core visibility / workflow** slices we prioritized for COL (transport, training, dietary, referrals, reputation), plus **D10** org mileage rate.

**Not in scope for D1–D10 (deferrals + Enhanced — pick with owner priority):**

| Module | Backlog |
|--------|---------|
| **12** | Storage certificate uploads, Baya/API, automated assignment, org-wide `training_compliance_snapshots` usage |
| **13** | ~~Mileage → `payroll_export_lines` on draft batch~~ (D17); CSV/vendor serializers, time-record worker |
| **14** | Automated med–texture cross-check vs medications; meal production; vendor API; full menu cycle |
| **15** | Payroll mileage approval workflow, month/week calendar, external calendar sync |
| **22** | ~~Minimal **MSH** queue processor~~ (D12); MLLP, full ADT parse, auto-**`referral_leads`** |
| **23** | External review platform OAuth/sync APIs |

**Authoritative README narrative:** [README.md](./README.md) — section **Track D — Phase 6 completion pass**.

**Next segment:** Record as **D11+** in this file when a new bounded slice ships; use migration **`116+`** only when DDL is required ([README.md](./README.md) next free migration).

**Prioritized Enhanced plan (D11+ options, order, checklists):** [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./TRACK-D-ENHANCED-BACKLOG-PLAN.md).
