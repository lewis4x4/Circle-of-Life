# 08 — Autonomous Compliance Engine

**Dependencies:** All Phase 1 modules (00, 03, 04, 07, 11, 16), 03-advanced, 06-medication-management
**Build Week:** 17-18
**Phase:** 2

This is the module that makes Haven fundamentally different from every other ALF platform. Compliance is not a feature you log into — it is a continuous, invisible process that evaluates every piece of documentation against every applicable Florida ALF regulation in real time. The facility doesn't prepare for surveys. It's always survey-ready because compliance is a byproduct of the platform's operation.

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- SURVEY TAGS (Florida AHCA ALF survey standards — reference data)
-- ============================================================
CREATE TABLE survey_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_number text NOT NULL UNIQUE,               -- "120", "220", "320" etc.
  tag_title text NOT NULL,                       -- "Resident Rights", "Personal Care", "Staffing"
  tag_category text NOT NULL,                    -- "resident_rights", "personal_care", "health_care", "dietary", "physical_plant", "administration", "staffing", "emergency_preparedness", "medication"
  description text NOT NULL,                     -- full regulatory text
  regulatory_reference text NOT NULL,            -- "59A-36.007(1)" Florida Administrative Code
  survey_frequency text,                         -- "every_survey", "sample_based", "triggered"
  deficiency_class text,                         -- "I" (most serious), "II", "III", "IV" (least serious)

  -- Compliance evaluation rules
  evaluation_type text NOT NULL,                 -- "documentation", "observation", "interview", "calculation", "composite"
  evaluation_rules jsonb NOT NULL,               -- machine-readable rules for automated evaluation
  -- Example for Tag 220 (Personal Care):
  -- {
  --   "checks": [
  --     {"name": "care_plan_current", "table": "care_plans", "condition": "status = 'active' AND review_due_date >= CURRENT_DATE", "per": "resident", "required": true},
  --     {"name": "adl_documented_daily", "table": "adl_logs", "condition": "EXISTS for each active resident for each day in last 7 days", "per": "resident", "required": true},
  --     {"name": "care_plan_items_match_assessments", "description": "Active care plan items reflect current assessment findings", "evaluation": "manual_review_flag", "required": true}
  --   ],
  --   "pass_threshold": 0.95
  -- }

  data_sources text[],                           -- which tables/modules feed this tag: ["care_plans", "adl_logs", "assessments"]
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_survey_tags_category ON survey_tags(tag_category) WHERE is_active = true;
CREATE INDEX idx_survey_tags_number ON survey_tags(tag_number);

-- ============================================================
-- COMPLIANCE SCORES (per tag, per facility, continuously updated)
-- ============================================================
CREATE TABLE compliance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  survey_tag_id uuid NOT NULL REFERENCES survey_tags(id),

  score_date date NOT NULL,
  score numeric(5,2) NOT NULL,                   -- 0.00 to 100.00
  passing boolean NOT NULL,                      -- score >= pass_threshold from survey_tag
  total_checks integer NOT NULL,
  passed_checks integer NOT NULL,
  failed_checks integer NOT NULL,

  failed_items jsonb NOT NULL DEFAULT '[]',
  -- [{"check_name": "care_plan_current", "resident_id": "uuid", "resident_name": "Johnson, Margaret", "detail": "Care plan review overdue by 12 days"}]

  previous_score numeric(5,2),                   -- yesterday's score for trend
  score_trend text,                              -- "improving", "stable", "declining"

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_scores_facility ON compliance_scores(facility_id, score_date DESC);
CREATE INDEX idx_compliance_scores_tag ON compliance_scores(facility_id, survey_tag_id, score_date DESC);
CREATE INDEX idx_compliance_scores_failing ON compliance_scores(facility_id, score_date) WHERE passing = false;
CREATE UNIQUE INDEX idx_compliance_scores_unique ON compliance_scores(facility_id, survey_tag_id, score_date);

