# 24A — Executive Standup Pack (Owner Operating System)

**Extension of:** [`24-executive-intelligence.md`](./24-executive-intelligence.md)  
**Primary user:** Owner  
**Secondary users:** Org Admin, Facility Admin  
**Build posture:** Build-ready spec and gap analysis; implementation should follow current repo sequencing constraints in `AGENTS.md` / Track A closeout discipline.

---

## What this is

This spec productizes the existing weekly spreadsheet standup into a **live executive dashboard** plus a **board-style PDF pack**.

The source workbook currently acts as a portfolio operating report with one weekly block per month tab. Its recurring sections are:

1. **Accounts Receivable & Census**
2. **Current Bed Availability**
3. **Expected Admissions This Week**
4. **Risk Management**
5. **Staffing**
6. **Marketing Plans For This Week**

The product goal is **not** to recreate Excel in the browser. The goal is to give ownership a one-click operating system that:

- shows the current state at any minute
- freezes a weekly Monday standup snapshot
- explains what changed vs last week
- exports a clean board-ready PDF
- replaces spreadsheet maintenance over time

---

## Mission fit

**Pass** — this directly advances owner visibility, regulatory readiness, staffing clarity, and early risk surfacing on a governed data layer.

---

## Product concept

Working name: **Executive Standup Pack**

Core deliverables:

- **Interactive dashboard** at `/admin/executive/standup`
- **Generate standup snapshot** action for weekly freeze
- **Board-style PDF export** for owner review and sharing
- **Variance commentary** vs prior week and goal
- **Drill-through links** from each metric into the live module behind it

Owner experience:

- Open one screen and immediately see the entire operating picture
- Sort facilities by urgency
- See which metrics are auto-fed vs manually-entered
- Print a PDF that is board-ready without spreadsheet cleanup

Admin experience:

- Same dashboard visibility
- Allowed to fill in any manual standup fields still missing from source systems
- Allowed to preview and validate a standup pack before owner review

---

## Design standard

This module should be treated as an **owner operating system**, not a reporting page.

World-class bar:

- one-click clarity for the owner
- board-ready output without spreadsheet cleanup
- trustworthy numbers with lineage and confidence
- explicit separation between **live state**, **weekly frozen pack**, and **manual planning assumptions**
- aesthetically premium, but subordinate to speed and interpretability

If this module succeeds, ownership should stop asking for the spreadsheet.

---

## Source workbook decomposition

Workbook pattern observed:

- one sheet per month
- one weekly block per Monday
- facility columns:
  - `Homewood`
  - `Oakridge`
  - `Rising Oaks`
  - `Plantation`
  - `Grande Cypress`
  - `Totals`

Recurring metric labels:

- `Goal`
- `Current AR`
- `Current Total Census`
- `Average Rent`
- `Uncollected AR Total`
- `SP Female Beds Open`
- `SP Male Beds Open`
- `SP Male or Female Beds Open`
- `Private Beds Open`
- `Total Beds Open`
- `Admissions Expected`
- `Total at the Hospital & Rehab`
- `Expected Discharges`
- `Call Outs Last Week`
- `Terminations Last Week`
- `Current Open Positions`
- `Overtime`
- `Tours Expected`
- `Activities on the calendar to be completed by Home Health Providers`
- `Outreach & Engagements (Providers, Facilities, Events)`

Interpretation:

- this is a **weekly operating standup packet**, not a call log
- some values are live operational facts
- some are explicit **forecast / commitment values**
- some are currently spreadsheet-only and need a first-class system of record

The spreadsheet is doing four jobs at once:

1. **Current-state reporting**
2. **Weekly planning / forecasting**
3. **Cross-facility comparison**
4. **Leadership narration**

The product must model those jobs separately instead of flattening them into one table.

---

## Current capability map

Status legend:

- **Built** — already captured and surfaced in the app or current tables
- **Derivable** — source data exists, but no explicit standup metric yet
- **Missing** — needs new capture/workflow/data model

