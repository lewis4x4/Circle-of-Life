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

**Deferred:** Payroll export approval workflow, org-level mileage rate setting, calendar view.
