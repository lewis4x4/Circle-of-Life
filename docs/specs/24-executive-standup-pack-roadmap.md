# Track S — Executive Standup Pack Roadmap

**Primary spec:** [`24-executive-standup-pack.md`](./24-executive-standup-pack.md)  
**Parent module:** [`24-executive-intelligence.md`](./24-executive-intelligence.md)  
**Audience:** Owner, Org Admin, Facility Admin  
**Status:** Planning-ready; implementation sequencing only  
**Mission alignment:** `pass`

---

## Purpose

Turn the current weekly standup spreadsheet into a first-class Haven executive product:

- **interactive dashboard**
- **weekly frozen standup packet**
- **board-ready PDF**
- **historical archive**
- **trustable metric lineage**

This roadmap converts the standup-pack spec into an execution sequence with bounded slices.

---

## Non-negotiables

1. **Do not rebuild Excel in React.** Preserve the operator mental model, but upgrade it into a governed workflow.
2. **Metrics must be defined before they are visualized.** No ambiguous numbers.
3. **Weekly packs are immutable after publish.** Historical trust matters more than convenience.
4. **Manual values must be explicit.** Never blur live facts with forecasts or hand-entered standup notes.
5. **PDF quality matters.** This is an owner-facing board artifact, not a browser print hack.
6. **Every number needs provenance.** Source table, source mode, last updated, and confidence.

---

## Product deliverables

### D1. Live owner dashboard

Route:

- `/admin/executive/standup`

Capabilities:

- current operating state
- facility ranking by pressure
- change vs last published week
- drill-through to source modules

### D2. Weekly standup workflow

Capabilities:

- generate draft from current data
- fill missing manual/forecast values
- review completeness and confidence
- publish weekly pack

### D3. Board PDF

Capabilities:

- cover summary
- portfolio summary
- facility comparison
- section detail
- notes and sign-off metadata

### D4. Historical archive

Capabilities:

- browse by week
- compare week-to-week
- preserve imported spreadsheet history

---

## Metric contract

Each metric must be seeded into a registry before dashboard work begins.

### Initial seed set

| Section | Key | Label | Type | Source mode |
|---|---|---|---|---|
| AR & Census | `ar_goal_cents` | Goal | currency | manual |
| AR & Census | `current_ar_cents` | Current AR | currency | auto |
| AR & Census | `current_total_census` | Current Total Census | count | auto |
| AR & Census | `average_rent_cents` | Average Rent | currency | hybrid |
| AR & Census | `uncollected_ar_total_cents` | Uncollected AR Total | currency | auto |
| Bed Availability | `sp_female_beds_open` | SP Female Beds Open | count | manual/hybrid |
| Bed Availability | `sp_male_beds_open` | SP Male Beds Open | count | manual/hybrid |
| Bed Availability | `sp_flexible_beds_open` | SP Male or Female Beds Open | count | manual/hybrid |
| Bed Availability | `private_beds_open` | Private Beds Open | count | hybrid |
| Bed Availability | `total_beds_open` | Total Beds Open | count | auto |
| Admissions | `admissions_expected` | Admissions Expected | count | forecast |
| Risk | `hospital_and_rehab_total` | Total at the Hospital & Rehab | count | hybrid |
| Risk | `expected_discharges` | Expected Discharges | count | forecast |
| Staffing | `callouts_last_week` | Call Outs Last Week | count | manual/hybrid |
| Staffing | `terminations_last_week` | Terminations Last Week | count | auto |
| Staffing | `current_open_positions` | Current Open Positions | count | manual until requisitions ship |
| Staffing | `overtime_hours` | Overtime | hours | auto |
| Marketing | `tours_expected` | Tours Expected | count | forecast |
| Marketing | `provider_activities_expected` | Activities on the calendar to be completed by Home Health Providers | count | manual |
| Marketing | `outreach_engagements` | Outreach & Engagements (Providers, Facilities, Events) | count | manual |

### Metric quality flags

Every metric row must expose:

- `source_mode`: `auto`, `manual`, `hybrid`, `forecast`
- `confidence_band`: `high`, `medium`, `low`
- `freshness_at`
- `source_ref_json`
- `override_note`

---

## Recommended migration sequence

Current README says next free migration number is **`179`**. Use that sequence.

| Migration | Slice | Purpose |
|---|---|---|
| `185_executive_standup_metric_registry.sql` | S0 | Metric definitions, enums, governance tables |
| `186_executive_standup_snapshots.sql` | S1 | Weekly snapshot + metric rows + manual entries + forecast entries |
| `187_executive_standup_rls_audit.sql` | S1 | RLS, audit triggers, roles, publication guards |
| `188_executive_standup_import_jobs.sql` | S2 | Workbook import jobs / import status / archive references |
| `189_staff_attendance_callouts.sql` | S4 | Attendance / callout events |
| `190_staff_requisitions.sql` | S4 | Open positions / requisitions |
| `191_referral_outreach_activities.sql` | S4 | Outreach and provider activity logging + tour scheduling fields |
| `192_bed_inventory_classification.sql` | S4 | Bed type / flexibility / private availability normalization |

Notes:

