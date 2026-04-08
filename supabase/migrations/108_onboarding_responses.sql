-- Haven activation: onboarding question bank + org-scoped shared responses (Supabase-backed).

CREATE TABLE public.onboarding_questions (
  id text PRIMARY KEY,
  prompt text NOT NULL,
  help_text text,
  assigned_to text,
  department text NOT NULL,
  category text,
  importance text NOT NULL,
  answer_type text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  options jsonb,
  sort_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_questions_importance_check CHECK (importance IN ('critical', 'high', 'normal'))
);

CREATE TABLE public.onboarding_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  question_id text NOT NULL REFERENCES public.onboarding_questions (id) ON DELETE CASCADE,
  value text NOT NULL DEFAULT '',
  confidence text NOT NULL DEFAULT 'best_known',
  entered_by_name text NOT NULL DEFAULT '',
  entered_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_responses_confidence_check CHECK (confidence IN ('confirmed', 'best_known', 'needs_review')),
  CONSTRAINT onboarding_responses_org_question_unique UNIQUE (organization_id, question_id)
);

CREATE INDEX idx_onboarding_responses_org ON public.onboarding_responses (organization_id);

CREATE INDEX idx_onboarding_responses_question ON public.onboarding_responses (question_id);

CREATE TRIGGER tr_onboarding_questions_set_updated_at
  BEFORE UPDATE ON public.onboarding_questions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_onboarding_responses_set_updated_at
  BEFORE UPDATE ON public.onboarding_responses
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

-- JWT app_metadata.app_role (not always mirrored in user_profiles.app_role enum).
CREATE OR REPLACE FUNCTION haven.jwt_app_role_text ()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    COALESCE(NULLIF(trim((auth.jwt () -> 'app_metadata' ->> 'app_role')), ''), '');
$func$;

CREATE OR REPLACE FUNCTION haven.can_access_onboarding_workspace ()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    auth.uid () IS NOT NULL
    AND haven.jwt_app_role_text () IN (
      'onboarding',
      'owner',
      'org_admin',
      'facility_admin',
      'nurse',
      'dietary',
      'maintenance_role',
      'broker');
$func$;

-- COL default org when JWT is onboarding and user_profiles.organization_id is missing (see 008_seed_col_organization.sql).
CREATE OR REPLACE FUNCTION haven.effective_onboarding_organization_id ()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    CASE WHEN haven.organization_id () IS NOT NULL THEN
      haven.organization_id ()
    WHEN haven.jwt_app_role_text () = 'onboarding' THEN
      '00000000-0000-0000-0000-000000000001'::uuid
    ELSE
      NULL
    END;
$func$;

CREATE OR REPLACE FUNCTION haven.is_onboarding_org_admin_jwt ()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    haven.jwt_app_role_text () IN ('owner', 'org_admin');
$func$;

ALTER TABLE public.onboarding_questions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_questions_select ON public.onboarding_questions
  FOR SELECT TO authenticated
  USING (haven.can_access_onboarding_workspace ());

CREATE POLICY onboarding_questions_insert ON public.onboarding_questions
  FOR INSERT TO authenticated
  WITH CHECK (haven.is_onboarding_org_admin_jwt ());

CREATE POLICY onboarding_questions_update ON public.onboarding_questions
  FOR UPDATE TO authenticated
  USING (haven.is_onboarding_org_admin_jwt ())
  WITH CHECK (haven.is_onboarding_org_admin_jwt ());

CREATE POLICY onboarding_questions_delete ON public.onboarding_questions
  FOR DELETE TO authenticated
  USING (haven.is_onboarding_org_admin_jwt ());

CREATE POLICY onboarding_responses_select ON public.onboarding_responses
  FOR SELECT TO authenticated
  USING (haven.can_access_onboarding_workspace ()
    AND organization_id = haven.effective_onboarding_organization_id ());