| Standup area | Workbook metric | Current Haven status | Existing source(s) / UI | Notes |
|---|---|---|---|---|
| AR & Census | Goal | Missing | None | Standup uses per-facility AR targets not currently modeled as standup goals |
| AR & Census | Current AR | Built | Billing invoices / AR aging / org AR aging | Can be pulled from `invoices.balance_due` rollups |
| AR & Census | Current Total Census | Built | Residents, executive KPI snapshot, facilities API | Already computed via active residents / licensed beds |
| AR & Census | Average Rent | Derivable | `rate_schedules`, generated invoices, resident payer mix | Needs formal metric definition and computation |
| AR & Census | Uncollected AR Total | Built / Derivable | Open invoice balances | Likely same as or subset of current AR; definition needs owner confirmation in product copy |
| Bed Availability | SP Female Beds Open | Missing | No direct bed-gender inventory metric | Admission forms capture resident gender, but bed inventory does not currently model gender-eligible availability cleanly |
| Bed Availability | SP Male Beds Open | Missing | Same | Same gap |
| Bed Availability | SP Male or Female Beds Open | Missing | Same | Same gap |
| Bed Availability | Private Beds Open | Derivable / Missing | Rooms/beds, admissions accommodation quotes | Private/semi-private is partially implied, not consistently computed as live availability |
| Bed Availability | Total Beds Open | Derivable | Facilities totals + resident occupancy | Exists conceptually, needs standup presentation |
| Admissions | Admissions Expected | Missing | Referrals + admissions pipeline exist | Requires explicit expected-admission commitment field by week |
| Risk Management | Total at the Hospital & Rehab | Derivable / Partial | `residents.status in ('hospital_hold','loa')`, discharge workflows | Hospital hold exists; rehab may need clearer status semantics |
| Risk Management | Expected Discharges | Derivable / Missing | `discharge_target_date`, discharge reconciliation | Need explicit weekly standup rule or manual override |
| Staffing | Call Outs Last Week | Missing / Partial | Staff illness self-report, time records, discipline | No authoritative “callout event” model yet |
| Staffing | Terminations Last Week | Built / Derivable | `staff.termination_date`, `employment_status` | Exists in staff schema; not surfaced as standup metric yet |
| Staffing | Current Open Positions | Missing | None | No requisition / vacancy model exists yet |
| Staffing | Overtime | Built | `time_records.overtime_hours`, payroll/report executors | Already reportable; needs standup card and per-facility weekly window |
| Marketing | Tours Expected | Missing / Partial | `referral_leads.status`, tours in referral workflow | Tour states exist, but “expected this week” count is not captured explicitly |
| Marketing | Activities by Home Health Providers | Missing | None | Spreadsheet-only today |
| Marketing | Outreach & Engagements | Missing | None | Spreadsheet-only today |

---

## What the first plan was missing

The initial plan was directionally right, but it under-specified several things required for a world-class owner product:

### 1. Metric governance

The product needs a canonical metric registry, not just a dashboard query layer.

For every standup metric we need:

- business definition
- exact calculation logic
- time window
- source tables
- whether it is live, weekly, or manual
- whether totals are additive or derived
- who can override it

Without this, ownership will distrust the dashboard the first time a number differs from the spreadsheet.

### 2. Confidence and data quality

The owner needs to know whether a number is:

- fully automated
- partly manual
- stale
- missing
- overridden

This must appear visually in the dashboard and in the PDF pack.

### 3. Weekly workflow and approval

The product needs an operating workflow, not just storage:

- generate draft
- fill missing metrics
- review variances
- publish weekly pack
- archive immutable version

This should feel like a lightweight financial close / board-pack workflow.

### 4. Spreadsheet migration strategy

The product needs a bridge from the existing workbook:

- import historical weekly standup blocks into the new snapshot tables
- mark them as imported/manual lineage
- preserve continuity so charts and week-over-week comparisons work immediately

### 5. Board-quality PDF

The original plan said “board-style PDF,” but a world-class implementation needs:

- typography / spacing built for print
- summary page
- facility ranking page
- clear section breaks
- legends for manual/auto/confidence
- timestamp and sign-off metadata
- optional notes page

This should be rendered intentionally, not left to browser-print alone.

### 6. Actionability

The pack should not just show numbers. It should generate decisions:

- why the facility is red
- what changed since last week
- which lane needs intervention
- what to click next

### 7. Performance and snapshot semantics

This module must distinguish:

- **live dashboard reads** for current state
- **weekly frozen snapshot metrics** for standup history
- **render cache / PDF payload** for export speed

### 8. Ownership ergonomics