- `183+` are only needed when moving beyond the hybrid/manual bridge.
- If a lighter first release is required, S4 can be deferred and manual-entry maintained longer.

---

## Build slices

### S0 — Metric contract and registry

Goal:

- lock down metric semantics before UI implementation

Deliverables:

- migration `185`
- seeded metric registry
- metric definitions doc appendix
- totals behavior defined per metric

Acceptance:

- every workbook row has a corresponding registry entry
- every registry entry has source mode + type + aggregation mode

### S1 — Snapshot foundation

Goal:

- create the real weekly standup workflow

Deliverables:

- migrations `186` and `187`
- draft/publish/archive states
- weekly manual and forecast entry support
- immutable published snapshots

Acceptance:

- an admin can create a draft standup week
- fill missing values
- publish the pack
- re-open historical published weeks in read-only mode

### S2 — Historical spreadsheet import

Goal:

- preserve legacy continuity and trust

Deliverables:

- migration `188`
- importer script/service for workbook blocks
- history-page import runbook + recent import job status
- imported snapshot history
- imported rows marked as manual lineage

Acceptance:

- imported January–April sample weeks show correctly in history
- imported metrics are labeled as imported/manual
- week-over-week comparison works across imported data
- owner/admin can see whether the last workbook import completed or failed without leaving the app

### S3 — Dashboard and PDF core

Goal:

- deliver owner-facing value immediately

Deliverables:

- `/admin/executive/standup`
- `/admin/executive/standup/history`
- `/admin/executive/standup/[week]`
- board-style PDF renderer
- confidence/freshness/source badges
- board packet saved-report handoff into `/admin/executive/reports`

Acceptance:

- owner can open a live standup dashboard
- owner can open a published historical week
- owner can export a board-ready PDF
- owner/admin can save a weekly board packet into executive saved reports and reopen it later

### S4 — Missing operational models

Goal:

- replace the most important manual spreadsheet rows with structured capture

Deliverables:

- `staff_attendance_events`
- `staff_requisitions`
- `referral_outreach_activities`
- `provider_calendar_activities`
- bed inventory classification extensions

Acceptance:

- callouts, open positions, outreach, provider activities, and bed-type metrics no longer depend solely on manual standup entry

### S5 — Executive-grade action engine

Goal:

- move from report to operating system

Deliverables:

- change narrative
- facility pressure score
- variance flags
- “why is this red?” explanations
- top intervention recommendations

Acceptance:

- owner can understand changes without interpreting raw tables manually

---

## UI roadmap

### Standup overview page

Sections:

1. Hero ribbon
   - week selector
   - live/draft/published state
   - completeness %
   - confidence score
   - actions: generate, publish, export PDF

2. Portfolio summary strip
   - current AR
   - census
   - total open beds
   - expected admissions
   - staffing pressure
   - risk pressure

3. Facility pressure board
   - ranked cards
   - top concern
   - quick deltas

4. Workbook-equivalent sections
   - AR & Census
   - Bed Availability
   - Admissions
   - Risk
   - Staffing
   - Marketing

5. Narrative panel
   - biggest changes
   - biggest risks
   - data quality issues

### Standup detail page

Per-week detail:

- section tables
- metric provenance
- manual notes
- version metadata

### History page

- list published weeks
- import status
- compare any two weeks

---

## PDF roadmap

### PDF v1

- generated from snapshot rows
- fixed print layout
- portfolio summary + facility table + section detail

### PDF v2

- stronger visual hierarchy
- notes page
- confidence / source legend
- page-level narrative callouts

### PDF v3

- “board packet” mode
- executive summary page
- appendix / methodology page

---

## Data lineage and trust requirements

Every standup metric shown in UI or PDF must expose:

- metric label
- current value
- variance vs prior week
- source mode
- last updated
- lineage/source detail
- whether it was manually overridden

Published packs must additionally expose:

- generated by
- published by
- generation timestamp
- published timestamp
- version number

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Metric mismatch vs spreadsheet | owner distrust | metric registry + workbook import + manual lineage |
| Manual values never go away | spreadsheet persists | track manual share and prioritize S4 model replacements |
| PDF looks like browser print | low owner adoption | explicit PDF renderer and board layout |
| Forecast rows are mistaken for facts | decision confusion | separate forecast entry model and source-mode badges |
| Historical weeks are lost | weak trust | import workbook history before rollout |
| Dashboard feels like a generic BI grid | low differentiation | pressure board, narrative, action lanes, executive design |

---

## Verification plan

### Unit / data

- metric computations
- totals rollups
- snapshot immutability
- import normalization

### Integration

- generate draft
- save manual values
- publish pack
- export PDF

### Visual / UX

- dashboard works on owner desktop
- PDF prints cleanly
- source/confidence indicators are obvious

### Acceptance

- owner can review a full weekly standup without opening Excel
- admin can prepare the pack in-app
- historical weeks remain accessible and comparable

---

## Best next step

Proceed with:

**S0 + S1 kickoff**

Meaning:

1. create the metric registry and snapshot schema
2. seed the workbook metrics
3. scaffold the standup routes
4. support manual/forecast entry in draft weeks

That is the smallest slice that preserves trust and unlocks the rest of the roadmap.
