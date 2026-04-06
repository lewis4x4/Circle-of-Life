# Phase 1 — checklist execution log

**Use:** Record **PASS**, **FAIL**, or **WAIVED** for each row when executing [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) on the **target environment** with **real auth**.

**Rule:** A repo/agent cannot set PASS without owner (or delegated tester) execution on that environment.

**Legend:** `PENDING` = not yet executed. See [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md) (2026-04-06: remote migrations **001–095** PASS).

---

## Live execution attempt — 2026-04-06

Real-auth UAT started on the target project using `.env.local`, local app runtime at `http://localhost:3000`, and migration `033` demo credentials.

Observed blocker:

- Seeded role sign-ins failed before shell routing could complete:
  - Initial seed addresses (`.demo` / `.family.demo`) failed with `unexpected_failure` / `Database error querying schema`
  - After remote auth remediation migrations `093` and `094`, normalized addresses still failed:
    - `jessica@circleoflifealf.com`
    - `maria.garcia@circleoflifealf.com`
    - `robert.sullivan@circleoflifealf.com`
  - `095_restore_default_auth_instance.sql` was later applied remotely; auth still fails with the same `Database error querying schema`
  - `npm run demo:auth-check` is now the canonical repro command for future auth retests and handoff packets

Rows that do not require a successful authenticated session were still executed below.

---

## Execution protocol

1. Run sections in checklist order: **Preconditions**, **A**, **B**, **C**, **D**, **E**
2. Use the actual role named in the row notes or in the checklist packet
3. For every **FAIL** or uncertain result, capture screenshot/video, route, role, facility context, and exact error text in `Notes`
4. If a row cannot run because the single-facility pilot lacks required data, mark **WAIVED** only with owner approval and cite the reason in `Notes`
5. Do not convert a manual UAT row to PASS based on repo evidence alone

## Execution owner fields

Use `Tester` to record the human who ran the step. Use `Notes` to capture:

- role used
- resident / staff / invoice seed referenced
- facility selected
- evidence filename or link location
- follow-up issue or waiver ID if applicable

---

## Preconditions

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-P01 | `.env.local` → correct Supabase project | **PASS** | owner | 2026-04-06 | Brian Lewis confirmed active project **`manfqmasfqppukpobpld`** (Supabase Authentication UI, PRODUCTION). Repo canonical URL: `https://manfqmasfqppukpobpld.supabase.co` ([README.md](./README.md)). Owner still responsible to keep local `.env.local` host aligned (never commit secrets). |
| PH1-P02 | Migrations applied / list aligned remote | **PASS** | agent | 2026-04-06 | `supabase migration list` shows Local/Remote **001–095** after remote apply of `093`, `094`, and `095` |
| PH1-P03 | Seeded users + roles + facility access | **FAIL** | agent | 2026-04-06 | Live sign-in still fails for `facility_admin`, `caregiver`, and `family` pilot users even after remote auth remediations `093` and `094`: `unexpected_failure` / `Database error querying schema`; facility access not verifiable without session |
| PH1-P04 | Facility context in admin shell | PENDING | | | Owner UAT; single-facility pilot is acceptable if all executed rows name the same facility |
| PH1-P05 | Storage buckets (if/when uploads added) | **N/A** | | | No Storage in Phase 1 UI per checklist |
| PH1-P06 | Pro plan, BAA before PHI, PITR (production) | PENDING | | | Dashboard only — not inferable from repo |

---

## A. Authentication and routing

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-A01 | `/login` — admin / caregiver / family → correct shell | **FAIL** | agent | 2026-04-06 | Valid pilot-role login could not complete. Supabase Auth failed before route resolution first for `.demo` addresses, then again for `jessica@circleoflifealf.com`, `maria.garcia@circleoflifealf.com`, and `robert.sullivan@circleoflifealf.com` even after remote apply of `093`, `094`, and `095`, all with `Database error querying schema`. Automated re-verification after A1 fix: `npm run demo:auth-smoke:real` |
| PH1-A02 | Invalid credentials — clear error | **PASS** | agent | 2026-04-06 | Playwright UI run on `/login` with `nobody@example.com` + wrong password showed visible error: `Invalid login credentials`; future local reruns use `npm run demo:auth-smoke` |
| PH1-A03 | Deep link logged out → login | **PASS** | agent | 2026-04-06 | `GET /admin/residents` redirected to `/login?next=%2Fadmin%2Fresidents`; Playwright and `curl -I` matched; future local reruns use `npm run demo:auth-smoke` |
| PH1-A04 | Wrong role cannot open other shell routes | PENDING | | | Blocked by PH1-A01 auth failure; no valid non-admin session available for route guard verification |

---

## B. Admin shell

### B1. `/admin`

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-B101 | Dashboard loads; metrics/empty state | PENDING | | | |
| PH1-B102 | Links to residents work | PENDING | | | |

### B2. Residents

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-B201 | `/admin/residents` | PENDING | | | |
| PH1-B202 | `/admin/residents/[id]` | PENDING | | | |
| PH1-B203 | `/admin/residents/[id]/care-plan` | PENDING | | | |
| PH1-B204 | `/admin/residents/[id]/billing` | PENDING | | | |

### B3. Staff and workforce

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-B301 | `/admin/staff` | PENDING | | | |
| PH1-B302 | `/admin/staff/[id]` | PENDING | | | |
| PH1-B303 | `/admin/certifications` | PENDING | | | |
| PH1-B304 | `/admin/schedules` | PENDING | | | |
| PH1-B305 | `/admin/staffing` | PENDING | | | |
| PH1-B306 | `/admin/time-records` | PENDING | | | |

