# Track C — Referral → admission → discharge runbook

**Purpose:** Single **traceability** narrative for C3 workflow hardening: lead → case → resident + payer/rate → discharge. Use on the **pilot** facility (Oakridge) with real auth.

**Specs:** [01-referral-inquiry.md](./01-referral-inquiry.md), [02-admissions-move-in.md](./02-admissions-move-in.md), [05-discharge-transition.md](./05-discharge-transition.md).

---

## Preconditions

- Admin session (`facility_admin` or `owner`) with facility context selected.
- Seed or test data allowing at least one **bed** and **rate** for the facility (see billing specs).

---

## Happy path (document in PHASE1-EXECUTION-LOG)

1. **Referrals** — `/admin/referrals` — create or open a lead; note `referral_leads.id`.
2. **Admission case** — `/admin/admissions` — create admission case; link lead if UI provides `referral_lead_id` (or document equivalent linkage).
3. **Resident** — `/admin/residents/new` or from admission flow — resident created; confirm `payer` / `rate_schedules` as required for billing.
4. **Billing sanity** — `/admin/billing/invoices` — zero or draft invoices consistent with resident state.
5. **Discharge** — `/admin/discharge` — start discharge workflow; complete checklist items required by spec (COL notes: Form 1823 / DCF / rep payee as applicable).

**Evidence:** URLs, role, facility id, lead/admission/resident ids (no unnecessary PHI in repo logs).

---

## Guard / failure paths (at least one)

- Attempt to open another facility’s resident URL from a **facility-scoped** admin session (expect deny or empty per RLS).
- Invalid discharge step without required fields (expect validation, not silent success).

---

## Automation (optional)

- Re-run `npm run demo:web-health` with `BASE_URL` pointed at your environment to confirm `/admin/referrals`, `/admin/admissions`, `/admin/discharge` respond (redirect when logged out).

---

## Related

- [TRACK-C-WORKFLOW-HARDENING.md](./TRACK-C-WORKFLOW-HARDENING.md)
- [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)
