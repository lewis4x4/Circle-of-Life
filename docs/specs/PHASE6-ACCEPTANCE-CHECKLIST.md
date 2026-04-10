# Phase 6 acceptance checklist

**Authority:** [README.md](./README.md) Phase 6 — **12** Training (`086`–`087`, `115`–`118`), **13** Payroll (`088`), **14** Dietary (`089`), **15** Transportation (`090`, `112`–`114`), **22** Referral CRM (`091`), **23** Reputation (`092`). **Track D** completion pass: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**Pilot:** Oakridge ALF; org-wide training lists may require org admin.

---

## Mission alignment

| Verdict | Record when |
|---------|----------------|
| **pass** | Core hubs load with RLS; CSV exports and critical workflows match Track D shipped scope |
| **risk** | Payroll vendor handoff CSV works; external API integrations ops-owned |
| **fail** | Mock data presented as real when `NEXT_PUBLIC_DEMO_MODE` unset |

---

## Row map

| # | Module | Pass? | Primary routes / proof |
|---|--------|-------|-------------------------|
| 1 | **Training** — programs, completions, in-service, certs | | `/admin/training`, completions + inservice + CSVs (D38–D43) |
| 2 | **Payroll** — batches, lines, imports, CSVs | | `/admin/payroll/[id]`, time import, vendor CSV (D58–D69, D64) |
| 3 | **Dietary** — orders, clinical review, IDDSI hints | | `/admin/dietary`, `/admin/dietary/clinical-review` (D50–D53) |
| 4 | **Transportation** — fleet, requests, calendar, mileage, `.ics` | | `/admin/transportation`, `calendar`, `settings`, request detail calendar links (D56–D66) |
| 5 | **Referral CRM** — pipeline, HL7 queue | | `/admin/referrals`, `/admin/referrals/hl7-inbound` |
| 6 | **Reputation** — accounts, replies, Google/Yelp | | `/admin/reputation`, integrations, sync/post APIs (D44–D49) |
| 7 | **Track D regression** | | Spot-check [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md) segments relevant to pilot |
| 8 | **Demo mode** | | With demo flag **off**, hubs show empty/real states (WS1) |
| 9 | **Meta** | | Owner sign-off |

---

## Deferred / Enhanced

- **Payroll vendor API** — vendor unknown per `13-payroll-integration.md`; CSV handoff = Core acceptance boundary.
- **HL7 listener**, **full reputation AI** — Enhanced; see [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./TRACK-D-ENHANCED-BACKLOG-PLAN.md).

---

## Sign-off

| Field | Value |
|-------|--------|
| **Result** | PENDING |
| **Date** | |
| **Tester** | |
