# Track D — Enhanced backlog plan (after D1–D9)

**Purpose:** Choose **one bounded segment at a time** (D11+), align to module specs, implement, and record PASS gates. Authoritative shipped history: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). README summary: [README.md § Track D](./README.md). **D10** (org mileage rate) is **shipped** (migration `114`, gate artifact in PASS doc).

**Rules**

- No multi-module megabranches; each segment has one **primary module** and explicit **out-of-scope** bullets.
- **Spec first:** Add or extend a short **COL Alignment / Enhanced slice** subsection in the relevant `docs/specs/*.md` before coding when behavior is new.
- **DDL:** Use migration **`119+`** only when a column/table is required; otherwise prefer existing columns (`organizations.settings` JSON, existing queue tables).
- **Verify:** `npm run segment:gates -- --segment "<id>" --ui` when routes/UI change.

---

## 1. Backlog options (comparison)

| Module | Backlog item | Effort | Risk | Dependencies | Notes |
|--------|----------------|--------|------|--------------|--------|
| **15** | ~~**Org-level mileage reimbursement rate**~~ | — | — | — | **Shipped D10** — table `organization_transport_settings` (`114`), `/admin/transportation/settings`, `getOrganizationMileageRateCents`; fallback in `mileage-defaults.ts`. |
| **13** | ~~**Payroll batch mileage lines**~~ (`payroll_export_lines` from approved `mileage_logs`) | — | — | — | **Shipped D17** — `/admin/payroll/[id]` import; idempotency `mileage:{log_id}`. |
| **15** | ~~Payroll mileage **approval** UX (`mileage_logs.approved_at` flow)~~ | — | — | — | **Shipped D15** — `/admin/transportation/mileage-approvals`. |
| **15** | ~~**Calendar** view for transport requests~~ | — | — | — | **Shipped D14** — `/admin/transportation/calendar`. |
| **22** | ~~**HL7 processor** (minimal **MSH** parse → **`processed`** / **`failed`**)~~ | — | — | — | **Shipped D12** — Edge **`process-referral-hl7-inbound`**; no auto-**`referral_leads`**. |
| **22** | MLLP listener / hospital feed | High | High | Infra, VPN, partners | Not a single segment; defer. |
| **23** | ~~**Google OAuth connect** (Business Profile scope; server token store `119`)~~ | — | — | — | **Shipped D44** — `/admin/reputation/integrations` + OAuth routes. |
| **23** | ~~**Manual Google review import** (owner-triggered; drafts in `reputation_replies`)~~ | — | — | — | **Shipped D45** — `POST /api/reputation/sync/google` + integrations button. |
| **23** | ~~**Cron Google review import** (`x-cron-secret`; all orgs or one)~~ | — | — | — | **Shipped D46** — `POST /api/cron/reputation/google-reviews`. |
| **23** | ~~**Yelp Fusion manual import** (API key; up to 3 excerpts / business)~~ | — | — | — | **Shipped D47** — `POST /api/reputation/sync/yelp`. |
| **23** | ~~**Post reply to Google** (`updateReply` from draft)~~ | — | — | — | **Shipped D48** — `POST /api/reputation/replies/[id]/post-google` + hub. |
| **23** | ~~**Post reply to Yelp** (Partner public comment)~~ | — | — | — | **Shipped D49** — `POST /api/reputation/replies/[id]/post-yelp` + hub; **`yelp-partner-reviews.ts`**. |
| **12** | ~~**Certificate PDF upload**~~ (`staff_training_completions` + `competency-demonstrations` paths) | — | — | — | **D40** — `117` + log form + hub; **D11** — demonstrations. |
| **14** | **Automated med–texture cross-check** (e.g. Edge job flagging solid vs thickened fluid) | Medium–high | **High (clinical)** | Med orders, pharmacist rules | **Partial:** **D50**–**D52** read-only hints on **`/admin/dietary/clinical-review`** (`med-fluid-diet-hints.ts`: liquid vs thickened fluid; solid oral vs texture-modified food IDDSI 3–6). **Full Edge automation** still needs **clinical / pharmacy** sign-off. |
| **14** | ~~**Read-only “review” panel** (diet + resident meds)~~ | — | — | — | **Shipped D13** — `/admin/dietary/clinical-review`. |

---

## 2. ~~Recommended next segment — D10~~ **DONE (2026-04-09)**

**Module 15 — Transportation** — **organization mileage reimbursement rate** shipped as migration **`114`** (`organization_transport_settings`), admin route **`/admin/transportation/settings`**, integration on transport request completion. Gate: `test-results/agent-gates/2026-04-09T02-13-30-573Z-track-d-phase6-d10-org-mileage-rate.json`.

