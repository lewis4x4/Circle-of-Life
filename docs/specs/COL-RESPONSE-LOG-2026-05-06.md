# COL Response Log — Haven Launch Recap (2026-05-06)

**Source:** Annotations from Jessica Murphy and team on the 2026-05-05 recap email.
**Status of this doc:** Authoritative record of decisions, confirmations, and remaining open items as of 2026-05-06.

---

## 1. Resident Rates (M6)

**Brian's recap:** Rebuild rate model — drop tiers, add medicaid_providers table, posted rate cap for Medicaid residents, Medicaid provider amount cascades by facility.

**COL response:**
- Standard posted rates set: **Private Room $5,550.00 / month**, **Companion Room $4,000.00 / month**.
- Confirmed: actual rates are individually negotiated under those posted ceilings.

**Schema impact:**
- Seed `rooms.posted_room_rate_cents` with 555000 (private) and 400000 (companion) for Homewood.
- Same posted rates apply across all five facilities unless Jessica overrides per facility.

**Status:** ✅ ANSWERED — proceed with rebuild and seed values.

---

## 2. Resident Status Model (M5)

**Brian's recap:** Four-state enum — active, bed_hold_hospital, bed_hold_vacation, discharged. Drives census + admit/discharge log.

**COL response:**
- Confirmed. Purpose explicitly framed as **billable-day tracking**.

**Schema impact:**
- `resident_status_history` rows must be the source of truth for billable days. Add `is_billable_day BOOLEAN` derivation rule:
  - active → billable
  - bed_hold_hospital → billable per Medicaid contract (verify per-provider — flag for Jessica)
  - bed_hold_vacation → billable per private-pay contract (typically yes, verify)
  - discharged → not billable
- Census report must produce billable-day totals per resident per month, separate from physical-presence days.

**Status:** ✅ ANSWERED — billing-day rules per status need confirmation per provider/contract.

---

## 3. Quickmar Daily Export

**Brian's recap:** Phase 1 keep Quickmar live, daily export to Drive folder, Haven parses on file drop, alert if missed.

**COL response:**
- Training: COL will train staff on the daily export.
- Alert distribution if export missed: **Administrator, Assistant, Michelle, Jessica.**

**Schema impact:**
- `quickmar_imports` alert config: stakeholder list = [administrator_user_id, assistant_user_id, michelle_user_id, jessica_user_id] for the affected facility.
- Build `notification_recipients` config table keyed by facility + event_type so this list is reusable for activities, in-service compliance, etc. (same four roles repeat across multiple alerts).

**Status:** ✅ ANSWERED.

---

## 4. Activities Module

**Brian's recap:** Replace Donny/Dieter with Activities module — catalog, schedule, attendance, provider tracking, monthly calendar generator.

**COL response:**
- Track resident attendance per activity.
- Track who conducted the activity: facility staff, Home Health, Hospice, or others.
- After completion, facility staff records **start time + initials** to confirm execution.
- Alert if **two required daily activities are not completed** — sent to Administrator, Assistant, Michelle, Jessica.

**Schema impact:**
- Add to `scheduled_activities`: `actual_start_time TIMESTAMPTZ`, `confirmed_by_initials TEXT`, `confirmed_by_user_id UUID`.
- Daily check Edge Function: count completed activities per facility per day; if < 2 by end-of-day cutoff (define per-facility), fire alert to standard recipient list.

**Status:** ✅ ANSWERED.

---

## 5. Rounds Module

**Brian's recap:** Haven owns rounds, disable Quickmar rounds. Per-shift per-facility cadence, two-hour overrides, tablet UI with Location/Activity dropdowns, speech-to-text option.

**COL response — cadence by facility:**

| Facility | Day Shift (6a–6p) | Night Shift (6p–6a) |
|---|---|---|
| Oakridge | 6a, 10a, 2p, 5:30p | 6p, 10p, 5:30a |
| Rising Oaks | 6a, 10a, 2p, 5:30p | 6p, 10p, 5:30a |
| Grande Cypress | 6a, 10a, 2p, 5:30p | 6p, 10p, 5:30a |
| Homewood | 6a, 10a, 2p, 5:30p | Every 2 hours |
| Plantation | TBD — Jessica to provide | TBD — Jessica to provide |