-- ============================================================
-- COMPLIANCE COMPOSITE SCORE (facility-level daily aggregate)
-- ============================================================
CREATE TABLE compliance_composite_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  score_date date NOT NULL,
  composite_score numeric(5,2) NOT NULL,         -- weighted average of all tag scores
  tags_passing integer NOT NULL,
  tags_failing integer NOT NULL,
  tags_total integer NOT NULL,

  -- Breakdown by category
  category_scores jsonb NOT NULL DEFAULT '{}',
  -- {"resident_rights": 98.5, "personal_care": 92.3, "health_care": 88.7, "dietary": 100.0, "physical_plant": 95.0, "administration": 97.2, "staffing": 100.0, "emergency_preparedness": 90.0, "medication": 94.5}

  top_risks jsonb NOT NULL DEFAULT '[]',         -- top 5 failing items sorted by impact
  -- [{"tag_number": "220", "tag_title": "Personal Care", "score": 85.0, "failed_count": 3, "detail": "3 residents with overdue care plan reviews"}]

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_composite_scores_facility ON compliance_composite_scores(facility_id, score_date DESC);
CREATE UNIQUE INDEX idx_composite_scores_unique ON compliance_composite_scores(facility_id, score_date);

-- ============================================================
-- COMPLIANCE GAP ALERTS (specific actionable items)
-- ============================================================
CREATE TABLE compliance_gap_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  survey_tag_id uuid NOT NULL REFERENCES survey_tags(id),

  alert_type text NOT NULL,                      -- "gap_new" (newly failed), "gap_persistent" (failed 3+ consecutive days), "gap_approaching" (will fail within 7 days at current trajectory)
  severity text NOT NULL,                        -- "info", "warning", "critical"
  title text NOT NULL,
  description text NOT NULL,
  affected_resident_id uuid REFERENCES residents(id),  -- NULL if facility-wide issue
  affected_resident_name text,

  -- Specific remediation instructions
  remediation_action text NOT NULL,              -- "Complete care plan review for Mrs. Johnson (overdue 12 days)"
  remediation_deadline date,                     -- when this must be fixed to avoid survey risk
  assigned_to uuid REFERENCES auth.users(id),

  status text NOT NULL DEFAULT 'open',           -- "open", "acknowledged", "in_progress", "resolved"
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_notes text,

  -- Auto-resolution: when the underlying data is fixed, the system resolves the alert
  auto_resolved boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_gap_alerts_facility ON compliance_gap_alerts(facility_id) WHERE deleted_at IS NULL AND status != 'resolved';
CREATE INDEX idx_gap_alerts_tag ON compliance_gap_alerts(facility_id, survey_tag_id) WHERE deleted_at IS NULL AND status != 'resolved';
CREATE INDEX idx_gap_alerts_assigned ON compliance_gap_alerts(assigned_to) WHERE deleted_at IS NULL AND status IN ('open', 'acknowledged', 'in_progress');
CREATE INDEX idx_gap_alerts_severity ON compliance_gap_alerts(facility_id, severity) WHERE deleted_at IS NULL AND status != 'resolved';

-- ============================================================
-- MOCK SURVEYS (AI-powered survey simulations)
-- ============================================================
CREATE TABLE mock_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  survey_date date NOT NULL,
  initiated_by uuid NOT NULL REFERENCES auth.users(id),
  survey_type text NOT NULL,                     -- "full" (all tags), "focused" (specific category), "quick" (top risk tags only)
  survey_scope text,                             -- if focused: which category

  -- Sampling (mimics how real surveyors work)
  residents_sampled uuid[] NOT NULL,             -- randomly selected subset of active residents
  sample_size integer NOT NULL,
  total_active_residents integer NOT NULL,

  status text NOT NULL DEFAULT 'running',        -- "running", "completed", "failed"
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  -- Results
  overall_score numeric(5,2),
  tags_evaluated integer,
  tags_passing integer,
  tags_failing integer,
  findings jsonb DEFAULT '[]',
  -- [{"tag_number": "220", "tag_title": "Personal Care", "finding": "Resident Johnson: care plan review overdue 12 days", "severity": "Class III", "resident_id": "uuid"}]

  recommendations jsonb DEFAULT '[]',
  -- [{"finding_index": 0, "recommendation": "Complete care plan review within 48 hours", "priority": "high"}]

  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_mock_surveys_facility ON mock_surveys(facility_id, survey_date DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- POLICIES & PROCEDURES (version-controlled facility policies)
-- ============================================================
CREATE TABLE facility_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id),    -- NULL = organization-wide policy
  organization_id uuid NOT NULL REFERENCES organizations(id),

  policy_number text NOT NULL,                   -- "POL-001", "POL-ADM-003"
  title text NOT NULL,                           -- "Fall Prevention Policy"
  category text NOT NULL,                        -- "clinical", "administrative", "safety", "infection_control", "dietary", "human_resources", "emergency", "medication", "resident_rights"
  current_version integer NOT NULL DEFAULT 1,
  content text NOT NULL,                         -- full policy text (markdown)
  effective_date date NOT NULL,
  review_due_date date NOT NULL,                 -- policies must be reviewed annually
  last_reviewed_at date,
  last_reviewed_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,

  linked_survey_tags text[],                     -- which survey tags this policy supports: ["120", "220"]
  status text NOT NULL DEFAULT 'active',         -- "draft", "active", "under_review", "retired"

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_policies_facility ON facility_policies(facility_id) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_policies_org ON facility_policies(organization_id) WHERE deleted_at IS NULL AND status = 'active' AND facility_id IS NULL;
CREATE INDEX idx_policies_review_due ON facility_policies(review_due_date) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_policies_category ON facility_policies(category) WHERE deleted_at IS NULL AND status = 'active';