**~~D17 (2026-04-09)~~** **DONE — Module 13:** **`/admin/payroll/[id]`** imports approved mileage into **`payroll_export_lines`**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D12 (2026-04-09)~~** **DONE — Module 22:** Edge **`process-referral-hl7-inbound`** (minimal MSH parse for **`referral_hl7_inbound`**). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D13–D16 (2026-04-09)~~** **DONE:** Module **14** clinical review route; Module **15** calendar + mileage approvals; Module **22** HL7 manual **Draft lead**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D18 (2026-04-09)~~** **DONE — Module 13:** **`/admin/payroll/[id]`** **Download CSV** for **`payroll_export_lines`**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D19 (2026-04-09)~~** **DONE — Module 23:** **`/admin/reputation`** **Download replies CSV**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D20 (2026-04-09)~~** **DONE — Module 12:** **`/admin/training`** **All facilities** — last 50 **`competency_demonstrations`** (RLS-scoped) + facility labels; not **`training_compliance_snapshots`**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D21 (2026-04-09)~~** **DONE — Module 12:** **`/admin/training`** **Download demonstrations CSV** (up to 500 rows, RLS-scoped). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D22 (2026-04-09)~~** **DONE — Module 22:** **`/admin/referrals/hl7-inbound`** **Download queue CSV**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D23 (2026-04-09)~~** **DONE — Module 14:** **`/admin/dietary`** **Download diet orders CSV**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D24 (2026-04-09)~~** **DONE — Module 15:** **`/admin/transportation`** **Download transport CSV** ( **`resident_transport_requests`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D25 (2026-04-09)~~** **DONE — Module 15:** **`/admin/transportation/mileage-approvals`** **Download mileage CSV** ( **`mileage_logs`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D26 (2026-04-09)~~** **DONE — Module 13:** **`/admin/payroll`** **Download batches CSV** ( **`payroll_export_batches`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D27 (2026-04-09)~~** **DONE — Module 22:** **`/admin/referrals`** **Download leads CSV** ( **`referral_leads`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D28 (2026-04-09)~~** **DONE — Module 23:** **`/admin/reputation`** **Download accounts CSV** ( **`reputation_accounts`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D29 (2026-04-09)~~** **DONE — Module 11:** **`/admin/staff`** **Download roster CSV** ( **`staff`**, excludes **`ssn_last_four`** / **`date_of_birth`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D30 (2026-04-09)~~** **DONE — Module 11:** **`/admin/certifications`** **Download certifications CSV** ( **`staff_certifications`** + **`staff_display_name`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D31 (2026-04-09)~~** **DONE — Module 11:** **`/admin/time-records`** **Download time records CSV** ( **`time_records`** + **`staff_display_name`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D32 (2026-04-09)~~** **DONE — Module 11:** **`/admin/staffing`** **Download staffing ratio snapshots CSV** ( **`staffing_ratio_snapshots`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D33 (2026-04-09)~~** **DONE — Module 11:** **`/admin/schedules`** **Download schedule weeks CSV** ( **`schedules`** ). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D34 (2026-04-09)~~** **DONE — Admin CSV helpers:** **`src/lib/csv-export`** shared by **all** hub CSV pages (no duplicate `csvEscapeCell` / `triggerCsvDownload`). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D35 (2026-04-09)~~** **DONE — Module 11:** **`/admin/schedules/[id]`** read-only **`shift_assignments`** + CSV; **`/admin/schedules/new`** → detail. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D36 (2026-04-09)~~** **DONE — Module 11:** **`/admin/shift-swaps`** read-only **`shift_swap_requests`** + CSV. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D37 (2026-04-09)~~** **DONE — Module 11:** **`/admin/shift-swaps`** **approve/deny** (pending). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D38 (2026-04-09)~~** **DONE — Module 12:** Migration **`116`** — **`training_programs`** + **`staff_training_completions`**; **`/admin/training`** completions list + CSV. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D39 (2026-04-09)~~** **DONE — Module 12:** **`/admin/training/completions/new`** — log **`staff_training_completions`**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D40 (2026-04-09)~~** **DONE — Module 12:** **`117`** storage RLS + optional completion **PDF** on log form + hub column. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D41 (2026-04-10)~~** **DONE — Module 12:** Migration **`118`** — **`inservice_log_sessions`** + **`inservice_log_attendees`** (RLS, audit). Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~D42 (2026-04-10)~~** **DONE — Module 12:** **`/admin/training`** in-service list + CSV; **`/admin/training/inservice/new`**. Gate: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D43~~** **DONE (2026-04-10)** — Module **12:** **`/admin/training/inservice/new`** batch **`staff_training_completions`** when catalog program selected. Gate: `test-results/agent-gates/2026-04-09T20-39-46-632Z-track-d-d43-inservice-completion-automation.json` — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D44~~** **DONE (2026-04-10)** — Module **23:** Google OAuth **connect** + migration **`119`** — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D45~~** **DONE (2026-04-10)** — Module **23:** **Manual Google review import** — `POST /api/reputation/sync/google`, integrations **Import** button — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D46~~** **DONE (2026-04-10)** — Module **23:** **Cron Google review import** — `POST /api/cron/reputation/google-reviews` — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D47~~** **DONE (2026-04-10)** — Module **23:** **Yelp Fusion** manual import — `POST /api/reputation/sync/yelp` — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D48~~** **DONE (2026-04-10)** — Module **23:** **Google post reply** — `POST /api/reputation/replies/[id]/post-google` — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D49~~** **DONE (2026-04-10)** — Module **23:** **Yelp post reply** — `POST /api/reputation/replies/[id]/post-yelp` — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D50~~** **DONE (2026-04-10)** — Module **14:** **Clinical review advisory** — liquid-form medication hint vs thickened-fluid diet — `src/lib/dietary/med-fluid-diet-hints.ts` + hub — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D51~~** **DONE (2026-04-10)** — Module **14:** **Solid oral form vs pureed/liquidized diet** hint — same hub + `med-fluid-diet-hints.ts` — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**~~Recommended next segment — D52~~** **DONE (2026-04-10)** — Module **14:** **Expand solid-oral hint** to minced moist + soft bite–sized — **`solidOralFormVsTextureModifiedFoodHint`** — [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**Recommended next segment — D53+ (owner priority):** **14** full Edge/cron cross-check after clinical rules sign-off; other §1 deferrals — one bounded slice at a time.

---

## 3. Second and third segments (suggested order)

| Order | Id | Module | Slice (bounded) |
|-------|-----|--------|------------------|
| 2 | **D11** | **12** | ~~Storage upload (Baya PDF) + `competency-certificates` bucket~~ **DONE** — migration **`115`** + training hub; see [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). |
| 3 | **D12** | **22** | ~~Edge Function **`process-referral-hl7-inbound`** (MSH minimal; no auto-leads)~~ **DONE** — see [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). |
| 4 | **D13** | **14** | ~~**Read-only** clinical panel~~ **DONE** — `/admin/dietary/clinical-review`. |
| 5 | **D14** | **15** | ~~Week strip **calendar**~~ **DONE** — `/admin/transportation/calendar`. |
| 6 | **D15** | **15** | ~~**Mileage approval** queue~~ **DONE** — `/admin/transportation/mileage-approvals`. |
| 7 | **D16** | **22** | ~~Manual **Draft lead** from processed HL7~~ **DONE** — `/admin/referrals/hl7-inbound`. |
| 8 | **D17** | **13** | ~~**Mileage → payroll lines** on draft batch~~ **DONE** — `/admin/payroll/[id]`. |
| 9 | **D18** | **13** | ~~**CSV** download of batch lines~~ **DONE** — `/admin/payroll/[id]`. |
| 10 | **D19** | **23** | ~~**Replies CSV** on hub~~ **DONE** — `/admin/reputation`. |
| 11 | **D20** | **12** | ~~**All facilities** training hub (RLS org-wide list + facility labels)~~ **DONE** — `/admin/training`. |
| 12 | **D21** | **12** | ~~**Demonstrations CSV**~~ **DONE** — `/admin/training`. |
| 13 | **D22** | **22** | ~~**HL7 queue CSV**~~ **DONE** — `/admin/referrals/hl7-inbound`. |
| 14 | **D23** | **14** | ~~**Diet orders CSV**~~ **DONE** — `/admin/dietary`. |
| 15 | **D24** | **15** | ~~**Transport requests CSV**~~ **DONE** — `/admin/transportation`. |
| 16 | **D25** | **15** | ~~**Mileage logs CSV**~~ **DONE** — `/admin/transportation/mileage-approvals`. |
| 17 | **D26** | **13** | ~~**Payroll batches list CSV**~~ **DONE** — `/admin/payroll`. |
| 18 | **D27** | **22** | ~~**Pipeline leads CSV**~~ **DONE** — `/admin/referrals`. |
| 19 | **D28** | **23** | ~~**Reputation accounts CSV**~~ **DONE** — `/admin/reputation`. |
| 20 | **D29** | **11** | ~~**Staff roster CSV**~~ **DONE** — `/admin/staff`. |
| 21 | **D30** | **11** | ~~**Certifications matrix CSV**~~ **DONE** — `/admin/certifications`. |
| 22 | **D31** | **11** | ~~**Time records CSV**~~ **DONE** — `/admin/time-records`. |
| 23 | **D32** | **11** | ~~**Staffing ratio snapshots CSV**~~ **DONE** — `/admin/staffing`. |
| 24 | **D33** | **11** | ~~**Schedule weeks CSV**~~ **DONE** — `/admin/schedules`. |
| 25 | **D34** | **—** | ~~**Shared `csv-export` helpers**~~ **DONE** — all admin CSV hubs. |
| 26 | **D35** | **11** | ~~**`/admin/schedules/[id]`** week detail + **shift assignments CSV**~~ **DONE** — see [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). |
| 27 | **D36** | **11** | ~~**`/admin/shift-swaps`** queue + **CSV**~~ **DONE** — see [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). |
| 28 | **D37** | **11** | ~~**`/admin/shift-swaps`** approve/deny~~ **DONE** — see [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). |

Defer **23 OAuth**, **22 MLLP**, **14 full rule engine** until product/security review.

---

## 4. Blockers / assumptions

- **Track A** can remain skipped for **engineering** progress; PHI production still needs owner attestation separately.
- **COL clinical sign-off** required before **automated** dietary or HL7 **lead creation**.
- **Next migration number** in README: **`120`** — use for the next DDL (D44 shipped **`119`**).

---

## 5. Recording progress

After each segment: add **D11+** block to [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md) with gate artifact path and deferrals, matching D1–D10 style.
