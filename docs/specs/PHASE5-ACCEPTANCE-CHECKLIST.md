# Phase 5 acceptance checklist

**Authority:** [README.md](./README.md) Phase 5 — **10** Quality Metrics (`081`–`082`), **21** Family Portal (`083`–`084`), **24** Executive Intelligence v2 (`085`).

**Pilot:** Oakridge ALF for facility-scoped quality; family routes use linked family user per seed.

---

## Mission alignment

| Verdict | Record when |
|---------|----------------|
| **pass** | Quality measures visible where seeded; family least-privilege paths work; exec v2 shipped scope exercised or N/A documented |
| **risk** | NLQ/Realtime dashboards deferred — explicitly marked Enhanced |
| **fail** | PBJ or family messaging exposes wrong resident data |

---

## Row map

| # | Area | Pass? | Primary routes / proof |
|---|------|-------|-------------------------|
| 1 | **Quality** — measures list, latest facility view | | `/admin/quality/*` (per FRONTEND-CONTRACT) |
| 2 | **Quality** — PBJ export batch create/ download if used | | `pbj_export_batches` |
| 3 | **Family (admin)** — triage / consent | | `/admin/family-messages` or triage routes per spec |
| 4 | **Family (app)** — `/family` home, messages | | `/family`, `/family/messages` |
| 5 | **Family** — care plan / calendar / billing views | | `/family/care-plan`, `/family/calendar`, `/family/billing` |
| 6 | **Executive v2 (`085`)** — `exec_nlq_sessions` / scenarios | | Routes under `/admin/executive/*` for NLQ/scenarios **or** mark **N/A** if UI still minimal (STUB areas) |
| 7 | **AI / compliance** | | Any NLQ path uses `ai_invocations` where applicable; human review for external-facing outputs |
| 8 | **Meta** | | Owner sign-off |

---

## Deferred / Enhanced

- **WebRTC / keyword triggers** — family spec Enhanced.
- **Full NLQ solver + Realtime dashboards** — `24-executive-v2.md` STUB sections; acceptance = **shipped Core** only.

---

## Sign-off

| Field | Value |
|-------|--------|
| **Result** | PENDING |
| **Date** | |
| **Tester** | |
