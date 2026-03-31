# 10 — Quality Metrics & Outcomes

**Dependencies:** All Phase 1 modules + all Phase 2 modules (03-adv, 06, 08, 09). This module reads from nearly every other table.
**Build Week:** 13-14 (concurrent with 03-advanced — the metrics calculation engine is independent of care plan tasks)
**Phase:** 2

This module does not create primary clinical data — it aggregates, scores, trends, and benchmarks data from all other modules into quality metrics. It is the accountability layer. It produces the numbers that go to the owner, the insurance carrier, the board, and eventually the public benchmarking system.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- QUALITY METRIC DEFINITIONS (what we measure — reference data)
-- ============================================================
CREATE TABLE quality_metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL UNIQUE,               -- "fall_rate_1000", "hospitalization_rate", "med_error_rate", "weight_loss_prevalence", etc.
  name text NOT NULL,                            -- "Fall Rate per 1,000 Resident Days"
  description text NOT NULL,
  category text NOT NULL,                        -- "safety", "clinical", "operational", "financial", "satisfaction"
  unit text NOT NULL,                            -- "per_1000_days", "percentage", "count", "days", "score"
  direction text NOT NULL,                       -- "lower_is_better", "higher_is_better"
  calculation_sql text,                          -- the SQL or description of how to calculate
  data_sources text[] NOT NULL,                  -- which tables feed this metric

  -- Thresholds
  good_threshold numeric(10,2),                  -- score at or better than this = "good"
  warning_threshold numeric(10,2),               -- between good and warning = "acceptable"; between warning and critical = "warning"
  critical_threshold numeric(10,2),              -- at or worse than this = "critical"

  -- Weighting for composite quality score
  composite_weight numeric(5,2) NOT NULL DEFAULT 1.0,

  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- QUALITY SCORES (calculated metric values per facility per period)
-- ============================================================
CREATE TABLE quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  metric_definition_id uuid NOT NULL REFERENCES quality_metric_definitions(id),

  period_type text NOT NULL,                     -- "daily", "weekly", "monthly", "quarterly", "annual"
  period_start date NOT NULL,
  period_end date NOT NULL,
  score numeric(10,4) NOT NULL,
  numerator numeric(10,2),                       -- for rate calculations: event count
  denominator numeric(10,2),                     -- for rate calculations: resident-days or total population

  status text NOT NULL,                          -- "good", "acceptable", "warning", "critical"
  previous_period_score numeric(10,4),
  trend text,                                    -- "improving", "stable", "declining"
  trend_pct_change numeric(8,2),                 -- percentage change from previous period

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_quality_scores_unique ON quality_scores(facility_id, metric_definition_id, period_type, period_start);
CREATE INDEX idx_quality_scores_facility ON quality_scores(facility_id, period_start DESC);
CREATE INDEX idx_quality_scores_metric ON quality_scores(metric_definition_id, period_start DESC);
CREATE INDEX idx_quality_scores_status ON quality_scores(facility_id, status) WHERE status IN ('warning', 'critical');

-- ============================================================
-- QUALITY COMPOSITE SCORES (facility-level aggregate quality score)
-- ============================================================
CREATE TABLE quality_composite_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  period_type text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  composite_score numeric(5,2) NOT NULL,         -- 0-100 weighted aggregate
  metrics_in_good integer NOT NULL,
  metrics_in_warning integer NOT NULL,
  metrics_in_critical integer NOT NULL,
  metrics_total integer NOT NULL,

  category_scores jsonb NOT NULL DEFAULT '{}',   -- {"safety": 87.5, "clinical": 92.0, "operational": 95.5, "financial": 88.0}
  top_improvements jsonb DEFAULT '[]',           -- metrics that improved most this period
  top_declines jsonb DEFAULT '[]',               -- metrics that declined most
  previous_composite numeric(5,2),
  trend text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_quality_composite_unique ON quality_composite_scores(facility_id, period_type, period_start);
CREATE INDEX idx_quality_composite_facility ON quality_composite_scores(facility_id, period_start DESC);