CREATE POLICY onboarding_responses_insert ON public.onboarding_responses
  FOR INSERT TO authenticated
  WITH CHECK (haven.can_access_onboarding_workspace ()
    AND organization_id = haven.effective_onboarding_organization_id ());

CREATE POLICY onboarding_responses_update ON public.onboarding_responses
  FOR UPDATE TO authenticated
  USING (haven.can_access_onboarding_workspace ()
    AND organization_id = haven.effective_onboarding_organization_id ())
  WITH CHECK (haven.can_access_onboarding_workspace ()
    AND organization_id = haven.effective_onboarding_organization_id ());

CREATE POLICY onboarding_responses_delete ON public.onboarding_responses
  FOR DELETE TO authenticated
  USING (haven.can_access_onboarding_workspace ()
    AND organization_id = haven.effective_onboarding_organization_id ());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_questions TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_responses TO authenticated;

GRANT EXECUTE ON FUNCTION haven.jwt_app_role_text () TO authenticated;

GRANT EXECUTE ON FUNCTION haven.can_access_onboarding_workspace () TO authenticated;

GRANT EXECUTE ON FUNCTION haven.effective_onboarding_organization_id () TO authenticated;

GRANT EXECUTE ON FUNCTION haven.is_onboarding_org_admin_jwt () TO authenticated;