The owner should be able to use this during a call without hunting:

- one-click morning view
- compact executive mode
- print/share mode
- drill-through mode

---

## Revised product architecture

The standup product should be built as **four integrated layers**:

### Layer 1 — Live operating graph

Purpose:

- answer “what is true right now?”

Sources:

- billing
- residents / census
- facilities / beds
- referrals / admissions
- discharge
- staffing / time records
- compliance / incidents / infection

Output:

- live dashboard cards
- live facility ranking
- drill-through links

### Layer 2 — Weekly standup pack

Purpose:

- answer “what did leadership review for the week of Monday X?”

Properties:

- immutable after publish
- versioned
- printable
- historically comparable

Output:

- weekly frozen pack
- weekly trend lines
- archive / history browsing

### Layer 3 — Forecast and commitments

Purpose:

- handle non-observational metrics from the workbook

Examples:

- admissions expected
- expected discharges
- tours expected
- outreach commitments
- provider activity commitments

These are not “facts.” They are **forward-looking management inputs** and must be stored differently from live metrics.

### Layer 4 — Executive narrative and action engine

Purpose:

- tell the owner what changed, what matters, and what to do

Output:

- auto-generated summary
- facility pressure ranking
- exception explanations
- direct next actions

---

## Expanded data model

The original snapshot model should be extended with stronger metadata.

### Metric registry

