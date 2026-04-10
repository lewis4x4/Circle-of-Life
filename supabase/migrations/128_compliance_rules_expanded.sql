-- ============================================================
-- Compliance Engine Enhanced Tier: Expanded AHCA Rules
-- Spec: 08-compliance-engine.md § Enhanced Tier
--
-- Expands compliance rules from 3 to 12 AHCA tags
-- covering key regulatory areas: resident rights, staffing,
-- assessments, medications, physical plant, and dietary.
-- ============================================================

-- ============================================================
-- TAG 201: Resident Rights
-- Rights violations documented and addressed
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '201',
  'Resident Rights',
  'Resident rights violations documented and addressed within required timeframe',
  $sql$
    WITH rights_violations AS (
      SELECT i.id
      FROM incidents i
      JOIN residents r ON r.id = i.resident_id
      WHERE i.deleted_at IS NULL
        AND i.type IN ('rights_violation', 'abuse', 'neglect')
        AND i.status = 'open'
        AND i.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND i.incident_date < CURRENT_DATE - INTERVAL '3 days'
    )
    SELECT COUNT(*) = 0 FROM rights_violations
  $sql$,
  'serious'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 205: Grievance
-- Grievances logged and resolved
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '205',
  'Grievance',
  'Grievances logged and resolved within 5 business days',
  $sql$
    WITH overdue_grievances AS (
      SELECT i.id
      FROM incidents i
      JOIN residents r ON r.id = i.resident_id
      WHERE i.deleted_at IS NULL
        AND i.type = 'grievance'
        AND i.status = 'open'
        AND i.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND i.incident_date < CURRENT_DATE - INTERVAL '7 days'
    )
    SELECT COUNT(*) = 0 FROM overdue_grievances
  $sql$,
  'standard'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 309: Staffing
-- Staffing ratios maintained
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '309',
  'Staffing',
  'Staffing ratios maintained per AHCA requirements',
  $sql$
    WITH staffing_check AS (
      SELECT
        DATE_TRUNC('day', s.shift_date) as shift_date,
        COUNT(DISTINCT s.staff_id) as staff_count,
        COUNT(DISTINCT r.id) as resident_count
      FROM shifts s
      LEFT JOIN residents r ON r.deleted_at IS NULL
        AND r.facility_id = s.facility_id
        AND r.status IN ('active', 'hospital_hold', 'loa')
      WHERE s.deleted_at IS NULL
        AND s.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND s.shift_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('day', s.shift_date)
      HAVING (COUNT(DISTINCT r.id)::float / NULLIF(COUNT(DISTINCT s.staff_id), 0))::float < 5.0
         OR COUNT(DISTINCT s.staff_id) < 2
    )
    SELECT COUNT(*) = 0 FROM staffing_check
  $sql$,
  'serious'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 314: Staff Training
-- Training records current
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '314',
  'Staff Training',
  'All staff have required training documented',
  $sql$
    WITH untrained_staff AS (
      SELECT DISTINCT ufa.user_id
      FROM user_facility_access ufa
      LEFT JOIN staff_certifications sc ON sc.user_id = ufa.user_id
        AND sc.deleted_at IS NULL
        AND sc.expiration_date > CURRENT_DATE
      WHERE ufa.deleted_at IS NULL
        AND ufa.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND ufa.app_role IN ('nurse', 'caregiver', 'dietary')
      GROUP BY ufa.user_id
      HAVING COUNT(sc.id) = 0
    )
    SELECT COUNT(*) = 0 FROM untrained_staff
  $sql$,
  'standard'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 325: Background Screening
-- Background screenings current
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '325',
  'Background Screening',
  'All direct care staff have current background screenings',
  $sql$
    WITH expired_backgrounds AS (
      SELECT DISTINCT ufa.user_id
      FROM user_facility_access ufa
      LEFT JOIN staff_certifications sc ON sc.user_id = ufa.user_id
        AND sc.certification_type = 'background_check'
        AND sc.deleted_at IS NULL
        AND sc.expiration_date > CURRENT_DATE
      WHERE ufa.deleted_at IS NULL
        AND ufa.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND ufa.app_role IN ('nurse', 'caregiver', 'dietary')
      GROUP BY ufa.user_id
      HAVING COUNT(sc.id) = 0
    )
    SELECT COUNT(*) = 0 FROM expired_backgrounds
  $sql$,
  'immediate_jeopardy'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 404: Resident Assessment
