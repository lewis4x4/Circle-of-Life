# Track D — Enhanced backlog plan (after D1–D9)

**Purpose:** Choose **one bounded segment at a time** (D11+), align to module specs, implement, and record PASS gates. Authoritative shipped history: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). README summary: [README.md § Track D](./README.md). **D10** (org mileage rate) is **shipped** (migration `114`, gate artifact in PASS doc).

**Rules**

- No multi-module megabranches; each segment has one **primary module** and explicit **out-of-scope** bullets.
- **Spec first:** Add or extend a short **COL Alignment / Enhanced slice** subsection in the relevant `docs/specs/*.md` before coding when behavior is new.
- **DDL:** Use migration **`115+`** only when a column/table is required; otherwise prefer existing columns (`organizations.settings` JSON, existing queue tables).
- **Verify:** `npm run segment:gates -- --segment "<id>" --ui` when routes/UI change.

---

## 1. Backlog options (comparison)

| Module | Backlog item | Effort | Risk | Dependencies | Notes |
|--------|----------------|--------|------|--------------|--------|
| **15** | ~~**Org-level mileage reimbursement rate**~~ | — | — | — | **Shipped D10** — table `organization_transport_settings` (`114`), `/admin/transportation/settings`, `getOrganizationMileageRateCents`; fallback in `mileage-defaults.ts`. |
| **15** | Payroll mileage **approval** UX (`mileage_logs.approved_at` flow) | Medium | Med | Module 13 payroll export may be STUB | Touches finance export boundaries. |
| **15** | **Calendar** view for transport requests | Medium–high | Med | UX + date math | Large surface area; better as its own segment after rate. |
| **22** | **HL7 processor** (parse `referral_hl7_inbound.raw_message`, set status, optional fields) | Medium | Med–high | Edge deploy + secret | Core queue exists; spec non-goal was *full* parser — a **minimal ADT subset** + structured `parse_error` is a valid D10 if scoped. |
| **22** | MLLP listener / hospital feed | High | High | Infra, VPN, partners | Not a single segment; defer. |
| **23** | **OAuth / platform APIs** (Google, Yelp) | High | High | Developer accounts, ToS | Defer until product owner approves vendors and keys. |
| **12** | **Certificate PDF upload** to Supabase Storage + path on `staff_training_completions` / demonstrations | Medium | Med | Storage bucket RLS, upload UI | Strong COL value (Baya PDFs); no Baya API in first slice. |
| **14** | **Automated med–texture cross-check** (e.g. Edge job flagging solid vs thickened fluid) | Medium–high | **High (clinical)** | Med orders, pharmacist rules | Needs explicit **clinical rules** sign-off in spec before automation. |
| **14** | Lighter: **read-only “review” panel** listing resident meds next to diet order (no automation) | Low | Low | Join queries | Could be D10 alternative if automation is blocked. |

---

## 2. ~~Recommended next segment — D10~~ **DONE (2026-04-09)**

**Module 15 — Transportation** — **organization mileage reimbursement rate** shipped as migration **`114`** (`organization_transport_settings`), admin route **`/admin/transportation/settings`**, integration on transport request completion. Gate: `test-results/agent-gates/2026-04-09T02-13-30-573Z-track-d-phase6-d10-org-mileage-rate.json`.

**Recommended next segment — D11 (default):** Module **12** — certificate PDF upload (see §3).

---

## 3. Second and third segments (suggested order)

| Order | Id | Module | Slice (bounded) |
|-------|-----|--------|------------------|
| 2 | **D11** | **12** | Storage upload for one certificate type (Baya PDF) + `attachment_path` / `attachment_paths` metadata; bucket RLS; no external API. |
| 3 | **D12** | **22** | Edge Function **`process-referral-hl7-inbound`**: cron or manual POST; for `pending` rows, parse MSH/PID minimally, set `processed`/`failed`, fill `parse_error`; **no** auto-create `referral_leads` until D13. |
| 4 | **D13** | **14** | **Read-only** clinical panel: diet order + resident med list side-by-side **or** narrow automation after rules are written. |
| 5 | **D14** | **15** | Week strip or agenda **calendar** for `resident_transport_requests` (existing table). |

Defer **23 OAuth**, **22 MLLP**, **14 full rule engine** until product/security review.

---

## 4. Blockers / assumptions

- **Track A** can remain skipped for **engineering** progress; PHI production still needs owner attestation separately.
- **COL clinical sign-off** required before **automated** dietary or HL7 **lead creation**.
- **Next migration number** in README: **`115`** — use for the next DDL after D10.

---

## 5. Recording progress

After each segment: add **D11+** block to [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md) with gate artifact path and deferrals, matching D1–D10 style.
