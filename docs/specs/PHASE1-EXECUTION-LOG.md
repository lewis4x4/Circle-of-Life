# Phase 1 — checklist execution log

**Use:** Record **PASS**, **FAIL**, or **WAIVED** for each row when executing [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) on the **target environment** with **real auth**.

**Rule:** A repo/agent cannot set PASS without owner (or delegated tester) execution on that environment.

**Legend:** `PENDING` = not yet executed.

---

## Preconditions

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-P01 | `.env.local` → correct Supabase project | PENDING | | | |
| PH1-P02 | Migrations applied / list aligned remote | PENDING | | | |
| PH1-P03 | Seeded users + roles + facility access | PENDING | | | |
| PH1-P04 | Facility context in admin shell | PENDING | | | |
| PH1-P05 | Storage buckets (if/when uploads added) | PENDING | | | N/A until Storage used |
| PH1-P06 | Pro plan, BAA before PHI, PITR (production) | PENDING | | | Dashboard only |

---

## A. Authentication and routing

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-A01 | `/login` — admin / caregiver / family → correct shell | PENDING | | | |
| PH1-A02 | Invalid credentials — clear error | PENDING | | | |
| PH1-A03 | Deep link logged out → login | PENDING | | | |
| PH1-A04 | Wrong role cannot open other shell routes | PENDING | | | |

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
| PH1-B404 | `/admin/incidents/[id]/rca` | PENDING | | | See waiver if localStorage-only accepted |

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
| PH1-E05 | Optional: segment gates `--ui` (see closure record) | PASS | agent | 2026-04-05 | Artifact in `test-results/agent-gates/` |

---

## F. Known limitations / waivers

| ID | Item | Result | Tester | Date | Notes |
|----|------|--------|--------|------|-------|
| PH1-F01 | RCA workspace — localStorage only | PENDING | | | Waive or fix — [PHASE1-WAIVER-LOG.md](./PHASE1-WAIVER-LOG.md) |
| PH1-F02 | Billing edge functions (spec vs deployed) | PENDING | | | |
| PH1-F03 | Collection activities UI | PENDING | | | |
| PH1-F04 | List-heavy admin pages without create wizards | PENDING | | | |

---

## Backend baseline (automated)

| ID | Item | Result | Date | Notes |
|----|------|--------|------|-------|
| PH1-BE01 | `npm run build` | PASS | 2026-04-05 | |
| PH1-BE02 | `npm run lint` | PASS | 2026-04-05 | |
| PH1-BE03 | `npm run migrations:verify:pg` | PASS | 2026-04-05 | |
| PH1-BE04 | `npm run check:secrets` | PASS | 2026-04-05 | |
| PH1-BE05 | `npm audit` | PASS | 2026-04-05 | 0 vulns |
| PH1-BE06 | `supabase db push` / migration list aligned | PENDING | | Owner |

---

## Summary counts (update when complete)

| Category | PASS | FAIL | WAIVED | PENDING |
|----------|------|------|--------|---------|
| Preconditions | 0 | 0 | 0 | 6 |
| A–D | 0 | 0 | 0 | many |
| E (manual) | 0 | 0 | 0 | 4 |
| E (gates) | 1 | 0 | 0 | 0 |
| F | 0 | 0 | 0 | 4 |
| Backend BE01–BE05 | 5 | 0 | 0 | 0 |
| BE06 | 0 | 0 | 0 | 1 |