INSERT INTO public.onboarding_questions (
  id, prompt, help_text, assigned_to, department, category, importance, answer_type, required, options, sort_order
) VALUES
('core.governance.decision-rights', 'Who holds final authority for product/build decisions, pilot scope approval, and resolving disagreements?', 'We need a single accountable owner so scope changes, tradeoffs, and sign-off don’t stall the pilot or create rework from conflicting directions.', 'CEO', 'Executive / Ownership', 'governance', 'critical', 'long_text', true, NULL::jsonb, 1),
('core.governance.escalation', 'What is the escalation path when clinical, operations, and finance disagree on a go-live decision?', 'Clear escalation prevents unsafe shortcuts, budget surprises, or silent overrides that break auditability later.', 'COO', 'Executive / Ownership', 'governance', 'critical', 'long_text', true, NULL::jsonb, 2),
('core.pilot.scope', 'What is explicitly in scope for the pilot, and what is explicitly out of scope?', 'Boundaries keep delivery predictable and protect residents/staff from half-built workflows during rollout.', 'President', 'Executive / Ownership', 'pilot', 'critical', 'long_text', true, NULL::jsonb, 3),
('core.pilot.success', 'How will we measure pilot success (metrics, timelines, and who owns each metric)?', 'Success criteria align build priorities with operational reality and give a fair stop/continue decision.', 'COO', 'Executive / Ownership', 'pilot', 'critical', 'long_text', true, NULL::jsonb, 4),
('core.pilot.cutover', 'What is the planned cutover strategy: big-bang, phased by facility, or parallel run—and for how long?', 'Cutover choices drive staffing, training intensity, and risk during the highest-stress window.', 'COO', 'Executive / Ownership', 'pilot', 'high', 'long_text', true, NULL::jsonb, 5),
('core.risk.cannot-fail', 'Which workflows must not break on day one, and what paper or offline fallback exists for each?', 'Identifying cannot-fail workflows focuses testing, support, and rollback planning where harm is highest.', 'Director of Nursing', 'Clinical / Resident Care', 'workflows', 'critical', 'long_text', true, NULL::jsonb, 6),
('core.clinical.meds', 'Summarize medication pass, reorder, and pharmacy communication workflows today (who touches what, when).', 'Med workflows are high-risk; mapping real steps prevents dangerous gaps during digital transition.', 'Director of Nursing', 'Clinical / Resident Care', 'workflows', 'critical', 'long_text', true, NULL::jsonb, 7),
('core.clinical.assessments', 'How are assessments and care plan updates completed, reviewed, and communicated across shifts?', 'Continuity across shifts is where systems fail silently—this clarifies handoffs and accountability.', 'Director of Nursing', 'Clinical / Resident Care', 'workflows', 'high', 'long_text', true, NULL::jsonb, 8),
('core.clinical.incidents', 'What is the current incident / elopement reporting path, including regulatory notification expectations?', 'Compliance timing and documentation rules must be reflected in workflows—not discovered after go-live.', 'Compliance', 'Compliance', 'compliance', 'critical', 'long_text', true, NULL::jsonb, 9),
('core.ops.shadow-systems', 'What spreadsheets, binders, side systems, or informal workflows actually run the operation today?', 'Shadow systems hide real process; surfacing them prevents building a tool nobody actually uses.', 'COO', 'Operations', 'systems', 'high', 'long_text', true, NULL::jsonb, 10),
('core.ops.exceptions', 'How are exceptions handled (e.g., vendor delays, staffing shortfalls) and who approves workarounds?', 'Exception paths become the real process—without them, staff improvise outside the system.', 'COO', 'Operations', 'operations', 'high', 'long_text', true, NULL::jsonb, 11),
('core.ops.housekeeping', 'Describe housekeeping and maintenance request flows (submit → assign → verify complete).', 'Environmental issues affect falls, infection control, and satisfaction—mapping reduces blind spots.', 'Maintenance', 'Operations', 'operations', 'normal', 'long_text', false, NULL::jsonb, 12),
('core.ops.dietary', 'How are diets, allergies, and meal service exceptions communicated between dietary and care staff?', 'Meal errors are preventable harm; clarity here protects residents and survey outcomes.', 'Dietary Manager', 'Operations', 'operations', 'high', 'long_text', true, NULL::jsonb, 13),
('core.finance.reporting', 'What does leadership need to see weekly vs daily vs monthly across entities and facilities?', 'Reporting cadence drives dashboards, exports, and who must keep data clean.', 'CFO', 'Finance', 'reporting', 'high', 'long_text', true, NULL::jsonb, 14),
('core.finance.ar', 'Summarize billing, collections, and trust-account practices that must remain accurate during rollout.', 'Financial controls are regulated; mistakes here create legal exposure and family conflict.', 'CFO', 'Finance', 'reporting', 'critical', 'long_text', true, NULL::jsonb, 15),
('core.finance.payroll', 'What are the payroll and timekeeping integrations (or manual steps) that must not break?', 'Pay impacts morale and compliance; parallel-run plans should cover pay periods explicitly.', 'CFO', 'Finance', 'operations', 'high', 'long_text', true, NULL::jsonb, 16),
('core.it.devices', 'Summarize device, WiFi, and connectivity constraints by facility (or enterprise-wide if uniform).', 'Hardware and connectivity constraints decide what can run on the floor in real conditions.', 'IT', 'IT / Devices', 'infrastructure', 'high', 'long_text', true, NULL::jsonb, 17),
('core.it.security', 'What security policies apply to PHI on workstations, mobile devices, and personal phones?', 'BYOD and shared logins are common failure modes—policies should match how staff actually work.', 'IT', 'IT / Devices', 'infrastructure', 'high', 'long_text', true, NULL::jsonb, 18),
('core.compliance.flags', 'What licensure, regulatory, or survey flags should implementation know about (past citations, plans of correction)?', 'Known risk areas change testing priorities and documentation requirements.', 'Compliance', 'Compliance', 'compliance', 'critical', 'long_text', true, NULL::jsonb, 19),
('core.compliance.retention', 'What record retention and legal hold requirements apply to clinical and financial records?', 'Retention drives archive strategy and what must be auditable in-platform.', 'Compliance', 'Compliance', 'compliance', 'high', 'long_text', true, NULL::jsonb, 20),
('core.hr.training', 'What training approach will be used (role-based, by facility, bilingual needs) and who certifies completion?', 'Training plans determine rollout pacing and support staffing.', 'HR', 'HR / Workforce', 'training', 'high', 'long_text', true, NULL::jsonb, 21),
('core.hr.turnover', 'What is typical staff turnover and float patterns that could affect super-user availability?', 'Churn changes who holds institutional knowledge—plan champions accordingly.', 'HR', 'HR / Workforce', 'training', 'normal', 'long_text', false, NULL::jsonb, 22),
('core.data.migration', 'What resident/staff data must migrate from legacy systems, and what is the source of truth?', 'Migration scope affects timelines, validation, and cutover risk.', 'IT', 'IT / Devices', 'data', 'high', 'long_text', true, NULL::jsonb, 23),
('core.data.quality', 'Where is data quality weakest today (duplicates, stale contacts, inconsistent diagnoses) and how is it cleaned?', 'Bad data in means bad workflows out—cleansing rules should be explicit.', 'COO', 'Operations', 'data', 'high', 'long_text', true, NULL::jsonb, 24),
('core.ai.boundaries', 'Where must AI or automation NEVER replace human judgment (clinical, consent, billing disputes)?', 'Clear boundaries protect residents and keep the operator defensible under licensure and liability.', 'CEO', 'Executive / Ownership', 'governance', 'critical', 'long_text', true, NULL::jsonb, 25),
('core.ai.audit', 'What audit artifacts are required when AI suggests actions (who reviewed, when, overrides)?', 'Auditability is a regulatory and liability requirement—not optional polish.', 'Compliance', 'Compliance', 'compliance', 'high', 'long_text', true, NULL::jsonb, 26),
('core.family.engagement', 'How should families receive updates and who approves messaging that could be clinical or financial?', 'Family communication touches satisfaction and privacy—roles must be explicit.', 'Executive Director', 'Executive / Ownership', 'operations', 'high', 'long_text', true, NULL::jsonb, 27),
('core.expansion.multi-site', 'What is the roadmap for adding facilities/entities after pilot (standards, governance, timelines)?', 'Multi-site patterns affect configuration, roles, and reporting design early.', 'President', 'Executive / Ownership', 'governance', 'normal', 'long_text', false, NULL::jsonb, 28),
('core.vendor.critical', 'Which vendor or outsourced services are critical path for daily operations (pharmacy, laundry, IT MSP)?', 'Vendor dependencies affect integrations, SLAs, and incident response.', 'COO', 'Operations', 'operations', 'high', 'long_text', true, NULL::jsonb, 29),
('core.emergency.preparedness', 'Summarize emergency preparedness communications (weather, power, clinical surge) used today.', 'Emergency comms must remain reliable if systems change—identify single points of failure.', 'COO', 'Operations', 'operations', 'high', 'long_text', true, NULL::jsonb, 30),
('core.quality.qapi', 'How is QAPI or quality review conducted today (cadence, metrics, accountable roles)?', 'Quality cycles should map to reporting so leadership sees the same truth operations uses.', 'Director of Nursing', 'Clinical / Resident Care', 'reporting', 'high', 'long_text', true, NULL::jsonb, 31),
('core.sales.marketing', 'What CRM or lead tracking is used for inquiries and move-ins, and who owns the pipeline metrics?', 'Admissions workflows connect to census and revenue—avoid duplicate entry and dropped leads.', 'Sales / Admissions', 'Sales / Admissions', 'operations', 'normal', 'long_text', false, NULL::jsonb, 32),
('core.broker.relations', 'Are broker or referral relationships material to census—and what data must stay out of general staff view?', 'Sensitive commercial relationships need role separation and clean permissions.', 'CEO', 'Executive / Ownership', 'governance', 'normal', 'long_text', false, NULL::jsonb, 33),
('core.reporting.board', 'What board or owner reporting pack is required monthly (finance + clinical + compliance highlights)?', 'Executive reporting sets the minimum credible narrative for governance oversight.', 'CFO', 'Finance', 'reporting', 'high', 'long_text', true, NULL::jsonb, 34),
('core.integrations.lab', 'What lab, imaging, or external clinical integrations exist (or are planned) and who owns them?', 'Integration ownership prevents orphaned interfaces and unsafe manual workarounds.', 'IT', 'IT / Devices', 'infrastructure', 'normal', 'long_text', false, NULL::jsonb, 35),
('core.policies.source', 'Where is the authoritative policy manual stored today, and how often is it updated?', 'Policy sources anchor training content and in-app guardrails.', 'Compliance', 'Compliance', 'compliance', 'normal', 'long_text', false, NULL::jsonb, 36),
('core.staffing.ratios', 'What staffing ratio or acuity rules must be reflected in scheduling and census planning?', 'Regulatory staffing expectations affect scheduling modules and alerts.', 'Director of Nursing', 'Clinical / Resident Care', 'workflows', 'high', 'long_text', true, NULL::jsonb, 37),
('core.behavior.care', 'How are behavioral care plans and interventions coordinated with activities and care staff?', 'Behavior support spans departments—clear ownership reduces inconsistent responses.', 'Director of Nursing', 'Clinical / Resident Care', 'workflows', 'high', 'long_text', true, NULL::jsonb, 38),
('core.infection.control', 'What infection control surveillance and reporting is performed today (outbreaks, tracking tools)?', 'Infection processes often have external reporting obligations—capture them explicitly.', 'Compliance', 'Compliance', 'compliance', 'high', 'long_text', true, NULL::jsonb, 39),
('core.transportation', 'How are transportation and appointments scheduled, tracked, and billed (if applicable)?', 'Transport touches liability, resident experience, and staffing—don’t treat it as an afterthought.', 'COO', 'Operations', 'operations', 'normal', 'long_text', false, NULL::jsonb, 40),
('core.facilities.assets', 'What facility maintenance and capital projects are planned during the pilot window?', 'Construction and network changes can invalidate training and connectivity assumptions.', 'Maintenance', 'Operations', 'operations', 'normal', 'long_text', false, NULL::jsonb, 41),
('core.telephony', 'What phone system and on-call escalation tree is used after hours for clinical and maintenance issues?', 'After-hours paths are high-risk; they must remain coherent during system changes.', 'COO', 'Operations', 'operations', 'high', 'long_text', true, NULL::jsonb, 42),
('core.privacy.requests', 'Who handles privacy requests, record releases, and resident/family data corrections?', 'Privacy workflows must be assignable and auditable—especially across entities.', 'Compliance', 'Compliance', 'compliance', 'high', 'long_text', true, NULL::jsonb, 43),
('core.contracts.key', 'What key managed care or payer contracts constrain billing workflows or authorizations?', 'Payer rules change prior auth and billing steps—surface constraints early.', 'CFO', 'Finance', 'reporting', 'normal', 'long_text', false, NULL::jsonb, 44),
('core.success.story', 'What does “success” look like for staff on the floor 90 days after go-live (one paragraph)?', 'A concrete staff-level success picture keeps UX and training grounded in reality.', 'COO', 'Operations', 'pilot', 'normal', 'long_text', false, NULL::jsonb, 45),
('core.open.questions', 'What unanswered questions or risks should the implementation team track as explicit follow-ups?', 'Capture unknowns so they become tasks instead of hidden assumptions.', 'All leadership', 'Executive / Ownership', 'governance', 'normal', 'long_text', false, NULL::jsonb, 46),
('core.single-select.pilot-length', 'Preferred pilot length (select one)', 'Pilot duration affects resourcing, parallel-run cost, and how much feedback we can incorporate.', 'President', 'Executive / Ownership', 'pilot', 'high', 'single_select', true, '["30 days","60 days","90 days","120+ days"]'::jsonb, 47),
('core.yes-no.parallel-run', 'Will you require a mandatory parallel run with legacy systems before decommissioning?', 'Parallel run reduces risk but increases workload—leadership should confirm expectations explicitly.', 'CFO', 'Finance', 'pilot', 'high', 'yes_no', true, NULL::jsonb, 48)
ON CONFLICT (id) DO NOTHING;