-- ============================================================
-- POLICY ACKNOWLEDGMENTS (staff must acknowledge policies)
-- ============================================================
CREATE TABLE policy_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES facility_policies(id),
  policy_version integer NOT NULL,
  staff_id uuid NOT NULL REFERENCES staff(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  acknowledgment_method text NOT NULL DEFAULT 'electronic', -- "electronic", "paper_on_file"

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_policy_acks_policy ON policy_acknowledgments(policy_id, policy_version);
CREATE INDEX idx_policy_acks_staff ON policy_acknowledgments(staff_id);
CREATE UNIQUE INDEX idx_policy_acks_unique ON policy_acknowledgments(policy_id, policy_version, staff_id);

-- ============================================================
-- ACTUAL SURVEY RECORDS (when AHCA actually surveys the facility)
-- ============================================================
CREATE TABLE actual_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  survey_date_start date NOT NULL,
  survey_date_end date,
  survey_type text NOT NULL,                     -- "annual", "biennial", "complaint", "follow_up", "change_of_ownership"
  surveyor_names text[],
  agency text NOT NULL DEFAULT 'AHCA',

  -- Results
  deficiency_free boolean,
  total_deficiencies integer DEFAULT 0,
  class_i_count integer DEFAULT 0,
  class_ii_count integer DEFAULT 0,
  class_iii_count integer DEFAULT 0,
  class_iv_count integer DEFAULT 0,

  plan_of_correction_due_date date,
  plan_of_correction_submitted boolean DEFAULT false,
  plan_of_correction_submitted_at timestamptz,
  plan_of_correction_accepted boolean,
  follow_up_survey_date date,

  survey_report_document_id uuid,                -- uploaded survey report
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_actual_surveys_facility ON actual_surveys(facility_id, survey_date_start DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- SURVEY DEFICIENCIES (individual deficiency citations)
-- ============================================================
CREATE TABLE survey_deficiencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actual_survey_id uuid NOT NULL REFERENCES actual_surveys(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  survey_tag_id uuid REFERENCES survey_tags(id),

  tag_number text NOT NULL,
  deficiency_class text NOT NULL,                -- "I", "II", "III", "IV"
  description text NOT NULL,                     -- surveyor's written deficiency
  scope text,                                    -- "isolated", "pattern", "widespread"
  residents_affected text[],                     -- resident identifiers mentioned

  -- Plan of Correction
  plan_of_correction text,
  poc_submitted_date date,
  poc_target_completion_date date,
  poc_actual_completion_date date,
  poc_responsible_person text,
  poc_monitoring_plan text,

  -- Corrective actions tracking
  corrective_actions jsonb DEFAULT '[]',
  -- [{"action": "Revised fall prevention policy", "completed_date": "2026-05-01", "completed_by": "uuid", "evidence": "Updated policy document POL-003 v2"}]

  -- Fine/penalty
  fine_amount integer DEFAULT 0,                 -- cents
  fine_paid boolean DEFAULT false,
  fine_paid_date date,

  status text NOT NULL DEFAULT 'cited',          -- "cited", "poc_submitted", "poc_accepted", "corrected", "verified"

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_deficiencies_survey ON survey_deficiencies(actual_survey_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_deficiencies_facility ON survey_deficiencies(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_deficiencies_open ON survey_deficiencies(facility_id) WHERE deleted_at IS NULL AND status NOT IN ('corrected', 'verified');
```

---

## RLS POLICIES

```sql
-- Survey tags are reference data
ALTER TABLE survey_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated users read tags" ON survey_tags FOR SELECT USING (true);

ALTER TABLE compliance_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see compliance scores" ON compliance_scores FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE compliance_composite_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see composite scores" ON compliance_composite_scores FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE compliance_gap_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see gap alerts" ON compliance_gap_alerts FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Nurse+ manage gap alerts" ON compliance_gap_alerts FOR UPDATE
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE mock_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see mock surveys" ON mock_surveys FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

ALTER TABLE facility_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see active policies" ON facility_policies FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND status = 'active' AND (facility_id IS NULL OR facility_id IN (SELECT auth.accessible_facility_ids())));
CREATE POLICY "Admin manage policies" ON facility_policies FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE policy_acknowledgments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see own acks" ON policy_acknowledgments FOR SELECT
  USING (organization_id = auth.organization_id() AND (staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid()) OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin')));
CREATE POLICY "Staff create own acks" ON policy_acknowledgments FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid()));

ALTER TABLE actual_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see actual surveys" ON actual_surveys FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Admin manage actual surveys" ON actual_surveys FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE survey_deficiencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin see deficiencies" ON survey_deficiencies FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Admin manage deficiencies" ON survey_deficiencies FOR ALL
  USING (organization_id = auth.organization_id() AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

-- Audit triggers
CREATE TRIGGER audit_compliance_gap_alerts AFTER INSERT OR UPDATE OR DELETE ON compliance_gap_alerts FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_facility_policies AFTER INSERT OR UPDATE OR DELETE ON facility_policies FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_actual_surveys AFTER INSERT OR UPDATE OR DELETE ON actual_surveys FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_survey_deficiencies AFTER INSERT OR UPDATE OR DELETE ON survey_deficiencies FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON compliance_gap_alerts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON facility_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON actual_surveys FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON survey_deficiencies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Continuous Compliance Scoring Engine

**Runs daily at 4 AM ET.** For each facility, for each active survey_tag:

The engine reads the `evaluation_rules` JSON from the survey_tag and executes each check against live data.

**Automatable checks (evaluated programmatically):**

| Tag Category | Check | Data Source | Rule |
|-------------|-------|-------------|------|
| Personal Care | Care plans current | `care_plans` | Every active resident has an active care plan with review_due_date ≥ today |
| Personal Care | ADLs documented daily | `adl_logs` | Every active resident has ≥1 ADL log entry per day for last 7 days |
| Personal Care | Assessments current | `assessment_schedules` | No assessment_schedule with next_due_date < today |
| Health Care | Physician orders transcribed | `physician_orders` | No orders with status='received' older than 24 hours |
| Health Care | Verbal orders co-signed | `physician_orders` | No verbal orders past co-signature deadline |
| Medication | eMAR documented | `emar_records` | No scheduled medications with status='scheduled' older than 2 hours past scheduled_time |
| Medication | PRN effectiveness documented | `emar_records` | No PRN given without effectiveness check documented within required timeframe |
| Medication | Controlled substance counts current | `controlled_substance_counts` | Every controlled medication has a count record for the most recent shift change |
| Medication | Medication errors investigated | `medication_errors` | No medication errors with status='open' older than 72 hours |
| Staffing | Staffing ratios met | `staffing_ratio_snapshots` | No non-compliant ratio snapshots in last 24 hours |
| Staffing | Certifications current | `staff_certifications` | No active staff with expired required certifications |
| Staffing | Training current | `staff_training` (Module 12, Phase 6) | All required annual training complete. (Until Module 12 exists: check staff_certifications for training-type certs) |
| Emergency Prep | Fire drills documented | `emergency_drills` (from facility_policies linked records) | Fire drill documented within last 30 days |
| Emergency Prep | Generator tested | Same | Generator test documented within last 30 days |
| Incident Mgmt | Incident follow-ups complete | `incident_followups` | No overdue follow-up tasks |
| Incident Mgmt | Reportable incidents reported | `incidents` | No incidents where ahca_reportable=true AND ahca_reported=false |
| Dietary | Weight monitoring current | `weight_records` | Every resident weighed within last 30 days (7 days if at-risk) |
| Billing/Admin | Resident agreements on file | `resident_documents` | Every active resident has document_type='admission_agreement' |

**Score calculation per tag:**
```
score = (passed_checks / total_checks) × 100
passing = score >= survey_tag.pass_threshold (default 95%)
```

**Composite score per facility:**
```
composite = weighted_average(all_tag_scores)
weights: resident_rights=1.0, personal_care=1.5, health_care=1.5, medication=1.5, staffing=1.2, emergency_preparedness=1.0, dietary=1.0, administration=0.8, physical_plant=1.0
```

### Gap Alert Generation

After scoring, for each failed check:

1. If the check was passing yesterday and failing today → alert_type="gap_new", severity="warning"
2. If the check has been failing for 3+ consecutive days → alert_type="gap_persistent", severity="critical"
3. Predictive: if a check will fail within 7 days at current trajectory (e.g., care plan review due in 5 days, no review started) → alert_type="gap_approaching", severity="info"

**Auto-resolution:** When the underlying data is corrected (care plan reviewed, assessment completed, etc.), the next scoring run detects the fix and sets compliance_gap_alert status='resolved', auto_resolved=true.

### Mock Survey Engine

**Triggered manually or on schedule (configurable: weekly, biweekly, monthly).**

1. Randomly select N residents from the active population (N = sample_size, configurable, default = 5 or 10% of census, whichever is larger)
2. For each sampled resident, evaluate all applicable survey tags against their specific data
3. For each tag, document findings as if a surveyor were reviewing
4. Generate findings list with: tag cited, resident affected, specific deficiency description, severity classification
5. Generate recommendations for each finding with priority ranking

This produces a report that mirrors what an actual AHCA survey would produce — allowing the administrator to fix issues before the real surveyor arrives.

### Policy Management

- Policies are version-controlled. When a policy is updated, `current_version` increments.
- When a new version is published, all staff at the facility (or org-wide for org policies) must re-acknowledge.
- Staff who have not acknowledged the current version are flagged on the compliance dashboard.
- Policy review_due_date defaults to effective_date + 365 days (annual review requirement).
- 60/30-day alerts for upcoming policy reviews.

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/facilities/:id/compliance/dashboard` | Required | facility_admin, nurse, owner, org_admin | Composite score, category breakdown, top risks, trend chart |
| GET | `/facilities/:id/compliance/scores` | Required | Same | Detailed per-tag scores. Params: `date`, `category` |
| GET | `/facilities/:id/compliance/scores/history` | Required | Same | Score history for trend charts. Params: `tag_id`, `date_from`, `date_to` |
| GET | `/organizations/compliance/dashboard` | Required | owner, org_admin | Cross-facility compliance comparison |
| GET | `/facilities/:id/compliance/gap-alerts` | Required | facility_admin, nurse, owner, org_admin | Active gap alerts |
| PUT | `/gap-alerts/:id/acknowledge` | Required | nurse, facility_admin | Acknowledge alert |
| PUT | `/gap-alerts/:id/resolve` | Required | nurse, facility_admin | Resolve with notes |
| POST | `/facilities/:id/mock-survey` | Required | facility_admin, owner, org_admin | Trigger mock survey |
| GET | `/mock-surveys/:id` | Required | facility_admin, nurse, owner, org_admin | Mock survey results |
| GET | `/facilities/:id/mock-surveys` | Required | Same | Mock survey history |
| GET | `/facilities/:id/policies` | Required | All staff | List active policies |
| GET | `/policies/:id` | Required | All staff | Policy detail |
| POST | `/policies` | Required | facility_admin, owner, org_admin | Create policy |
| PUT | `/policies/:id` | Required | facility_admin, owner, org_admin | Update policy (creates new version) |
| POST | `/policies/:id/acknowledge` | Required | Staff | Acknowledge policy |
| GET | `/facilities/:id/policies/unacknowledged` | Required | facility_admin | Staff who haven't acknowledged current policies |
| GET | `/facilities/:id/actual-surveys` | Required | facility_admin, owner, org_admin | Survey history |
| POST | `/actual-surveys` | Required | facility_admin | Record actual survey |
| GET | `/actual-surveys/:id` | Required | facility_admin, owner, org_admin | Survey detail with deficiencies |
| POST | `/actual-surveys/:id/deficiencies` | Required | facility_admin | Add deficiency citation |
| PUT | `/survey-deficiencies/:id` | Required | facility_admin | Update deficiency (add POC, track correction) |

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `compliance-scoring-engine` | Cron (4 AM ET daily) | For each facility: evaluate every active survey_tag against live data. Store compliance_scores. Calculate and store compliance_composite_scores. Generate/update/auto-resolve compliance_gap_alerts. |
| `compliance-gap-escalation` | Part of scoring engine | After scoring: identify new failures, persistent failures, and approaching failures. Generate appropriate gap_alerts with assigned remediation actions. |
| `mock-survey-runner` | POST /facilities/:id/mock-survey | Select random resident sample, evaluate all applicable tags for sampled residents, generate findings and recommendations, store results. |
| `policy-review-reminder` | Cron (daily 7 AM ET) | Scan facility_policies for review_due_date within 60/30 days. Generate alerts to facility_admin. |
| `policy-acknowledgment-check` | INSERT on facility_policies (new version) | Identify all staff who need to acknowledge the new version. Generate notification to each. Flag unacknowledged staff on compliance dashboard. |

---

## SEED DATA — FLORIDA ALF SURVEY TAGS

The survey_tags table must be seeded with the complete Florida AHCA ALF survey tag set. Below is the minimum viable set for Phase 2 covering the most commonly cited tags:

```sql
INSERT INTO survey_tags (tag_number, tag_title, tag_category, description, regulatory_reference, evaluation_type, evaluation_rules, data_sources, sort_order) VALUES
-- Resident Rights
('120', 'Resident Rights — Notification', 'resident_rights', 'Facility shall inform residents of their rights upon admission and post rights in a conspicuous location', '59A-36.007(1)', 'documentation', '{"checks": [{"name": "rights_documented_at_admission", "table": "resident_documents", "condition": "document_type = ''admission_agreement'' exists for each active resident", "per": "resident", "required": true}], "pass_threshold": 100}', ARRAY['resident_documents'], 1),

-- Personal Care
('220', 'Personal Care Services', 'personal_care', 'Facility shall provide personal care services as identified in the resident care plan', '59A-36.010', 'documentation', '{"checks": [{"name": "care_plan_current", "table": "care_plans", "condition": "active care plan with review_due_date >= CURRENT_DATE", "per": "resident", "required": true}, {"name": "adl_documented_daily", "table": "adl_logs", "condition": "at least 1 ADL log per resident per day for last 7 days", "per": "resident", "required": true}, {"name": "assessments_current", "table": "assessment_schedules", "condition": "no overdue assessments", "per": "resident", "required": true}], "pass_threshold": 95}', ARRAY['care_plans', 'adl_logs', 'assessment_schedules'], 2),

-- Medication
('320', 'Medication Practices', 'medication', 'Facility shall ensure proper medication assistance, storage, and documentation', '59A-36.014', 'documentation', '{"checks": [{"name": "emar_documented", "table": "emar_records", "condition": "no scheduled medications missed >2 hours", "per": "facility", "required": true}, {"name": "prn_effectiveness", "table": "emar_records", "condition": "all PRN meds have effectiveness documented", "per": "facility", "required": true}, {"name": "controlled_counts_current", "table": "controlled_substance_counts", "condition": "counts current for most recent shift change", "per": "facility", "required": true}, {"name": "physician_orders_transcribed", "table": "physician_orders", "condition": "no untranscribed orders older than 24h", "per": "facility", "required": true}], "pass_threshold": 95}', ARRAY['emar_records', 'controlled_substance_counts', 'physician_orders'], 3),

-- Staffing
('420', 'Staffing Requirements', 'staffing', 'Facility shall maintain minimum staffing ratios per shift', '59A-36.011', 'calculation', '{"checks": [{"name": "ratios_met", "table": "staffing_ratio_snapshots", "condition": "is_compliant = true for all snapshots in last 24 hours", "per": "facility", "required": true}, {"name": "certifications_current", "table": "staff_certifications", "condition": "no active staff with expired required certifications", "per": "facility", "required": true}], "pass_threshold": 100}', ARRAY['staffing_ratio_snapshots', 'staff_certifications'], 4),

-- Health Care
('520', 'Health Care Monitoring', 'health_care', 'Facility shall monitor and document changes in resident condition and notify physician as appropriate', '59A-36.010(3)', 'documentation', '{"checks": [{"name": "condition_changes_responded", "table": "condition_changes", "condition": "all significant condition changes have physician notification within required timeframe", "per": "facility", "required": true}, {"name": "incident_followups_complete", "table": "incident_followups", "condition": "no overdue follow-up tasks", "per": "facility", "required": true}, {"name": "weights_current", "table": "assessments", "condition": "all residents weighed within 30 days (7 if at-risk)", "per": "resident", "required": true}], "pass_threshold": 95}', ARRAY['condition_changes', 'incident_followups', 'assessments'], 5),

-- Emergency Preparedness
('620', 'Emergency Preparedness', 'emergency_preparedness', 'Facility shall maintain and test emergency procedures', '59A-36.015', 'documentation', '{"checks": [{"name": "fire_drill_current", "description": "Fire drill documented within last 30 days", "evaluation": "manual_check_or_linked_record", "required": true}, {"name": "generator_test_current", "description": "Generator test documented within last 30 days", "evaluation": "manual_check_or_linked_record", "required": true}], "pass_threshold": 100}', ARRAY['facility_policies'], 6),

-- Dietary
('720', 'Dietary Services', 'dietary', 'Facility shall provide nutritionally adequate meals and accommodate therapeutic diets', '59A-36.012', 'documentation', '{"checks": [{"name": "weights_monitored", "table": "assessments", "condition": "all residents weighed per schedule", "per": "resident", "required": true}, {"name": "diet_orders_current", "table": "residents", "condition": "diet_order field populated for all active residents", "per": "resident", "required": true}], "pass_threshold": 95}', ARRAY['assessments', 'residents'], 7),

-- Incident Management
('820', 'Incident Reporting', 'administration', 'Facility shall report incidents as required and implement corrective actions', '59A-36.019', 'documentation', '{"checks": [{"name": "reportable_incidents_reported", "table": "incidents", "condition": "no incidents where ahca_reportable=true AND ahca_reported=false", "per": "facility", "required": true}, {"name": "incident_followups_complete", "table": "incident_followups", "condition": "no overdue follow-up tasks", "per": "facility", "required": true}], "pass_threshold": 100}', ARRAY['incidents', 'incident_followups'], 8);
```

**NOTE:** This is a starter set. The full AHCA ALF survey instrument has 50+ tags. Expand this seed data iteratively, prioritizing the most commonly cited tags based on actual Florida survey data. An AHCA consultant should review and expand this list before pilot launch.

---

## UI SCREENS

### Web (Admin/Nurse)

| Screen | Route | Description |
|--------|-------|-------------|
| Compliance Dashboard | `/facilities/:id/compliance` | Composite score gauge (large, prominent). Category breakdown bar chart. Score trend line (last 90 days). Top 5 risk items with remediation actions. Gap alert count by severity. Link to mock survey. |
| Compliance Detail by Tag | `/facilities/:id/compliance/tag/:tagId` | Individual tag score, check-by-check breakdown, affected residents listed, historical score trend, linked policies. |
| Org Compliance Overview | `/organization/compliance` | All 5 facilities side-by-side: composite scores, category heatmap (facilities as rows, categories as columns, cells colored by score). Identifies the weakest facility and weakest category across the portfolio. |
| Gap Alert Queue | `/facilities/:id/compliance/gaps` | Sortable list: severity, tag, description, affected resident, remediation action, days open. Acknowledge/resolve buttons. Filter: open, acknowledged, in_progress. |
| Mock Survey | `/facilities/:id/compliance/mock-survey` | Trigger button (full, focused, quick). Results view: findings list, severity distribution, recommendations, comparison to last mock survey. Print to PDF for administrator records. |
| Policy Library | `/facilities/:id/policies` | Categorized policy list. Search. Status badges. Acknowledgment progress per policy (12/15 staff acknowledged). |
| Policy Editor | `/policies/:id/edit` | Markdown editor for policy content. Version history sidebar. Publish button (triggers acknowledgment requirement). |
| Survey History | `/facilities/:id/surveys` | Timeline of actual surveys with outcomes. Deficiency detail drill-down. POC tracking. Fine tracking. |
| Deficiency Tracker | `/survey-deficiencies/:id` | Individual deficiency: citation text, POC, corrective actions checklist, evidence uploads, status progression. |