-- ============================================================
-- QIP PROJECTS (Quality Improvement Projects — PDSA cycles)
-- ============================================================
CREATE TABLE qip_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  title text NOT NULL,                           -- "Reduce Fall Rate on East Wing"
  description text NOT NULL,
  target_metric_id uuid REFERENCES quality_metric_definitions(id),
  baseline_value numeric(10,4),                  -- metric value at project start
  target_value numeric(10,4),                    -- desired metric value
  target_date date,

  status text NOT NULL DEFAULT 'planning',       -- "planning", "active", "completed", "suspended", "cancelled"
  started_at date,
  completed_at date,
  outcome_value numeric(10,4),                   -- actual metric value at completion
  outcome_met boolean,                           -- did we hit the target?

  owner_id uuid NOT NULL REFERENCES auth.users(id),  -- QIP project owner
  team_members uuid[],

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_qip_facility ON qip_projects(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_qip_active ON qip_projects(facility_id) WHERE deleted_at IS NULL AND status = 'active';

-- ============================================================
-- QIP PDSA CYCLES (individual Plan-Do-Study-Act cycles within a QIP)
-- ============================================================
CREATE TABLE qip_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qip_project_id uuid NOT NULL REFERENCES qip_projects(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  cycle_number integer NOT NULL,

  -- Plan
  plan_description text NOT NULL,                -- "Implement bedside rails check at every shift change for residents on East Wing"
  plan_hypothesis text,                          -- "Adding rails check will reduce unwitnessed falls by 30%"
  plan_date date NOT NULL,

  -- Do
  do_description text,                           -- what was actually implemented
  do_start_date date,
  do_end_date date,
  do_barriers text,                              -- what obstacles were encountered

  -- Study
  study_results text,                            -- what the data showed
  study_metric_value numeric(10,4),              -- metric value during this cycle
  study_comparison text,                         -- comparison to baseline
  study_date date,

  -- Act
  act_decision text,                             -- "adopt", "adapt", "abandon"
  act_description text,                          -- what action was taken based on results
  act_date date,

  status text NOT NULL DEFAULT 'plan',           -- "plan", "do", "study", "act", "completed"
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_qip_cycles_project ON qip_cycles(qip_project_id) WHERE deleted_at IS NULL;

-- ============================================================
-- SATISFACTION SURVEYS
-- ============================================================
CREATE TABLE satisfaction_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  survey_type text NOT NULL,                     -- "family", "resident", "staff"
  title text NOT NULL,
  description text,
  questions jsonb NOT NULL,                      -- [{"id": "q1", "text": "How satisfied are you with the care?", "type": "rating_1_5"}, {"id": "q2", "text": "Comments", "type": "text"}]
  is_active boolean NOT NULL DEFAULT true,
  anonymous boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE TABLE satisfaction_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES satisfaction_surveys(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  respondent_type text NOT NULL,                 -- "family", "resident", "staff"
  respondent_id uuid,                            -- NULL if anonymous
  resident_id uuid REFERENCES residents(id),     -- which resident this response relates to (family surveys)

  responses jsonb NOT NULL,                      -- {"q1": 4, "q2": "Very happy with the care team"}
  submitted_at timestamptz NOT NULL DEFAULT now(),

  -- Calculated
  overall_score numeric(5,2),                    -- average of all rating questions, scaled 0-100

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_satisfaction_responses_survey ON satisfaction_responses(survey_id);
CREATE INDEX idx_satisfaction_responses_facility ON satisfaction_responses(facility_id, submitted_at DESC);
```

---

## RLS POLICIES

```sql
ALTER TABLE quality_metric_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated see definitions" ON quality_metric_definitions FOR SELECT USING (true);

ALTER TABLE quality_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see quality scores" ON quality_scores FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE quality_composite_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see composite" ON quality_composite_scores FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE qip_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see QIPs" ON qip_projects FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Admin manage QIPs" ON qip_projects FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE qip_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see cycles" ON qip_cycles FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Admin manage cycles" ON qip_cycles FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE satisfaction_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see surveys" ON satisfaction_surveys FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()));
CREATE POLICY "Family see active surveys" ON satisfaction_surveys FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND is_active = true AND auth.app_role() = 'family');

ALTER TABLE satisfaction_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see responses" ON satisfaction_responses FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));
CREATE POLICY "Anyone can submit response" ON satisfaction_responses FOR INSERT
  WITH CHECK (organization_id = auth.organization_id());

-- Audit triggers
CREATE TRIGGER audit_qip_projects AFTER INSERT OR UPDATE OR DELETE ON qip_projects FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_qip_cycles AFTER INSERT OR UPDATE OR DELETE ON qip_cycles FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON qip_projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON qip_cycles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Metric Calculation Engine

**Runs daily at 3 AM ET (before compliance engine at 4 AM, so compliance can reference quality scores).**

Calculates each metric for: current day (daily), current week (weekly), current month (monthly).

| Metric Key | Calculation | Category | Unit | Thresholds (good / warning / critical) |
|-----------|------------|----------|------|---------------------------------------|
| `fall_rate_1000` | (falls in period / resident-days in period) × 1000 | safety | per_1000_days | ≤3.0 / ≤6.0 / >6.0 |
| `fall_with_injury_rate_1000` | (falls with injury / resident-days) × 1000 | safety | per_1000_days | ≤1.0 / ≤2.5 / >2.5 |
| `hospitalization_rate` | (hospital transfers / active residents) × 100 | clinical | percentage | ≤5% / ≤10% / >10% (monthly) |
| `readmission_rate_30day` | (readmissions within 30 days / discharges to hospital) × 100 | clinical | percentage | ≤15% / ≤25% / >25% |
| `infection_rate_1000` | (new infections / resident-days) × 1000 | clinical | per_1000_days | ≤2.0 / ≤4.0 / >4.0 |
| `med_error_rate_1000` | (medication errors / eMAR administrations) × 1000 | safety | per_1000_events | ≤1.0 / ≤3.0 / >3.0 |
| `elopement_count` | count of elopement incidents in period | safety | count | 0 / 1 / >1 (monthly) |
| `weight_loss_prevalence` | (residents with >5% weight loss in 30d / active residents) × 100 | clinical | percentage | ≤3% / ≤8% / >8% |
| `pressure_injury_prevalence` | (residents with active pressure injury / active residents) × 100 | clinical | percentage | ≤2% / ≤5% / >5% |
| `staff_turnover_annualized` | (terminations in period / avg headcount) × 12 (annualized for monthly calc) | operational | percentage | ≤15% / ≤30% / >30% |
| `staffing_ratio_compliance` | (compliant snapshots / total snapshots) × 100 | operational | percentage | ≥99% / ≥95% / <95% |
| `care_plan_review_compliance` | (reviews completed on time / reviews due) × 100 | clinical | percentage | ≥95% / ≥85% / <85% |
| `assessment_compliance` | (assessments completed on time / assessments due) × 100 | clinical | percentage | ≥95% / ≥85% / <85% |
| `emar_compliance` | (meds documented within window / total scheduled meds) × 100 | clinical | percentage | ≥98% / ≥95% / <95% |
| `incident_followup_compliance` | (followups completed on time / followups due) × 100 | operational | percentage | ≥95% / ≥85% / <85% |
| `occupancy_rate` | (occupied beds / total licensed beds) × 100 | financial | percentage | ≥90% / ≥80% / <80% |
| `ar_aging_over_60` | (AR over 60 days / total AR) × 100 | financial | percentage | ≤5% / ≤15% / >15% |
| `family_satisfaction` | average overall_score from satisfaction_responses (family type) in period | satisfaction | score | ≥85 / ≥70 / <70 |
| `complaint_rate` | (formal complaints / active residents) per month | satisfaction | count | ≤0.02 / ≤0.05 / >0.05 |

### Composite Quality Score Calculation

```
composite = Σ(metric_score × metric_weight) / Σ(metric_weights)

where metric_score is normalized to 0-100:
  - For "lower_is_better" metrics: score = max(0, 100 × (1 - (value - good_threshold) / (critical_threshold - good_threshold)))
  - For "higher_is_better" metrics: score = max(0, min(100, 100 × (value - critical_threshold) / (good_threshold - critical_threshold)))
```

Category weights for composite:
- Safety (fall_rate, med_error_rate, elopement): weight 1.5
- Clinical (hospitalization, infection, weight_loss, pressure_injury, care_plan_compliance, assessment_compliance): weight 1.3
- Operational (staffing, turnover, incident_followup): weight 1.0
- Financial (occupancy, AR aging): weight 0.8
- Satisfaction (family_satisfaction, complaint_rate): weight 1.0

### Insurance Carrier Report Generation

**Triggered manually or at renewal time (120 days before policy expiration).**

Produces a structured report containing:
1. Executive summary: composite quality score, trend direction, key improvements
2. Safety metrics: fall rates with 12-month trend, medication error rates, elopement count
3. Clinical metrics: hospitalization rate, infection rate with outbreak response summary, care plan compliance
4. Operational metrics: staffing compliance, staff turnover, training compliance (when Module 12 exists)
5. Risk management program summary: incident reporting timeliness, follow-up completion rates, mock survey results, compliance engine scores
6. Benchmark comparison: facility vs. organization average vs. (future) industry benchmark

This report is what Brian Lewis presents to Dan Myer at CRC Group to justify premium reduction at renewal. No ALF operator in America has this level of data.

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/facilities/:id/quality/dashboard` | Required | facility_admin, nurse, owner, org_admin | Quality dashboard: composite score, all metric scores, trends |
| GET | `/facilities/:id/quality/metrics` | Required | Same | Individual metric detail. Params: `metric_key`, `period_type`, `date_from`, `date_to` |
| GET | `/facilities/:id/quality/metrics/:metricKey/history` | Required | Same | Historical trend for a specific metric |
| GET | `/organizations/quality/dashboard` | Required | owner, org_admin | Cross-facility quality comparison |
| GET | `/organizations/quality/benchmark` | Required | owner, org_admin | Facility-vs-facility benchmarking |
| GET | `/facilities/:id/qip` | Required | facility_admin, nurse | List QIP projects |
| POST | `/facilities/:id/qip` | Required | facility_admin, nurse | Create QIP project |
| PUT | `/qip/:id` | Required | facility_admin, nurse | Update QIP |
| POST | `/qip/:id/cycles` | Required | facility_admin, nurse | Add PDSA cycle |
| PUT | `/qip-cycles/:id` | Required | facility_admin, nurse | Update PDSA cycle |
| GET | `/facilities/:id/satisfaction/surveys` | Required | facility_admin | List surveys |
| POST | `/facilities/:id/satisfaction/surveys` | Required | facility_admin | Create survey |
| POST | `/satisfaction-surveys/:id/respond` | Required | Any | Submit survey response |
| GET | `/facilities/:id/satisfaction/results` | Required | facility_admin, owner | Aggregated satisfaction results |
| POST | `/facilities/:id/quality/carrier-report` | Required | owner, org_admin, facility_admin | Generate insurance carrier quality report |

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `quality-metrics-calculator` | Cron (3 AM ET daily) | For each facility: calculate each active metric for daily/weekly/monthly periods. Store quality_scores. Calculate composite. Store quality_composite_scores. Identify trends. |
| `quality-alert-generator` | Part of metrics calculator | When a metric transitions from "good"/"acceptable" to "warning" or "critical" → generate notification to facility_admin and owner. When a metric improves from "critical"/"warning" to "good" → generate positive notification. |
| `carrier-report-generator` | POST /facilities/:id/quality/carrier-report | Compile all metric data for the requested period. Generate structured JSON report. (Phase 5: AI generates narrative prose from the data.) |

---

## SEED DATA — METRIC DEFINITIONS

```sql
INSERT INTO quality_metric_definitions (metric_key, name, description, category, unit, direction, data_sources, good_threshold, warning_threshold, critical_threshold, composite_weight, sort_order) VALUES
('fall_rate_1000', 'Fall Rate per 1,000 Resident Days', 'All falls (with and without injury) per 1,000 resident days', 'safety', 'per_1000_days', 'lower_is_better', ARRAY['incidents'], 3.0, 6.0, 9.0, 1.5, 1),
('fall_with_injury_rate_1000', 'Fall with Injury Rate per 1,000 Resident Days', 'Falls resulting in any injury per 1,000 resident days', 'safety', 'per_1000_days', 'lower_is_better', ARRAY['incidents'], 1.0, 2.5, 4.0, 1.5, 2),
('hospitalization_rate', 'Hospitalization Rate', 'Percentage of residents hospitalized in period', 'clinical', 'percentage', 'lower_is_better', ARRAY['residents', 'incidents'], 5.0, 10.0, 15.0, 1.3, 3),
('infection_rate_1000', 'Infection Rate per 1,000 Resident Days', 'New infections per 1,000 resident days', 'clinical', 'per_1000_days', 'lower_is_better', ARRAY['infections'], 2.0, 4.0, 6.0, 1.3, 4),
('med_error_rate_1000', 'Medication Error Rate per 1,000 Administrations', 'Medication errors per 1,000 eMAR administrations', 'safety', 'per_1000_events', 'lower_is_better', ARRAY['medication_errors', 'emar_records'], 1.0, 3.0, 5.0, 1.5, 5),
('elopement_count', 'Elopement Events', 'Count of elopement/wandering incidents', 'safety', 'count', 'lower_is_better', ARRAY['incidents'], 0, 1, 2, 1.5, 6),
('weight_loss_prevalence', 'Weight Loss Prevalence', 'Percentage of residents with significant weight loss (>5% in 30 days)', 'clinical', 'percentage', 'lower_is_better', ARRAY['assessments'], 3.0, 8.0, 12.0, 1.3, 7),
('staff_turnover_annualized', 'Annualized Staff Turnover', 'Annualized staff turnover rate', 'operational', 'percentage', 'lower_is_better', ARRAY['staff'], 15.0, 30.0, 50.0, 1.0, 8),
('staffing_ratio_compliance', 'Staffing Ratio Compliance', 'Percentage of staffing snapshots meeting minimum ratios', 'operational', 'percentage', 'higher_is_better', ARRAY['staffing_ratio_snapshots'], 99.0, 95.0, 90.0, 1.0, 9),
('care_plan_review_compliance', 'Care Plan Review Compliance', 'Percentage of care plan reviews completed on time', 'clinical', 'percentage', 'higher_is_better', ARRAY['care_plan_reviews'], 95.0, 85.0, 75.0, 1.3, 10),
('assessment_compliance', 'Assessment Compliance', 'Percentage of assessments completed on schedule', 'clinical', 'percentage', 'higher_is_better', ARRAY['assessment_schedules'], 95.0, 85.0, 75.0, 1.3, 11),
('emar_compliance', 'eMAR Documentation Compliance', 'Percentage of scheduled medications documented within window', 'clinical', 'percentage', 'higher_is_better', ARRAY['emar_records'], 98.0, 95.0, 90.0, 1.3, 12),
('incident_followup_compliance', 'Incident Follow-up Compliance', 'Percentage of incident follow-ups completed on time', 'operational', 'percentage', 'higher_is_better', ARRAY['incident_followups'], 95.0, 85.0, 75.0, 1.0, 13),
('occupancy_rate', 'Occupancy Rate', 'Percentage of licensed beds occupied', 'financial', 'percentage', 'higher_is_better', ARRAY['beds', 'residents'], 90.0, 80.0, 70.0, 0.8, 14),
('ar_aging_over_60', 'AR Aging Over 60 Days', 'Percentage of accounts receivable over 60 days past due', 'financial', 'percentage', 'lower_is_better', ARRAY['invoices'], 5.0, 15.0, 25.0, 0.8, 15),
('family_satisfaction', 'Family Satisfaction Score', 'Average family satisfaction survey score (0-100)', 'satisfaction', 'score', 'higher_is_better', ARRAY['satisfaction_responses'], 85.0, 70.0, 55.0, 1.0, 16);
```

---

## UI SCREENS

### Web (Admin/Owner)

| Screen | Route | Description |
|--------|-------|-------------|
| Quality Dashboard | `/facilities/:id/quality` | Large composite score gauge. Category breakdown (safety, clinical, operational, financial, satisfaction) with bar chart. Each metric shown as a card: current value, trend arrow, sparkline, status color. Click card → metric detail. |
| Metric Detail | `/facilities/:id/quality/metrics/:key` | Full-page view for one metric: line chart over time (30/90/365 day views), data table of contributing events (e.g., for fall_rate: list of falls), threshold lines on chart, comparison to org average. |
| Org Quality Overview | `/organization/quality` | All 5 facilities: composite scores side-by-side. Heatmap: facilities × metric categories. Identifies weakest metric across portfolio and strongest. Trend comparison. |
| QIP Manager | `/facilities/:id/quality/qip` | Active QIP project cards with progress (current PDSA cycle, metric trend since project start). Create new QIP button. Completed projects archive. |
| QIP Detail | `/qip/:id` | Project overview, PDSA cycle timeline (Plan → Do → Study → Act with status indicators), metric tracking chart showing baseline, target, and actual trajectory. |
| Satisfaction Results | `/facilities/:id/quality/satisfaction` | Survey response rates, average scores by question, trend over time, word cloud or summary of text responses. |
| Insurance Carrier Report | `/facilities/:id/quality/carrier-report` | Generate report button. Preview of report content. Download as PDF. Last generated date. |
| Org Quality Comparison | `/organization/quality/compare` | Drag-and-drop: select 2-5 facilities, select metrics to compare. Side-by-side charts. Identifies best practices at top-performing facilities that could transfer to others. |