-- Assessments completed on schedule
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '404',
  'Resident Assessment',
  'Resident assessments completed within required timeframe',
  $sql$
    WITH overdue_assessments AS (
      SELECT a.id
      FROM assessments a
      JOIN residents r ON r.id = a.resident_id
      WHERE a.deleted_at IS NULL
        AND a.status = 'scheduled'
        AND a.assessment_date < CURRENT_DATE
        AND r.deleted_at IS NULL
        AND r.status IN ('active', 'hospital_hold', 'loa')
        AND r.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND a.assessment_date < CURRENT_DATE - INTERVAL '1 day'
    )
    SELECT COUNT(*) = 0 FROM overdue_assessments
  $sql$,
  'serious'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 409: Care Plan Updates
-- Care plans reviewed and updated
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '409',
  'Care Plan Updates',
  'Care plans reviewed within required timeframe',
  $sql$
    WITH overdue_reviews AS (
      SELECT cp.id
      FROM care_plans cp
      JOIN residents r ON r.id = cp.resident_id
      WHERE cp.deleted_at IS NULL
        AND cp.status = 'active'
        AND cp.review_due_date < CURRENT_DATE
        AND r.deleted_at IS NULL
        AND r.status IN ('active', 'hospital_hold', 'loa')
        AND r.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND cp.review_due_date < CURRENT_DATE - INTERVAL '7 days'
    )
    SELECT COUNT(*) = 0 FROM overdue_reviews
  $sql$,
  'standard'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 501: Medication Admin
-- Medication administration documented
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '501',
  'Medication Admin',
  'Medication administration documented for all scheduled doses',
  $sql$
    WITH missing_documentation AS (
      SELECT em.id
      FROM emar_records em
      JOIN resident_medications rm ON rm.id = em.medication_id
      WHERE em.deleted_at IS NULL
        AND rm.status = 'active'
        AND em.scheduled_time < CURRENT_TIME
        AND em.scheduled_time > CURRENT_TIME - INTERVAL '4 hours'
        AND em.status = 'scheduled'
        AND rm.facility_id = (SELECT id FROM facilities LIMIT 1)
    )
    SELECT COUNT(*) = 0 FROM missing_documentation
  $sql$,
  'serious'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 504: Medication Errors
-- Error rate below threshold
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '504',
  'Medication Errors',
  'Medication error rate below 0.5% threshold',
  $sql$
    WITH error_rate_check AS (
      SELECT
        COUNT(*) FILTER (WHERE error_type IS NOT NULL) as errors,
        COUNT(*) as total_doses
      FROM emar_records em
      JOIN resident_medications rm ON rm.id = em.medication_id
      WHERE em.deleted_at IS NULL
        AND rm.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND em.administered_at >= CURRENT_DATE - INTERVAL '30 days'
    )
    SELECT (errors::float / NULLIF(total_doses, 0)::float) < 0.005
    FROM error_rate_check
  $sql$,
  'serious'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 601: Physical Plant
-- Facility maintenance current
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '601',
  'Physical Plant',
  'Physical plant safety: no overdue incident follow-ups related to facility conditions',
  $sql$
    WITH facility_issues AS (
      SELECT i.id
      FROM incidents i
      JOIN residents r ON r.id = i.resident_id
      WHERE i.deleted_at IS NULL
        AND i.category IN ('facility', 'equipment', 'environmental')
        AND i.status = 'open'
        AND i.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND i.incident_date < CURRENT_DATE - INTERVAL '7 days'
    )
    SELECT COUNT(*) = 0 FROM facility_issues
  $sql$,
  'standard'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 602: Emergency Prep
-- Emergency drills and checks completed
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '602',
  'Emergency Prep',
  'Emergency drills and generator tests completed on schedule',
  $sql$
    WITH overdue_emergency_items AS (
      SELECT ec.id
      FROM emergency_checklist_items ec
      WHERE ec.deleted_at IS NULL
        AND ec.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND ec.next_due_date < CURRENT_DATE
    )
    SELECT COUNT(*) = 0 FROM overdue_emergency_items
  $sql$,
  'serious'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- TAG 701: Dietary
-- Dietary needs documented in care plans
-- ============================================================

INSERT INTO compliance_rules (
  organization_id, facility_id, tag_number, tag_title, rule_description, check_query, severity
)
SELECT
  o.id,
  NULL,
  '701',
  'Dietary',
  'Dietary needs and restrictions documented in care plans',
  $sql$
    WITH missing_dietary AS (
      SELECT r.id
      FROM residents r
      LEFT JOIN care_plans cp ON cp.resident_id = r.id
        AND cp.deleted_at IS NULL
        AND cp.status = 'active'
        AND cp.content::text LIKE '%dietary%'
      WHERE r.deleted_at IS NULL
        AND r.status IN ('active', 'hospital_hold', 'loa')
        AND r.facility_id = (SELECT id FROM facilities LIMIT 1)
        AND cp.id IS NULL
    )
    SELECT COUNT(*) = 0 FROM missing_dietary
  $sql$,
  'standard'
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;