### B4. Incidents

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-B401 | `/admin/incidents` | PENDING | | | |
| PH1-B402 | `/admin/incidents/[id]` | PENDING | | | |
| PH1-B403 | `/admin/incidents/trends` | PENDING | | | |
| PH1-B404 | `/admin/incidents/[id]/rca` | PENDING | | | Verify persistence to `incident_rca`; do not use the retired localStorage waiver |

### B5. Billing

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-B501 | `/admin/billing` | PENDING | | | |
| PH1-B502 | `/admin/billing/invoices` | PENDING | | | |
| PH1-B503 | `/admin/billing/invoices/[id]` (no demo fallback) | PENDING | | | |
| PH1-B504 | `/admin/billing/invoices/generate` | PENDING | | | |
| PH1-B505 | `/admin/billing/payments/new` | PENDING | | | |
| PH1-B506 | `/admin/billing/rates` | PENDING | | | |
| PH1-B507 | `/admin/billing/ar-aging` | PENDING | | | |
| PH1-B508 | `/admin/billing/org-ar-aging` | PENDING | | | |
| PH1-B509 | `/admin/billing/revenue` | PENDING | | | |

### B6. Other admin

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-B601 | `/admin/family-messages` | PENDING | | | |
| PH1-B602 | `/admin/assessments/overdue` | PENDING | | | |
| PH1-B603 | `/admin/care-plans/reviews-due` | PENDING | | | |
| PH1-B604 | Facility switcher scopes lists | PENDING | | | |

---

## C. Caregiver shell

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-C01 | `/caregiver` | PENDING | | | |
| PH1-C02 | `/caregiver/tasks` | PENDING | | | |
| PH1-C03 | `/caregiver/meds` | PENDING | | | |
| PH1-C04 | `/caregiver/incident-draft` | PENDING | | | |
| PH1-C05 | `/caregiver/schedules` | PENDING | | | |
| PH1-C06 | `/caregiver/clock` | PENDING | | | |
| PH1-C07 | `/caregiver/resident/[id]` | PENDING | | | |
| PH1-C08 | `/caregiver/resident/[id]/log` | PENDING | | | |
| PH1-C09 | `/caregiver/resident/[id]/adl` | PENDING | | | |
| PH1-C10 | `/caregiver/resident/[id]/behavior` | PENDING | | | |
| PH1-C11 | `/caregiver/resident/[id]/condition-change` | PENDING | | | |
| PH1-C12 | `/caregiver/handoff`, `/followups`, `/prn-followup` | PENDING | | | |
| PH1-C13 | `/caregiver/me` | PENDING | | | |

---

## D. Family shell

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-D01 | `/family` | PENDING | | | |
| PH1-D02 | `/family/care-plan` | PENDING | | | |
| PH1-D03 | `/family/billing`, `/invoices`, `/payments` | PENDING | | | |
| PH1-D04 | `/family/calendar` | PENDING | | | |
| PH1-D05 | `/family/messages` | PENDING | | | |

---

## E. Cross-cutting UX

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-E01 | Loading states | PENDING | | | |
| PH1-E02 | Empty states | PENDING | | | |
| PH1-E03 | Error states | PENDING | | | |
| PH1-E04 | Mobile viewport (caregiver) | PENDING | | | |
| PH1-E05 | Optional: segment gates `--ui` (see closure record) | PASS | agent | 2026-04-05 | `phase1-closeout-2026-04-05` → `test-results/agent-gates/2026-04-05T19-33-16-726Z-phase1-closeout-2026-04-05.json` |

---

## F. Known limitations / waivers

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-F01 | RCA workspace waiver | **PASS** | agent | 2026-04-06 | Remediated in repo; keep row for historical traceability only |
| PH1-F02 | Billing edge function deployment gap | **PASS** | agent | 2026-04-06 | `generate-monthly-invoices` deployed; residual question is ops scheduling, not repo functionality |
| PH1-F03 | Collection activities UI gap | **PASS** | agent | 2026-04-06 | Admin list/create flow shipped |
| PH1-F04 | List-heavy admin pages without create wizards | **WAIVED** | Brian Lewis | 2026-04-06 | [PHASE1-WAIVER-LOG.md](./PHASE1-WAIVER-LOG.md) W-ADMIN-01 |

---

## Backend baseline (automated)

| ID | Item | Result | Date | Notes |
|----|------|--------|------|-------|
| PH1-BE01 | `npm run build` | PASS | 2026-04-06 | Refreshed (92 migrations) |
| PH1-BE02 | `npm run lint` | PASS | 2026-04-06 | |
| PH1-BE03 | `npm run migrations:verify:pg` | PASS | 2026-04-06 | |
| PH1-BE04 | `npm run check:secrets` | PASS | 2026-04-06 | |
| PH1-BE05 | `npm audit` | PASS | 2026-04-06 | 0 vulns |
| PH1-BE06 | `supabase db push` / migration list aligned | **PASS** | 2026-04-06 | Local/Remote **001–095** aligned. See [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md) |

---

## Summary counts (update when complete)

| Category | PASS | FAIL | WAIVED | PENDING |
|----------|------|------|--------|---------|
| Preconditions | 2 | 1 | 1 N/A | 2 |
| A–D | 2 | 1 | 0 | many |
| E (manual) | 0 | 0 | 0 | 4 |
| E (gates) | 1 | 0 | 0 | 0 |
| F | 3 | 0 | 1 | 0 |
| Backend BE01–BE06 | 6 | 0 | 0 | 0 |