```sql
CREATE TABLE exec_standup_metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  section_key text NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('currency','count','percent','hours','text')),
  source_mode text NOT NULL CHECK (source_mode IN ('auto','manual','hybrid','forecast')),
  aggregation_mode text NOT NULL CHECK (aggregation_mode IN ('sum','average','derived','manual')),
  time_grain text NOT NULL CHECK (time_grain IN ('live','daily','weekly')),
  facility_scope boolean NOT NULL DEFAULT true,
  total_scope boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### Snapshot publication workflow

Add to `exec_standup_snapshots`:

- `draft_notes`
- `review_notes`
- `published_version`
- `confidence_score`
- `completeness_pct`

### Forecast / commitment entries

Add explicit weekly planning rows:

```sql
CREATE TABLE exec_standup_forecast_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  week_of date NOT NULL,
  metric_key text NOT NULL,
  expected_value_numeric numeric(14,2),
  expected_value_text text,
  rationale text,
  entered_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT exec_standup_forecast_entries_unique UNIQUE (facility_id, week_of, metric_key)
);
```

This is critical because several workbook rows are forecast values, not measurements.

### Facility pressure scoring

Add a computed summary row or persisted snapshot field:

- `pressure_score`
- `pressure_band`
- `top_risks_json`

This powers the “rank my facilities by urgency” owner experience.

---

## Revised UX blueprint

### Dashboard modes

The product should have three distinct modes:

1. **Live mode**
   - current truth
   - exception queue
   - live drill-through

2. **Standup mode**
   - this week’s draft or published packet
   - editable/manual completion for missing values
   - compare vs previous week

3. **Board mode**
   - read-only presentation
   - PDF preview
   - share/export actions

### Landing layout

Top bar:

- reporting week selector
- scope selector
- draft/published status
- confidence / completeness indicator
- `Generate`, `Publish`, `Export PDF`

Hero strip:

- portfolio occupancy
- portfolio AR
- open beds
- expected admissions
- staffing pressure
- risk pressure

Facility board:

- facility cards sorted by pressure
- each card shows:
  - census
  - AR
  - open beds
  - expected admissions
  - hospital/rehab
  - callouts
  - overtime
  - top concern

Section tables:

- same mental model as workbook
- improved with variance, confidence, and drill-through

Narrative panel:

- what changed since last week
- where to intervene
- data quality warnings

### PDF structure

Board PDF should render as:

1. **Cover**
   - week
   - generated timestamp
   - organization
   - summary note

2. **Portfolio summary**
   - key metrics
   - top variances
   - top risks

3. **Facility ranking**
   - ranked by urgency / pressure score

4. **Section detail**
   - AR & census
   - bed availability
   - admissions
   - risk management
   - staffing
   - marketing / outreach

5. **Notes & action items**
   - optional manual commentary

### Presentation details

World-class expectations:

- no browser-default print styling
- no raw JSON-like tables
- explicit legend for:
  - automated
  - manual
  - forecast
  - stale
- typography designed for executive readability

---

## Revised metric strategy

Each workbook row should be classified into one of four types:

### A. Live truth

Examples:

- current AR
- current census
- hospital hold count
- overtime

Implementation:

- computed from source systems on demand
- optionally persisted into weekly snapshot

### B. Derived truth

Examples:

- total beds open
- average rent
- portfolio totals

Implementation:

- computed from source systems and metric definitions
- never manually entered except override with audit trail

### C. Forecast / commitment

Examples:

- admissions expected
- expected discharges
- tours expected

Implementation:

- entered by admin/operator
- approved if necessary
- explicitly labeled as forecast

### D. Manual standup-only tracking

Examples:

- provider activities
- outreach / engagements

Implementation:

- dedicated manual-entry model first
- then graduate into true modules later

This separation is essential to make the product trustworthy.

---

## Missing domain models to add

The first version listed missing metrics, but the revised roadmap needs explicit module extensions:

### Staffing attendance / callouts

Add:

- `staff_attendance_events`
- event types like `callout`, `late_callout`, `no_show`, `left_early`

Why:

- time records are insufficient to reconstruct “call outs last week” reliably

### Requisitions / open positions

Add:

- `staff_requisitions`
- status: `draft`, `open`, `interviewing`, `offered`, `filled`, `cancelled`

Why:

- “current open positions” requires a live vacancy object

### Tours and expected tours

Extend referrals:

- `tour_scheduled_for timestamptz`
- `tour_completed_at timestamptz`
- `tour_owner_user_id`

Why:

- current statuses are useful, but not enough for weekly expected-tour forecasting

### Outreach / engagement log

Add:

- `referral_outreach_activities`
- types: provider visit, facility outreach, event, digital outreach, home health coordination

Why:

- the spreadsheet treats this as weekly pipeline effort, not generic notes

### Home health provider activity log

Add:

- `provider_calendar_activities`
- per facility, date, provider, category, planned/completed

Why:

- this row is not modeled elsewhere and appears important to ownership

### Bed inventory classification

Extend bed/room model with:

- accommodation type
- occupancy flexibility
- gender suitability if operationally required

Why:

- current inventory can support totals, but not the exact spreadsheet bed-open breakdown

---

## Governance and trust model

This module will fail if the owner does not trust where the numbers came from.

Required:

- every standup metric shows source type
- every manually entered value is audited
- every override is attributed
- every published pack is immutable
- every PDF is reproducible from its snapshot data

Add UI affordances:

- `Source`
- `Last updated`
- `Lineage`
- `Manual note`
- `Confidence`

---

## Revised rollout plan

### Phase 0 — Metric contract and workbook migration

Before UI build:

- define every standup metric in the metric registry
- import historical workbook weeks
- flag imported rows as manual lineage
- validate totals and edge cases

Deliverables:

- metric registry seed
- workbook importer
- historical snapshots backfilled

### Phase 1 — Standup core

Build:

- standup route shell
- weekly snapshots
- manual/forecast entry UI
- side-by-side workbook section rendering
- basic PDF export

Success criteria:

- an admin can produce this week’s standup digitally without opening Excel

### Phase 2 — Auto-feed and trust

Build:

- feed built/derivable metrics automatically
- confidence badges
- source lineage panel
- publish workflow

Success criteria:

- majority of standup values are automated
- owner can see where each number comes from

### Phase 3 — World-class owner experience

Build:

- facility pressure ranking
- change-since-last-week narrative
- board-quality PDF
- executive “morning brief”
- one-click drill-throughs

Success criteria:

- owner prefers this over the spreadsheet

### Phase 4 — Missing operational models

Build:

- callout events
- requisitions
- outreach activities
- provider activities
- richer bed-availability model

Success criteria:

- spreadsheet-only manual rows collapse into structured data capture

### Phase 5 — Forecasting and intelligence

Build:

- predicted admission fill
- AR risk forecast
- staffing strain forecast
- suggested interventions

Success criteria:

- the product becomes an active decision engine, not a static packet

---

## Revised immediate recommendation

The best next execution slice is not only “snapshot foundation.” It should be:

**Standup 0A — Metric contract + historical import + snapshot foundation**

That slice should include:

- `exec_standup_metric_definitions`
- `exec_standup_snapshots`
- `exec_standup_snapshot_metrics`
- `exec_standup_manual_entries`
- `exec_standup_forecast_entries`
- workbook importer for historical data
- `/admin/executive/standup` initial shell

Why this is better:

- it avoids building a dashboard on top of undefined metrics
- it preserves continuity with the owner’s current reporting history
- it creates the trust layer early

---

## Final recommendation

Build this as the **flagship owner product** in Haven.

The world-class version is:

- a live executive command center
- a governed weekly standup workflow
- a board-quality PDF engine
- a trustable metric registry
- a historical operating archive
- a decision-support narrative layer

That is materially stronger than the initial plan and strong enough to replace the spreadsheet over time.

## What is already strong enough to reuse now

The following pieces already exist and should be reused rather than rebuilt:

### Executive layer

- `exec_metric_snapshots`
- `exec_alerts`
- `exec_saved_reports`
- executive overview, alerts, reports, benchmarks, settings
- print/export pattern in [`src/app/(admin)/executive/reports/page.tsx`](../../src/app/(admin)/executive/reports/page.tsx)
- live KPI loader in [`src/lib/exec-kpi-snapshot.ts`](../../src/lib/exec-kpi-snapshot.ts)

### Billing / AR

- invoice ledger
- AR aging
- org AR aging
- revenue views

### Census / occupancy

- facilities total licensed beds
- residents active / hospital hold / LOA status
- executive KPI census aggregates

### Admissions / referral pipeline

- `referral_leads`
- `admission_cases`
- referrals status model includes `tour_scheduled` and `tour_completed`
- referral and admissions hubs already exist

### Risk / discharge

- resident hospital-hold status
- discharge reconciliation and target dates

### Staffing / labor

- `time_records`
- `staffing_ratio_snapshots`
- `staff` table includes `employment_status`, `termination_date`, `termination_reason`
- overtime reporting executor already exists

---

## What must be built to replace the spreadsheet completely

### 1. Weekly standup snapshot layer

Need a first-class snapshot model so Monday standup values can be frozen.

Recommended tables:

```sql
CREATE TYPE exec_standup_metric_status AS ENUM ('auto', 'manual', 'estimated', 'missing');

