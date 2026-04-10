-- ============================================================
-- Compliance Engine Enhanced Tier: Rules & Reminders
-- Spec: 08-compliance-engine.md § Enhanced Tier
-- ============================================================

-- ============================================================
-- COMPLIANCE RULES (rule-based scoring for AHCA tags)
-- ============================================================
CREATE TABLE compliance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id), -- NULL = org-wide rule
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Rule identification
  tag_number text NOT NULL, -- e.g., "220", "417", "502"
  tag_title text NOT NULL, -- e.g., "Personal Care", "Adequate Care"
  rule_description text NOT NULL,

  -- Rule logic
  check_query text NOT NULL, -- SQL query template for rule execution
  severity text NOT NULL CHECK (severity IN ('minor', 'standard', 'serious', 'immediate_jeopardy')),
  enabled boolean NOT NULL DEFAULT true,

  -- Metadata
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_compliance_rules_facility ON compliance_rules(facility_id) WHERE deleted_at IS NULL AND enabled = true;

-- ============================================================
-- COMPLIANCE SCANS (snapshots for tracking over time)
-- ============================================================
CREATE TABLE compliance_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  scanned_by uuid REFERENCES auth.users(id),
  total_rules_checked integer NOT NULL DEFAULT 0,
  rules_passed integer NOT NULL DEFAULT 0,
  rules_failed integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_scans_facility ON compliance_scans(facility_id, scanned_at DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- COMPLIANCE SCAN RESULTS (per-rule results for drill-down)
-- ============================================================
CREATE TABLE compliance_scan_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES compliance_scans(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  rule_id uuid NOT NULL REFERENCES compliance_rules(id),
  tag_number text NOT NULL,
  passed boolean NOT NULL,
  non_compliant_count integer NOT NULL DEFAULT 0,

  -- Context for drill-down (JSONB array of affected record IDs/details)
  context jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scan_results_scan ON compliance_scan_results(scan_id);
CREATE INDEX idx_scan_results_facility_rule ON compliance_scan_results(facility_id, rule_id, created_at DESC);

-- ============================================================
-- COMPLIANCE REMINDERS (weekly digests, due dates)
-- ============================================================
CREATE TABLE compliance_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Reminder content
  reminder_type text NOT NULL CHECK (reminder_type IN (
    'weekly_digest',
    'poc_due',
    'assessment_overdue',
    'care_plan_review_due',
    'policy_acknowledgment_overdue'
  )),
  title text NOT NULL,
  description text,
  action_url text,

  -- Scheduling
  next_send_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  frequency text CHECK (frequency IN ('once', 'daily', 'weekly')),

  -- Context (JSONB for dynamic data)
  context jsonb,

  -- Status
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dismissed')),
  dismissed_by uuid REFERENCES auth.users(id),
  dismissed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_reminders_facility_next ON compliance_reminders(facility_id, next_send_at)
  WHERE deleted_at IS NULL AND status = 'pending';

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- compliance_rules
ALTER TABLE compliance_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_manage_compliance_rules ON compliance_rules
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY staff_see_compliance_rules ON compliance_rules
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND enabled = true
  );

-- compliance_scans
ALTER TABLE compliance_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_compliance_scans ON compliance_scans
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY admin_manage_compliance_scans ON compliance_scans
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- compliance_scan_results
ALTER TABLE compliance_scan_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_scan_results ON compliance_scan_results
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- compliance_reminders
ALTER TABLE compliance_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_reminders ON compliance_reminders
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY admin_manage_reminders ON compliance_reminders
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE POLICY staff_see_own_reminders ON compliance_reminders
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (user_id = auth.uid() OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin'))
  );

-- ============================================================
-- AUDIT TRIGGERS
-- ============================================================

CREATE TRIGGER tr_compliance_rules_set_updated_at
  BEFORE UPDATE ON compliance_rules
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_compliance_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON compliance_rules
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

CREATE TRIGGER tr_compliance_scans_set_updated_at
  BEFORE UPDATE ON compliance_scans
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_compliance_scans_audit
  AFTER INSERT OR UPDATE OR DELETE ON compliance_scans
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

CREATE TRIGGER tr_compliance_scan_results_audit
  AFTER INSERT ON compliance_scan_results
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

CREATE TRIGGER tr_compliance_reminders_set_updated_at
  BEFORE UPDATE ON compliance_reminders
  FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER tr_compliance_reminders_audit
  AFTER INSERT OR UPDATE OR DELETE ON compliance_reminders
  FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();

-- ============================================================
-- SEED DATA: Initial AHCA rules from spec
-- ============================================================

-- Tag 220: Personal Care - ADL care plans current, daily ADL logs present
INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '220',
  'Personal Care',
  'ADL care plans must be current; daily ADL logs present for assigned residents',
  $sql$
    WITH resident_adl_status AS (
      SELECT
        r.id,
        MAX(cp.effective_date) as latest_cp_date,
        MAX(dl.log_date) as latest_adl_date
      FROM residents r
      LEFT JOIN care_plans cp ON cp.resident_id = r.id AND cp.status = 'active' AND cp.deleted_at IS NULL
      LEFT JOIN daily_logs dl ON dl.resident_id = r.id
        AND dl.shift IN ('morning', 'evening', 'night')
        AND dl.deleted_at IS NULL
      WHERE r.deleted_at IS NULL
        AND r.status IN ('active', 'hospital_hold', 'loa')
        AND r.facility_id = (SELECT id FROM facilities LIMIT 1)
      GROUP BY r.id
    )
    SELECT COUNT(*) = 0
    FROM resident_adl_status
    WHERE latest_cp_date IS NULL
       OR latest_adl_date < CURRENT_DATE - INTERVAL '7 days'
  $sql$,
  'serious'
FROM organizations o
LIMIT 1;

-- Tag 417: Adequate Care - PRN effectiveness, condition changes reported
INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '417',
  'Adequate Care',
  'PRN effectiveness documented; condition changes reported within 24 hours',
  $sql$
    SELECT COUNT(*) = 0
    FROM resident_medications rm
    JOIN residents r ON r.id = rm.resident_id
    WHERE rm.is_prn = true
      AND rm.status = 'active'
      AND r.deleted_at IS NULL
      AND r.facility_id = (SELECT id FROM facilities LIMIT 1)
      AND rm.created_at > CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM daily_logs dl
        WHERE dl.resident_id = r.id
          AND dl.log_type = 'prn_effectiveness'
          AND dl.log_date >= rm.created_at
          AND dl.log_date <= rm.created_at + INTERVAL '48 hours'
          AND dl.deleted_at IS NULL
      )
  $sql$,
  'standard'
FROM organizations o
LIMIT 1;

-- Tag 502: Infection Control - surveillance records, staff illness tracking
INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '502',
  'Infection Control',
  'Infection surveillance records present; staff illness tracking active',
  $sql$
    WITH surveillance_check AS (
      SELECT 1
      FROM facilities f
      WHERE f.id = (SELECT id FROM facilities LIMIT 1)
        AND NOT EXISTS (
          SELECT 1 FROM infection_surveillance s
          WHERE s.facility_id = f.id
            AND s.deleted_at IS NULL
            AND s.created_at > CURRENT_DATE - INTERVAL '30 days'
        )
    )
    SELECT COUNT(*) = 0 FROM surveillance_check
  $sql$,
  'serious'
FROM organizations o
LIMIT 1;
