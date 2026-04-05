# Phase 2 acceptance checklist

**Authority:** Maps to [PHASE2-SCOPE.md](./PHASE2-SCOPE.md) “Success criteria for Phase 2 complete” (lines 279–288).

**How to use:** For each row, record **PASS** or **FAIL** with date, tester, and notes (screenshot, command output, or issue link). Phase 2 is accepted only when every applicable row is **PASS** or has an approved waiver per `agents/registry.yaml` mission gate rules.

**Pilot facility:** Oakridge ALF (seed in `00-foundation` / COL demo data). “Real data” means rows visible in Supabase for that facility, not mocked UI-only placeholders.

---

## Row map (PHASE2-SCOPE criteria)

| # | PHASE2-SCOPE criterion (summary) | Pass? | Notes |
|---|----------------------------------|-------|-------|
| 1 | Core for all 4 modules built, tested, segment gates | | |
| 2 | Assessment → score → acuity → care plan review if threshold | | |
| 3 | eMAR PRN effectiveness prompts fire and persist | | |
| 4 | Controlled substance count shift-to-shift with dual signature | | |
| 5 | Infection surveillance → outbreak → management E2E | | |
| 6 | Compliance dashboard tiles (six types) with real Oakridge data | | |
| 7 | Survey visit mode: single-resident chart retrieval, p95 under 3s on local dev | | |
| 8 | This checklist passes (meta) | | |

---

### 1. Core items + segment gates

**Objective:** All Phase 2 Core deliverables exist and have been gated per repo discipline.

**Specs (build order):** `03-resident-profile-advanced.md`, `06-medication-management.md`, `09-infection-control.md`, `08-compliance-engine.md`

**Migrations:** `035_*` care planning advanced, `037_*` medication advanced, `038_*` infection, `039_*` compliance.

**Verification:**

- `npm run migrations:check`
- `npm run lint`
- `npm run build`
- Segment gates for each closed slice (examples; use actual segment IDs from commits / `test-results/agent-gates/`):
  - `npm run segment:gates -- --segment "<phase2-segment-id>"` and `--ui` when routes or layouts changed

**Pass when:** Migrations apply cleanly; lint and build succeed; gate JSON artifacts exist for Phase 2 UI/backend segments relevant to the four modules.

---

### 2. Assessment entry end-to-end

**Objective:** Nurse creates an assessment → score computed → acuity updated → care plan review suggested when threshold crossed.

**Primary routes (admin):**

- `/admin/residents/[id]/assessments` — list / start assessments
- `/admin/residents/[id]/assessments/new` — new assessment
- `/admin/residents/[id]/care-plan` — care plan
- `/admin/care-plans/reviews-due` — reviews due
- `/admin/assessments/overdue` — overdue assessments

**Data:** Use a test resident at Oakridge; complete at least one assessment template that drives scoring and acuity.

**Pass when:** One documented run-through shows score persisted, acuity field(s) updated as designed, and review suggestion or queue entry appears when spec threshold is met (or document template that does not cross threshold and still shows correct “no review” behavior).

---

### 3. eMAR PRN effectiveness prompts

**Objective:** PRN follow-up prompts fire and persist after PRN administration.

**Routes:**

- Caregiver: `/caregiver/meds`, PRN flow; `/caregiver/prn-followup` if present
- Admin/meds surfaces per `06-medication-management.md`

**Pass when:** After documenting a PRN dose, a follow-up prompt or record exists and survives refresh (DB-backed).

---

### 4. Controlled substance count — dual signature

**Objective:** Shift-to-shift count reconciliation with two signers.

**Routes:**

- `/admin/medications/controlled` — controlled substance hub / count workflow
- Caregiver: `/caregiver/controlled-count` if applicable

**Pass when:** One full handoff cycle completes with two signatures (or documented equivalent) and audit trail visible in app or `audit_log` for the facility.

---

### 5. Infection surveillance → outbreak → management

**Objective:** At least one end-to-end path from surveillance through outbreak declaration to management UI.

**Routes:**

- `/admin/infection-control` — hub
- `/admin/infection-control/new` — new surveillance
- `/admin/infection-control/outbreaks/[id]` — outbreak management
- APIs: `POST /api/infection-control/evaluate-vitals`, `POST /api/infection-control/evaluate-outbreak` (as applicable)

**Pass when:** Documented steps show surveillance data, triggering or manual outbreak path, and management screen updates for the same facility.

---

### 6. Compliance dashboard tiles (Oakridge)

**Objective:** Dashboard shows at minimum these tiles with **real** pilot data (non-zero where the facility has data):

- Overdue assessments  
- Overdue care plan reviews  
- Open incident follow-ups  
- Active infections  
- Expiring staff certifications  
- Open deficiencies  

**Route:** `/admin/compliance`

**Implementation note:** Tile queries live in `src/lib/compliance-dashboard-snapshot.ts` and the compliance dashboard page.

**Pass when:** Each tile either shows a correct count from DB for Oakridge or a documented empty state with proof that the underlying tables have no rows (not a broken query).

---

### 7. Survey visit mode — chart retrieval and performance

**Objective:** Survey visit mode can retrieve a **single-resident** chart (assessments, meds, incidents, care plan, daily logs) with **p95 under 3 seconds** on local dev.

**UI:** `SurveyVisitModeBar` in admin shell (`src/components/layout/AdminShell.tsx`).

**Pass criteria (choose one and document):**

- **A (full):** Cross-table search or navigation loads one resident’s combined chart within p95 under 3s measured locally (e.g. browser Performance panel, or scripted timing).  
- **B (MVP waiver):** Product owner documents that Core scope is manual access logging only; criterion 7 marked **FAIL** or **WAIVED** with remediation issue — Phase 2 acceptance deferred until waiver approved.

**Pass when:** A or B is explicitly recorded with evidence.

---

### 8. This checklist (meta)

**Pass when:** Rows 1–7 are **PASS** or **WAIVED** with owner, reason, expiry, and remediation issue per mission gate rules.

---

## Mission alignment

Record for the Phase 2 closure segment: **pass** | **risk** | **fail** with one sentence (see `docs/mission-statement.md`).