CREATE TABLE exec_standup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  week_of date NOT NULL, -- Monday anchor
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES auth.users(id),
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_attachment_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE exec_standup_snapshot_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES exec_standup_snapshots(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid REFERENCES facilities(id),
  section_key text NOT NULL,
  metric_key text NOT NULL,
  metric_label text NOT NULL,
  value_numeric numeric(14,2),
  value_text text,
  totals_included boolean NOT NULL DEFAULT false,
  source_status exec_standup_metric_status NOT NULL DEFAULT 'auto',
  source_ref_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

### 2. Manual-entry bridge for missing metrics

Until all sources are modeled, admins need a controlled way to enter missing weekly numbers.

Recommended:

```sql
CREATE TABLE exec_standup_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  week_of date NOT NULL,
  section_key text NOT NULL,
  metric_key text NOT NULL,
  value_numeric numeric(14,2),
  value_text text,
  note text,
  entered_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT exec_standup_manual_entries_unique UNIQUE (facility_id, week_of, section_key, metric_key)
);
```

### 3. Missing system-of-record models

These need dedicated data capture if the spreadsheet is to disappear:

- **Expected admissions this week**
  - add weekly expected-move-in target on referral/admission pipeline or standup planning table
- **Call outs last week**
  - add explicit staff attendance / callout event table
- **Current open positions**
  - add requisitions / vacancies model
- **Tours expected**
  - add scheduled tour datetime / target week field
- **Home health provider activities**
  - add provider engagement / scheduled activity log
- **Outreach & engagements**
  - add outreach activity log (provider, facility, event, channel, date)
- **Bed type / gender availability**
  - formalize bed inventory classification rather than inferring from spreadsheets

---

## Product architecture

### A. Live dashboard

Route:

- `/admin/executive/standup`

Views:

- **Now**
  - current live operating state
- **This week**
  - current week standup draft
- **History**
  - published weekly standup snapshots

Top-level interactions:

- `Generate this week's standup`
- `Publish standup`
- `Export board PDF`
- `Compare to last week`
- `Show manual / missing metrics`

### B. Board-style PDF

Output should look like an ownership packet, not a browser printout.

Sections:

1. Cover summary
2. Portfolio-wide exception summary
3. Facility comparison table
4. Section-by-section metric detail
5. Change vs prior week
6. Open risks / management notes

Must include:

- timestamp
- reporting week
- scope
- generated by
- facility totals
- clearly marked manual values

### C. Narrative layer

For each published standup:

- auto-generate a short executive narrative
- identify biggest changes
- identify facilities needing intervention
- identify missing data quality issues

Example:

> Oakridge remains full with stable AR, while Plantation shows continued admissions pressure and no private-bed flex. Grande Cypress improved occupancy but still carries elevated staffing strain. Portfolio overtime remains manageable but callout tracking is still partially manual.

This should be **human reviewable** before PDF finalization.

---

## Moonshot UX direction

This should feel like a premium executive cockpit, not a reporting grid.

### Dashboard qualities

- exception-first
- facility ranking by urgency
- hover explanations for every KPI
- one-click drill-through to live module pages
- variance arrows and goal bars
- current / last week / trend-in-4-weeks side by side
- “manual” badges where inputs are still spreadsheet-originated

### Best-in-class additions

- **Owner Morning Brief** summary ribbon
- **What changed since last standup?**
- **Why is this red?**
- **If this continues, what happens next month?** forecast cards
- facility “pressure score”
- confidence indicator based on automated vs manual data share

### Interaction patterns

- click a facility to open a standup detail pane
- click a metric to open lineage/source facts
- click `Generate PDF` for a board deck
- click `Share snapshot` to email/download

---

## Recommended build phases

### Phase 1 — Spreadsheet replacement

Goal: replace the weekly Excel workflow with a digital equivalent.

Build:

- standup routes
- weekly snapshot tables
- manual-entry bridge
- exact section replication
- PDF export

Result:

- admins and owner can produce the same report without Excel

### Phase 2 — Automated feed-in

Goal: reduce manual entry.

Automate:

- current AR
- census
- occupancy / total beds open
- hospital hold counts
- terminations
- overtime
- referral pipeline / tour counts where possible

Result:

- hybrid report with manual values only where source systems are incomplete

### Phase 3 — Full operating system

Goal: surpass the spreadsheet materially.

Build:

- week-over-week change engine
- executive narrative
- facility urgency ranking
- source lineage
- alerts tied to standup deltas

### Phase 4 — Predictive layer

Goal: become the owner's default command center.

Build:

- forecast occupancy
- AR target risk projection
- staffing pressure forecast
- “admission shortfall” forecast

---

## Recommended access model

Read:

- `owner`
- `org_admin`
- `facility_admin` (facility-scoped or org-scoped view per policy)

Write manual entries:

- `owner`
- `org_admin`
- `facility_admin` for their own facilities

Publish weekly standup / export board pack:

- `owner`
- `org_admin`

---

## Concrete route plan

Add:

- `/admin/executive/standup`
- `/admin/executive/standup/history`
- `/admin/executive/standup/[week]`

Add mirrored short routes if needed through existing admin route-group pattern:

- `/executive/standup`
- `/executive/standup/history`

---

## Immediate build recommendation

The next executable slice should be:

**Standup Phase 1A — Snapshot foundation**

Includes:

- DB schema for snapshots + manual entries
- `/admin/executive/standup` shell
- workbook section rendering
- current built metric auto-feed
- placeholders for missing metrics

This gives ownership something credible quickly while preserving the path to a world-class system.

---

## Summary: built vs missing

Already strong:

- executive shell
- KPI and alert layer
- billing / AR
- census / occupancy
- referrals / tours statuses
- discharge workflows
- overtime / staffing ratio snapshots

Still required for full spreadsheet replacement:

- weekly snapshot system
- board PDF generator
- manual-entry bridge
- explicit expected admissions
- callout tracking
- open positions / requisitions
- provider activity tracking
- outreach / engagement tracking
- typed bed availability model

---

## Recommendation

Proceed with this as a **Module 24 extension** rather than a standalone feature. It belongs inside executive intelligence and reporting, but with its own dedicated owner workflow.

This is the highest-leverage executive feature in the repo after Track A because it directly converts an existing ownership habit into a better product surface.
