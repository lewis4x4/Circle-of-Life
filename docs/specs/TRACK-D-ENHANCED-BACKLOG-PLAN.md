# Track D — Enhanced backlog plan (after D1–D9)

**Purpose:** Choose **one bounded segment at a time** (D11+), align to module specs, implement, and record PASS gates. Authoritative shipped history: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). README summary: [README.md § Track D](./README.md). **D10** (org mileage rate) is **shipped** (migration `114`, gate artifact in PASS doc).

**Rules**

- No multi-module megabranches; each segment has one **primary module** and explicit **out-of-scope** bullets.
- **Spec first:** Add or extend a short **COL Alignment / Enhanced slice** subsection in the relevant `docs/specs/*.md` before coding when behavior is new.
- **DDL:** Use migration **`116+`** only when a column/table is required; otherwise prefer existing columns (`organizations.settings` JSON, existing queue tables).
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
| **23** | **OAuth / platform APIs** (Google, Yelp) | High | High | Developer accounts, ToS | Defer until product owner approves vendors and keys. |
| **12** | **Certificate PDF upload** to Supabase Storage + path on `staff_training_completions` / demonstrations | Medium | Med | Storage bucket RLS, upload UI | Strong COL value (Baya PDFs); no Baya API in first slice. |
| **14** | **Automated med–texture cross-check** (e.g. Edge job flagging solid vs thickened fluid) | Medium–high | **High (clinical)** | Med orders, pharmacist rules | Needs explicit **clinical rules** sign-off in spec before automation. |
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

**Recommended next segment — D31+ (owner priority):** remaining §1 rows (e.g. **23** OAuth/sync, **14** automation after clinical sign-off, **12** certificate storage depth) — one bounded slice at a time.

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

Defer **23 OAuth**, **22 MLLP**, **14 full rule engine** until product/security review.

---

## 4. Blockers / assumptions

- **Track A** can remain skipped for **engineering** progress; PHI production still needs owner attestation separately.
- **COL clinical sign-off** required before **automated** dietary or HL7 **lead creation**.
- **Next migration number** in README: **`116`** — use for the next DDL after D11.

---

## 5. Recording progress

After each segment: add **D11+** block to [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md) with gate artifact path and deferrals, matching D1–D10 style.