**COL response — operational rules:**
- 30-minute grace period on all scheduled times (residents can't all be checked simultaneously).
- Resident list divided across staff on duty in same split as the medication cart (e.g., 2 med techs = each owns half the building; 3 staff = thirds).
- 5:30 PM check is the final observation before day-shift handoff at 6 PM.
- Night shift checks intentionally minimal — residents shouldn't be awakened.

**COL response — vocabulary:**

*Location values (all facilities):*
- common area
- dining room
- resident room
- front porch
- back porch
- OOF (Out of Facility) — sub-classifications: personal errand, medical appointment, family/friends, hospitalization, day treatment

*Activity values:*
- participating in facility activity
- socializing with others
- watching TV
- resting in bed
- sleeping
- individual activity (reading, puzzles, etc.)

**COL constraint:** Med-pass already produces notes 4× daily. Jessica wants to **avoid duplicate documentation** — if med-pass notes can be ingested via Quickmar export, Haven shouldn't require an additional 4 round notes per shift. Suggested approach: rounds capture Location + Activity (dropdown only, fast tap), and Quickmar export covers the narrative notes.

**Schema impact:**
- `round_shift_configs` seed data ready for 4 of 5 facilities.
- `resident_round_overrides`: add support for staff-assignment subdivision (link cart_assignment_group to round subset).
- Add `cart_assignments` table or denormalized field: which staff own which residents per shift.
- Round observations: dropdown-only by default, free-text/speech-to-text optional. Don't fail an observation that has only Location + Activity.
- Build `cart_assignment` config so resident-list division is administrator-configurable per shift.
- Reconsider 4-notes-per-shift requirement — may be reduced if Quickmar import covers narrative.

**Status:** ✅ MOSTLY ANSWERED — Plantation cadence still pending from Jessica. Med-pass-vs-rounds duplicate documentation question needs design decision.

---

## 6. Family Portal

**Brian's recap:** One-way (Haven → family). Activities, billing, admin notes. No reply.

**COL response:**
- Confirmed admin/assistant note example: *"I called earlier — please return my call when you can."*
- Purpose framed as documentation that family was notified, while preventing replies.

**Schema impact:**
- `family_notes` table needs `delivery_method` enum (`portal_only`, `portal_and_email`, `portal_and_sms`) so admins can mark whether they also called/emailed/texted.
- Add `family_acknowledged_at TIMESTAMPTZ` for read-receipt-style tracking when family views the portal.

**Status:** ✅ ANSWERED.

---

## 7. Maintenance + Compliance

**Brian's recap:** Two surfaces — reactive work orders + scheduled inspections.

**COL response:**
- Annual items to track: inspections, **menus**, permits, **6 fire drills/year**, **2 elopement drills/year**.
- Maintenance side: **Terell** is the contact to define which tasks to track (AC filter changes, etc.).

**Schema impact:**
- Drill spec: COL is doing **6 fire / 2 elopement** annually — earlier session note said 4 elopement. Updating to 2 to match COL's response.
- Add `menus` to `compliance_inspection_schedule` — annual cadence, owner = facility administrator.
- Add **permits** generic category.
- Maintenance task catalog seeded by Terell — schedule a separate Terell intake session.

**Status:** ✅ ANSWERED — Terell intake session needs scheduling.

---

## 8. Dietary / Meal Logging

**Brian's recap:** Per-meal status (ate/refused/out_of_facility), facility-level snack timestamp.

**COL response:**
- Confirmed for breakfast/lunch/dinner.
- Snack logging: **facility reminder + who passed snack + time**.
- Snack contents (what was passed) — COL says *"could get complicated, hold off."*

**Schema impact:**
- `snack_logs.passed_by_user_id UUID NOT NULL` — required.
- `snack_logs.snack_description TEXT NULL` — defer field; not collected Phase 1.
- Reminder: per-facility config for daily snack window; alert if no snack log by cutoff time.

**Status:** ✅ ANSWERED.

---

## 9. DocuSign / Contracts

**Brian's recap:** Move to DocuSign, FL Stat. 668 confirmed, need attorney verification of arbitration clause survival.

**COL response:**
- Jessica has emailed Donna. Awaiting response.

**Status:** 🟡 PENDING — Donna's reply.

---

## 10. ADP / Employee Lifecycle (M4)

**Brian's recap:** ADP API scoping starts now.

**COL response — full employee module spec:**

**Application stage:**
- Application form (online intake)
- Background check
- References
- Date of hire

**Pre-service orientation (BEFORE working on floor):**
- Resident Rights
- Infection Control
- Universal Precautions

**Within 30 days of hire:**
- Communicable disease
- TB test
- CPR & First Aid
- All required in-services

**Confirmation:**
- Employee section to confirm completion of all in-services and training.
- Medication technicians: separate confirmation that they (a) received medication training, (b) understand medication assistance regulations, (c) feel adequately prepared.

**Alerts:**
- Non-compliant employees → alert Administrator, Assistant, Michelle, Jessica.

**Schema impact:**
- `employee_compliance_items` table: item_type, required_by_phase (pre_service / within_30_days), completed_at, confirmed_by_employee, attestation_text, attestation_signed_at.
- `employee_role_specific_attestations` for med tech (and any future role-specific) confirmations.
- Compliance alert engine reuses standard recipient list (Administrator, Assistant, Michelle, Jessica).
- Permanent out-of-compliance flag stays as captured in 2026-05-05 session.

**Status:** ✅ ANSWERED.

---

## 11. QuickBooks Integration

**Brian's recap:** Cloud migration required either way; Path A (native) vs Path B (API) pending Milton.

**COL response (Jessica's preference):**
- **Path B preferred** — integrate QuickBooks into Haven so invoices, payments, statements flow seamlessly.
- Auto-generate aging report for outstanding/collected funds.

**Schema impact:**
- Build `qb_sync` integration module: pull invoices, payments, statements via QB Online API.
- Aging report generator: bucketed (current, 30, 60, 90+) per resident per facility.
- Still requires Milton's call on QB Desktop → QB Online migration timing.

**Status:** 🟡 STAFF PREFERENCE NOTED — Milton's final call still needed.

---

## 12. Encrypted Email Provider

**Status:** 🟡 PENDING — Jessica to provide vendor name.

---

## 13. Cameras / Rising Oaks Office

**Brian's recap:** Phase 2 for resident-profile camera view; immediate Rising Oaks office buildout pre-sheet-rock wiring.

**COL response:**
- **Central Office is separate from facilities.** Security system selection still TBD.
- If a security system is added, Haven integration is "advantageous" but a standalone app would also work.
- Future: integrate all facility camera systems into Haven for centralized access.

**Status:** 🟡 ANSWERED CONDITIONALLY — Brian still needs to do site visit pre-sheet-rock; security system selection is a separate decision (not blocking Haven build).

---

## 14. Permissions / Role Presets

**Brian's recap:** Role presets — Resident Aide, Administrator, Assistant Administrator, Corporate, Maintenance, Owner. Per-user override.

**COL response — full role list:**

Facility staff:
- Administrator
- Assistant
- Cook
- Medication Technician
- Resident Aide
- Housekeeping Aide

**Operational note:** COL operates as **universal workers** by default (most staff cross-trained), but the model must support role-restricted hires (e.g., cook who never administers meds).

**Schema impact:**
- Add to `role_presets`: Cook, Medication Technician, Housekeeping Aide.
- Add `is_universal_worker BOOLEAN` flag on user record — when true, user inherits all presets the admin has assigned them; when false, user is locked to single role preset.
- Med Tech preset must include access to medication module + attestation requirements (link to Section 10 attestation flow).

**Status:** ✅ ANSWERED.

---

## 15. Forms Inventory by Facility

**COL response:**

| Facility | 1823 | Service Plan | Community Support Plan |
|---|---|---|---|
| Oakridge | ✅ | ❌ | ❌ |
| Rising Oaks | ✅ | ❌ | ❌ |
| Grande Cypress | ✅ | ❌ | ❌ |
| Homewood | ✅ | ❌ | ❌ |
| Plantation | ✅ | ✅ | ✅ |

**Status:** ✅ ANSWERED.

---

## 16. Document Dump

**Status:** 🟡 PENDING — Jessica + William to upload Homewood documents (face sheets, admit/discharge log, census, AR sheet, dietary logs, fire drill log, Medicaid pending tracker, contract scans) to shared Drive folder.

---

## Summary — What's Open

| # | Item | Owner | Blocks |
|---|---|---|---|
| 1 | Plantation rounds cadence (day + night) | Jessica | Rounds module ship for Plantation |
| 2 | Donna's response on DocuSign arbitration | Jessica/Donna | DocuSign launch |
| 3 | Encrypted email provider name | Jessica | Medicaid pipeline outbound emails |
| 4 | Homewood document dump | Jessica + William | 90% data load milestone |
| 5 | Milton's QB Desktop → Online migration sign-off | Milton | QB integration build |
| 6 | Terell intake session for maintenance task catalog | Brian + Terell | Maintenance module seed |
| 7 | Rising Oaks office site visit pre-sheet-rock | Brian | Access control wiring |
| 8 | Billable-day rules per Medicaid provider (bed-hold contracts) | Jessica | Census report billing math |
| 9 | Rounds-vs-Quickmar narrative-note duplication design | Brian | Final rounds UX |
| 10 | Snack reminder cutoff time per facility | Jessica | Snack-log alert engine |

## Summary — What's Now Closed

- Posted room rates (private $5,550 / companion $4,000)
- Resident status enum (4-state, billable-day-driven)
- Quickmar export alert recipient list
- Activities completion confirmation (start_time + initials)
- Activities daily-completion alert (2 required, alert if not done)
- Rounds cadence for Oakridge / Rising Oaks / Grande Cypress / Homewood
- Rounds Location + Activity vocabulary (universal across facilities)
- Family Portal scope and admin-note example
- Annual compliance items (inspections, menus, permits, 6 fire drills, 2 elopement drills)
- Snack log fields (passed_by + time, no description)
- Employee module full lifecycle spec (application → in-service → med-tech attestation)
- Forms inventory per facility (4× 1823-only, Plantation = all 3)
- Role presets expanded (added Cook, Med Tech, Housekeeping; universal-worker flag)
