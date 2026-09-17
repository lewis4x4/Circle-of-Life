-- Smart Rounding: the Watchlist.
-- Spec: docs/specs/25A-smart-rounding-cadence-and-watchlist.md sections 7, 9,
-- 10, 12 items 8, 9 and 10, and 13.
--
-- This file replaces the resident safety score. The retired surface computed a
-- 0 to 100 number on a resident row out of observation compliance, incident
-- recency and medication adherence. Two of those three measure whether staff
-- did their job, so a resident dropped twenty points because a caregiver ran
-- late and a reader saw decline. The number was also unactionable: the
-- operational question is never "what is her score", it is "who do I need to
-- look at today, and why".
--
-- So there is no resident level number anywhere in this file. Not a score, not
-- a percentage, not an index. A resident carries a set of named signals, each
-- of which traces to a rule row that can be printed and handed to a surveyor,
-- and a band that is one of three words. The only composite in the module is
-- public.v_facility_risk_index, which is facility level, where an aggregate is
-- statistically meaningful and no care decision hangs on one reading.
--
-- Spec 25's resident-safety-scorer, risk-nightly-scorer and
-- resident-assurance-ai are untouched by this migration and keep their other
-- consumers. They simply stop feeding this surface. Nothing here reads
-- public.resident_safety_scores.
--
-- Three things live in rows rather than in code, deliberately:
--
--   1. every threshold, lookback, baseline and source filter, in
--      public.watchlist_signal_rules
--   2. every band boundary, including the jurisdiction keyed continued
--      residency rule, in public.watchlist_band_rules
--   3. every recipient and channel, through public.notification_routes
--
-- The Edge Function that runs the evaluation on a schedule therefore contains
-- no threshold, no lookback, no recipient and no channel, and an administrator
-- changes any of them with a row edit rather than a deploy.
--
-- No named person, no facility name and no resident identifying data appears
-- here. The rules are seeded for every non deleted facility in the
-- organization, selected by organization, because migration 318 renamed two of
-- the five buildings and a seed that matched on name would silently touch three
-- of them and report success.

BEGIN;

-- ---------------------------------------------------------------------------
-- Who may disposition a signal.
--
-- Spec section 10. The spec's assistant_administrator exists only on the
-- staff_role enum; SQL permission gates run on app_role, where manager stands
-- in for it. Recorded in HANDOFFS/2026-09-16__smart-rounding-build-notes.md
-- section 1.5.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.can_disposition_watchlist_signal (p_role text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog
  AS $func$
  SELECT p_role = ANY (ARRAY['facility_admin', 'manager', 'org_admin', 'owner']);
$func$;

COMMENT ON FUNCTION haven.can_disposition_watchlist_signal (text) IS
  'True when an app_role may move a Watchlist signal forward. Spec section 10: reading the Watchlist is floor work, signing a disposition into the survey record is not.';

CREATE OR REPLACE FUNCTION haven.can_disposition_watchlist_signal ()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = haven, pg_catalog
  AS $func$
  SELECT haven.can_disposition_watchlist_signal (haven.app_role ()::text);
$func$;

COMMENT ON FUNCTION haven.can_disposition_watchlist_signal () IS
  'The signed in caller''s form of haven.can_disposition_watchlist_signal(text), for row level security policies, which have no role argument to hand it.';

REVOKE ALL ON FUNCTION haven.can_disposition_watchlist_signal (text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_disposition_watchlist_signal (text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION haven.can_disposition_watchlist_signal () FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION haven.can_disposition_watchlist_signal () TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The rules.
--
-- One row per signal per facility, or one organization wide row with a null
-- facility_id that every building inherits until somebody overrides it. The
-- whole table is printable: a surveyor asking "how do you decide who needs
-- watching" gets this table, not a walk through a function body.
--
-- source_filter carries the per signal parameters that are not counts or
-- spans: which chip patterns count as a refusal, which incident categories are
-- a fall, which observation window the overnight rule reads. Keeping them in
-- the row rather than in the evaluator is what makes the rule printable and
-- editable, and it is why the evaluator has one branch for all three chip
-- signals rather than three.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.watchlist_signal_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  -- Null means the organization default, which every facility inherits.
  facility_id uuid NULL REFERENCES public.facilities (id),
  signal_key text NOT NULL CHECK (signal_key ~ '^[a-z0-9_]+$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  severity_class text NOT NULL CHECK (severity_class IN ('informational', 'elevated', 'critical')),
  -- The band rules compare against this, and the facility risk index sums it.
  -- It is the one number in the module and it lives on a rule, never on a
  -- resident.
  severity_weight integer NOT NULL CHECK (severity_weight BETWEEN 0 AND 100),
  threshold_count integer NOT NULL CHECK (threshold_count >= 1),
  lookback_days integer NOT NULL CHECK (lookback_days BETWEEN 1 AND 366),
  baseline_days integer NULL CHECK (baseline_days IS NULL OR baseline_days BETWEEN 1 AND 366),
  threshold_percent numeric(5, 2) NULL CHECK (threshold_percent IS NULL OR threshold_percent > 0),
  secondary_threshold_percent numeric(5, 2) NULL CHECK (secondary_threshold_percent IS NULL OR secondary_threshold_percent > 0),
  secondary_lookback_days integer NULL CHECK (secondary_lookback_days IS NULL OR secondary_lookback_days BETWEEN 1 AND 366),
  source_filter jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_filter) = 'object'),
  enabled boolean NOT NULL DEFAULT TRUE,
  -- A documentation lapse is not resident decline. The surface renders the two
  -- classes differently and the band rules can decline to count the second.
  source_kind text NOT NULL CHECK (source_kind IN ('clinical', 'data_quality')),
  jurisdiction text NULL CHECK (jurisdiction IS NULL OR jurisdiction ~ '^[A-Z][A-Z0-9_]*$'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  -- A percent signal needs a percent, and a signal with a second span needs a
  -- second percent to go with it. Half a rule is worse than no rule.
  CONSTRAINT watchlist_signal_rules_secondary_pair CHECK ((secondary_threshold_percent IS NULL) = (secondary_lookback_days IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_signal_rules_scope
  ON public.watchlist_signal_rules (organization_id, facility_id, signal_key) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_rules_lookup
  ON public.watchlist_signal_rules (organization_id, signal_key)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.watchlist_signal_rules IS
  'One row per Watchlist signal, facility scoped, so the full list of what the building watches for can be printed and handed to a surveyor. A row with a null facility_id is the organization default that every building inherits until one overrides it.';
COMMENT ON COLUMN public.watchlist_signal_rules.severity_weight IS
  'What one open instance of this signal contributes. public.watchlist_band_rules compares against it and public.v_facility_risk_index sums it. It lives on the rule, never on a resident: there is no resident level number in this module.';
COMMENT ON COLUMN public.watchlist_signal_rules.source_filter IS
  'The per signal parameters that are not a count or a span: chip_any (an array of chip_selections containment patterns), incident_categories, care_event_kinds, window_key, satisfying_states, trigger_types, statuses. Held in the row rather than the evaluator so the rule stays printable and editable.';
COMMENT ON COLUMN public.watchlist_signal_rules.source_kind IS
  'clinical or data_quality. observation_gap is data_quality: it reports that nobody wrote the check down, which is a documentation lapse and must never render as resident decline.';
COMMENT ON COLUMN public.watchlist_signal_rules.jurisdiction IS
  'The regulator whose rule this is, when it belongs to one. Null for a clinical rule the organization set itself. No Florida rule lives in a code path.';

-- ---------------------------------------------------------------------------
-- The bands.
--
-- Three words, never a number: Needs a look, Watch, Acute. A fourth, Continued
-- residency risk, is the jurisdiction keyed rule spec section 7.3 names, and it
-- is a row here for exactly the reason the spec gives: no Florida rule in a
-- code path.
--
-- A band is the highest ranked enabled row whose condition the resident's open
-- signal set satisfies. Several rows may name the same band with different
-- conditions, which is how "one critical signal, or two elevated ones" is
-- expressed without an OR in a function body.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.watchlist_band_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NULL REFERENCES public.facilities (id),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z0-9_]+$'),
  band_key text NOT NULL CHECK (band_key IN ('needs_a_look', 'watch', 'acute', 'continued_residency_risk')),
  band_label text NOT NULL CHECK (char_length(btrim(band_label)) BETWEEN 1 AND 60),
  band_rank integer NOT NULL CHECK (band_rank BETWEEN 1 AND 100),
  min_open_signal_count integer NOT NULL DEFAULT 1 CHECK (min_open_signal_count >= 1),
  min_severity_weight integer NOT NULL DEFAULT 0 CHECK (min_severity_weight BETWEEN 0 AND 100),
  -- Set only on a rule that is about how long something has been open, which
  -- at seed time is the continued residency rule and nothing else.
  min_open_days integer NULL CHECK (min_open_days IS NULL OR min_open_days BETWEEN 1 AND 3650),
  counts_data_quality boolean NOT NULL DEFAULT FALSE,
  enabled boolean NOT NULL DEFAULT TRUE,
  jurisdiction text NULL CHECK (jurisdiction IS NULL OR jurisdiction ~ '^[A-Z][A-Z0-9_]*$'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_band_rules_scope
  ON public.watchlist_band_rules (organization_id, facility_id, rule_key) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.watchlist_band_rules IS
  'Where a band comes from. A resident''s band is the highest ranked enabled row whose condition their open signal set satisfies. Bands are data rather than code so that Continued residency risk, which is a jurisdiction rule, is a row keyed by jurisdiction and not a branch in a function.';
COMMENT ON COLUMN public.watchlist_band_rules.counts_data_quality IS
  'Whether a data_quality signal counts toward this band. False on every band above Needs a look at seed time: a missing observation record is a documentation problem and must not push a resident toward Acute on its own.';
COMMENT ON COLUMN public.watchlist_band_rules.min_open_days IS
  'How long a signal must have been open to count toward this band. Set on the continued residency rule and null elsewhere.';

-- ---------------------------------------------------------------------------
-- The instances.
--
-- One open instance per resident per signal. A cleared instance stays, which is
-- what lets the resident tier show the history rather than only the present,
-- and a condition that recurs after a clearance opens a fresh instance with a
-- fresh first_detected_at, because it did in fact recur.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.watchlist_signal_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  entity_id uuid NULL REFERENCES public.entities (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  resident_id uuid NOT NULL REFERENCES public.residents (id),
  signal_rule_id uuid NOT NULL REFERENCES public.watchlist_signal_rules (id),
  -- Copied from the rule at open time so a later rule edit cannot rewrite what
  -- the building was told on the day it was told, which is the same rule the
  -- cadence and escalation versions follow.
  signal_key text NOT NULL,
  severity_class text NOT NULL CHECK (severity_class IN ('informational', 'elevated', 'critical')),
  severity_weight integer NOT NULL CHECK (severity_weight BETWEEN 0 AND 100),
  source_kind text NOT NULL CHECK (source_kind IN ('clinical', 'data_quality')),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  observed_count integer NOT NULL DEFAULT 1 CHECK (observed_count >= 0),
  -- What fired it, by row id. No clinical detail and no resident identifying
  -- data beyond the ids already on this row.
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'plan_in_place', 'cleared')),
  -- The most recent line somebody wrote about what was done. The append only
  -- ledger holds every one of them; this is the one the board shows.
  disposition_note text NULL CHECK (disposition_note IS NULL OR char_length(disposition_note) <= 2000),
  owner_user_id uuid NULL REFERENCES public.user_profiles (id),
  cleared_at timestamptz NULL,
  cleared_reason text NULL CHECK (cleared_reason IS NULL OR cleared_reason IN ('reviewed', 'condition_no_longer_met')),
  acute_notified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.user_profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users (id),
  deleted_at timestamptz NULL,
  CONSTRAINT watchlist_signal_instances_cleared_fields CHECK ((status = 'cleared'
      AND cleared_at IS NOT NULL
      AND cleared_reason IS NOT NULL)
    OR (status <> 'cleared'
      AND cleared_at IS NULL
      AND cleared_reason IS NULL)),
  CONSTRAINT watchlist_signal_instances_evaluated_after_detected CHECK (last_evaluated_at >= first_detected_at)
);

-- At most one open instance per resident per signal. Two rows for the same
-- resident and the same rule is two people working the same problem.
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_signal_instances_one_open
  ON public.watchlist_signal_instances (resident_id, signal_key)
  WHERE status <> 'cleared' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_instances_facility_open
  ON public.watchlist_signal_instances (facility_id, severity_weight DESC, first_detected_at)
  WHERE status <> 'cleared' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_instances_resident
  ON public.watchlist_signal_instances (resident_id, first_detected_at DESC)
  WHERE deleted_at IS NULL;

-- The facility risk index walks 90 days of opens and clears.
CREATE INDEX IF NOT EXISTS idx_watchlist_signal_instances_facility_history
  ON public.watchlist_signal_instances (facility_id, first_detected_at, cleared_at)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.watchlist_signal_instances IS
  'One open instance per resident per signal, plus every instance that has been cleared. Carries no score, no percentage and no index: a resident has named signals and a band, and the only composite in the module is facility level.';
COMMENT ON COLUMN public.watchlist_signal_instances.evidence IS
  'The rows that fired the signal, by id, with the thresholds that were in force when it fired. No clinical detail, no free text and no resident identifying data beyond the ids already on this row.';
COMMENT ON COLUMN public.watchlist_signal_instances.severity_weight IS
  'Copied from the rule when the instance opened. A later threshold edit changes what fires next, never what a reviewer was looking at last week.';
COMMENT ON COLUMN public.watchlist_signal_instances.acute_notified_at IS
  'When the Acute push went out through notification_routes. Stamped once, so a re-evaluation on the next tick does not wake the administrator again for the same signal.';

-- ---------------------------------------------------------------------------
-- The disposition ledger. Append only, and it is the survey artifact.
--
-- The facility identified the risk on a date, a named person reviewed it, this
-- is what was done. No UPDATE policy and no DELETE policy, and no write grant
-- to authenticated: rows arrive from the trigger below, which runs as a
-- definer, so a writer holding UPDATE on the instance table cannot move a
-- status without leaving the row behind.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.watchlist_signal_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Append order. Two transitions inside one transaction share an acted_at,
  -- because now() is the transaction's clock, and a ledger that cannot be put
  -- back in order is not a ledger. This is the tiebreaker the CSV export and
  -- the resident tier both sort on.
  ledger_seq bigint GENERATED ALWAYS AS IDENTITY,
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  resident_id uuid NOT NULL REFERENCES public.residents (id),
  signal_instance_id uuid NOT NULL REFERENCES public.watchlist_signal_instances (id),
  signal_key text NOT NULL,
  from_status text NULL CHECK (from_status IS NULL OR from_status IN ('new', 'acknowledged', 'plan_in_place', 'cleared')),
  to_status text NOT NULL CHECK (to_status IN ('new', 'acknowledged', 'plan_in_place', 'cleared')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system')),
  acted_by uuid NULL REFERENCES public.user_profiles (id),
  acted_by_role text NULL,
  acted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A person moving a signal forward says who they are and what was done. The
  -- evaluator opening and closing a signal says neither, and is labeled
  -- system so the two are never confused on a printed ledger.
  CONSTRAINT watchlist_signal_dispositions_user_accountability CHECK ((actor_kind = 'user'
      AND acted_by IS NOT NULL
      AND char_length(btrim(COALESCE(note, ''))) > 0)
    OR actor_kind = 'system')
);

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_dispositions_instance
  ON public.watchlist_signal_dispositions (signal_instance_id, ledger_seq DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_dispositions_facility
  ON public.watchlist_signal_dispositions (facility_id, ledger_seq DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_dispositions_resident
  ON public.watchlist_signal_dispositions (resident_id, ledger_seq DESC);

COMMENT ON TABLE public.watchlist_signal_dispositions IS
  'Append only. One row per Watchlist signal status transition, with who and when. This is the survey artifact the paper log is replaced by, which is why it has no UPDATE policy, no DELETE policy and no write grant to authenticated.';
COMMENT ON COLUMN public.watchlist_signal_dispositions.actor_kind IS
  'user or system. A signal the evaluator opened or closed because the condition changed is a system row and carries no accountability claim; a reviewer moving one forward is a user row and must name what was done.';

-- ---------------------------------------------------------------------------
-- The Acute push.
--
-- Spec section 7.9: the page is where the list is worked, not where it is
-- discovered. Shaped like public.resident_monitoring_order_notifications so one
-- sender can eventually serve both. Rows are queued here; nothing in this
-- migration sends anything, and no role or channel is named except the fallback
-- that exists so a facility which has configured nothing still reaches somebody.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.watchlist_signal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  facility_id uuid NOT NULL REFERENCES public.facilities (id),
  signal_instance_id uuid NOT NULL REFERENCES public.watchlist_signal_instances (id),
  notification_route_id uuid NULL REFERENCES public.notification_routes (id),
  target_role text NOT NULL,
  target_user_id uuid NULL REFERENCES public.user_profiles (id),
  target_phone text NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'push', 'sms', 'voice', 'email')),
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  skip_reason text NULL,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_notifications_pending
  ON public.watchlist_signal_notifications (status, send_after)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_watchlist_signal_notifications_instance
  ON public.watchlist_signal_notifications (signal_instance_id, created_at DESC);

COMMENT ON TABLE public.watchlist_signal_notifications IS
  'Queued pushes for a new Acute signal, resolved through notification_routes with the administrator fallback that care events and Monitoring Orders use. The message body is built by the sender and carries no resident identifying data.';

-- ---------------------------------------------------------------------------
-- Grants and row level security.
--
-- authenticated reads. It never writes. Every write in this module goes through
-- a definer command that checks the caller's role first: the evaluator opens
-- and closes instances as service_role, and public.disposition_watchlist_signal
-- moves one forward on a signed in reviewer's authority. That is why there is
-- no INSERT or UPDATE policy on the instance table and no policy of any kind
-- beyond SELECT on the ledger.
--
-- The two configuration tables are editable by the roles spec section 10 names,
-- and their policies carry the null facility_id case explicitly. A bare
-- facility_id IN (...) predicate evaluates to null on an organization default
-- row, which reads as false, which would hide every inherited rule from every
-- reader in the organization.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.watchlist_signal_rules, public.watchlist_band_rules,
  public.watchlist_signal_instances, public.watchlist_signal_dispositions,
  public.watchlist_signal_notifications FROM PUBLIC, anon;

GRANT SELECT, UPDATE ON public.watchlist_signal_rules TO authenticated;
GRANT SELECT, UPDATE ON public.watchlist_band_rules TO authenticated;
GRANT SELECT ON public.watchlist_signal_instances TO authenticated;
GRANT SELECT ON public.watchlist_signal_dispositions TO authenticated;
GRANT SELECT ON public.watchlist_signal_notifications TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist_signal_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist_band_rules TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.watchlist_signal_instances TO service_role;
GRANT SELECT, INSERT ON public.watchlist_signal_dispositions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.watchlist_signal_notifications TO service_role;

ALTER TABLE public.watchlist_signal_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_band_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_signal_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_signal_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_signal_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlist_signal_rules_select ON public.watchlist_signal_rules;
CREATE POLICY watchlist_signal_rules_select ON public.watchlist_signal_rules
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ())));

-- The facility predicate is repeated in WITH CHECK rather than inherited from
-- USING, so the policy stands on its own and an edit cannot move a rule to a
-- building the editor cannot reach. An organization default belongs to the
-- organization and only an organization level role may touch it.
DROP POLICY IF EXISTS watchlist_signal_rules_update ON public.watchlist_signal_rules;
CREATE POLICY watchlist_signal_rules_update ON public.watchlist_signal_rules
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.can_disposition_watchlist_signal ()
    AND (CASE WHEN facility_id IS NULL THEN
        haven.app_role ()::text = ANY (ARRAY['org_admin', 'owner'])
      ELSE
        facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
      END))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.can_disposition_watchlist_signal ()
    AND (CASE WHEN facility_id IS NULL THEN
        haven.app_role ()::text = ANY (ARRAY['org_admin', 'owner'])
      ELSE
        facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
      END));

DROP POLICY IF EXISTS watchlist_band_rules_select ON public.watchlist_band_rules;
CREATE POLICY watchlist_band_rules_select ON public.watchlist_band_rules
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ())));

DROP POLICY IF EXISTS watchlist_band_rules_update ON public.watchlist_band_rules;
CREATE POLICY watchlist_band_rules_update ON public.watchlist_band_rules
  FOR UPDATE
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.can_disposition_watchlist_signal ()
    AND (CASE WHEN facility_id IS NULL THEN
        haven.app_role ()::text = ANY (ARRAY['org_admin', 'owner'])
      ELSE
        facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
      END))
  WITH CHECK (organization_id = haven.organization_id ()
    AND haven.can_disposition_watchlist_signal ()
    AND (CASE WHEN facility_id IS NULL THEN
        haven.app_role ()::text = ANY (ARRAY['org_admin', 'owner'])
      ELSE
        facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
      END));

DROP POLICY IF EXISTS watchlist_signal_instances_select ON public.watchlist_signal_instances;
CREATE POLICY watchlist_signal_instances_select ON public.watchlist_signal_instances
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- No INSERT policy and no UPDATE policy on the instance table. Deliberate: the
-- evaluator and the disposition command are the only writers.

DROP POLICY IF EXISTS watchlist_signal_dispositions_select ON public.watchlist_signal_dispositions;
CREATE POLICY watchlist_signal_dispositions_select ON public.watchlist_signal_dispositions
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- No INSERT, UPDATE or DELETE policy on the ledger. Deliberate, and asserted by
-- supabase/tests/review_smart_rounding_authority.sql.

DROP POLICY IF EXISTS watchlist_signal_notifications_select ON public.watchlist_signal_notifications;
CREATE POLICY watchlist_signal_notifications_select ON public.watchlist_signal_notifications
  FOR SELECT
  USING (organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

-- ---------------------------------------------------------------------------
-- Updated at and audit triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_watchlist_signal_rules_set_updated_at ON public.watchlist_signal_rules;
CREATE TRIGGER tr_watchlist_signal_rules_set_updated_at
  BEFORE UPDATE ON public.watchlist_signal_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_watchlist_signal_rules_audit ON public.watchlist_signal_rules;
CREATE TRIGGER tr_watchlist_signal_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.watchlist_signal_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_watchlist_band_rules_set_updated_at ON public.watchlist_band_rules;
CREATE TRIGGER tr_watchlist_band_rules_set_updated_at
  BEFORE UPDATE ON public.watchlist_band_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_watchlist_band_rules_audit ON public.watchlist_band_rules;
CREATE TRIGGER tr_watchlist_band_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.watchlist_band_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

DROP TRIGGER IF EXISTS tr_watchlist_signal_instances_set_updated_at ON public.watchlist_signal_instances;
CREATE TRIGGER tr_watchlist_signal_instances_set_updated_at
  BEFORE UPDATE ON public.watchlist_signal_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_set_updated_at ();

DROP TRIGGER IF EXISTS tr_watchlist_signal_instances_audit ON public.watchlist_signal_instances;
CREATE TRIGGER tr_watchlist_signal_instances_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.watchlist_signal_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_capture_audit_log ();

-- ---------------------------------------------------------------------------
-- The ledger is written by a trigger, not by each writer.
--
-- A reviewer who moves a signal forward without saying what was done is refused
-- at the table rather than at the form, because the disposition line is the
-- whole value of the ledger: "the facility identified the risk on a date, a
-- named person reviewed it, this is what was done". A transition with no
-- signed in caller is the evaluator and is recorded as a system row, which a
-- printed ledger shows differently and which claims nothing about anybody.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.record_watchlist_disposition ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $func$
DECLARE
  v_actor uuid;
  v_kind text;
  v_role text;
  v_note text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_actor := auth.uid();
  v_kind := CASE WHEN v_actor IS NULL THEN
    'system'
  ELSE
    'user'
  END;
  IF v_kind = 'user' THEN
    -- The line the reviewer wrote on this transition.
    v_note := NULLIF(btrim(COALESCE(NEW.disposition_note, '')), '');
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'Write one line about what was done before moving this signal forward'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- The evaluator claims nothing about anybody and never inherits the note a
    -- reviewer left on the row earlier. Where it closed a signal it says why,
    -- in the vocabulary of the clearance reason and nothing else.
    v_note := NEW.cleared_reason;
  END IF;

  IF v_kind = 'user' THEN
    SELECT
      profile.app_role::text INTO v_role
    FROM
      public.user_profiles AS profile
    WHERE
      profile.id = v_actor;
  END IF;

  INSERT INTO public.watchlist_signal_dispositions (organization_id, facility_id, resident_id, signal_instance_id, signal_key, from_status, to_status, note, actor_kind, acted_by, acted_by_role)
    VALUES (NEW.organization_id, NEW.facility_id, NEW.resident_id, NEW.id, NEW.signal_key, CASE WHEN TG_OP = 'INSERT' THEN
        NULL
      ELSE
        OLD.status
      END, NEW.status, v_note, v_kind, CASE WHEN v_kind = 'user' THEN
        v_actor
      ELSE
        NULL
      END, v_role);

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION haven.record_watchlist_disposition () IS
  'Writes the append only disposition row for a Watchlist signal, including the opening one. A definer, so the ledger lands whatever the writer''s authority is and a writer with UPDATE on the instance table cannot move a status without leaving the trail.';

DROP TRIGGER IF EXISTS tr_watchlist_signal_instances_disposition ON public.watchlist_signal_instances;
CREATE TRIGGER tr_watchlist_signal_instances_disposition
  AFTER INSERT OR UPDATE ON public.watchlist_signal_instances
  FOR EACH ROW
  EXECUTE FUNCTION haven.record_watchlist_disposition ();

-- ---------------------------------------------------------------------------
-- Seed: the fifteen signals of spec section 7.2, as organization defaults.
--
-- Seeded by organization with a null facility_id, so every building in the
-- organization inherits the same list and a sixth building added next year
-- inherits it too. Never by facility name: migration 318 realigned two of the
-- five names to their registered form and any seed carrying the pre-318 names
-- touches three facilities out of five and reports success.
--
-- Every one of the fifteen ships enabled. Each reads a source that exists in
-- this schema at this migration, and every rule whose source is thin is written
-- so that thin data cannot make it fire: withdrawal needs a prior attendance
-- record before it can report an absence, and weight_loss needs two weights
-- before it can report a drop. A signal that never fires because nothing is
-- being written is a reporting gap the Integrity surface is for, not a false
-- positive here.
--
-- Weights, and why they are what they are. The band rules below turn one
-- critical signal, or two elevated ones, into Acute. Repeat falls and leaving
-- the building are the two conditions where a delay is measured in harm, so
-- they alone carry critical. A single refused meal trend, an open Monitoring
-- Order and a due form are context a reviewer wants on the row and are not by
-- themselves a reason to wake anybody, so they carry informational.
-- ---------------------------------------------------------------------------
WITH col_organization AS (
  SELECT
    o.id
  FROM
    public.organizations o
  WHERE
    o.id = '00000000-0000-0000-0000-000000000001'
),
signal_seed (signal_key, label, description, severity_class, severity_weight, threshold_count, lookback_days, baseline_days, threshold_percent, secondary_threshold_percent, secondary_lookback_days, source_kind, jurisdiction, sort_order, source_filter) AS (
  VALUES ('repeat_fall', 'Two or more falls in a month', 'Two or more falls recorded for this resident in the lookback span, counting incident reports and the care events that did not become one.', 'critical', 80, 2, 30, NULL, NULL, NULL, NULL, 'clinical', NULL, 0, '{"incident_categories":["fall_with_injury","fall_without_injury","fall_witnessed","fall_unwitnessed"],"care_event_kinds":["fall"]}'::jsonb),
    ('elopement_or_wandering', 'Left or tried to leave the building', 'Any elopement or wandering event recorded for this resident in the lookback span.', 'critical', 80, 1, 90, NULL, NULL, NULL, NULL, 'clinical', NULL, 1, '{"incident_categories":["elopement","wandering"],"care_event_kinds":["wandering"]}'::jsonb),
    ('recent_fall', 'Fall in the last month', 'One or more falls recorded for this resident in the lookback span.', 'elevated', 50, 1, 30, NULL, NULL, NULL, NULL, 'clinical', NULL, 2, '{"incident_categories":["fall_with_injury","fall_without_injury","fall_witnessed","fall_unwitnessed"],"care_event_kinds":["fall"]}'::jsonb),
    ('post_hospital_window', 'Back from hospital in the last month', 'This resident returned from a hospital stay inside the lookback span, read from the resident status history.', 'elevated', 50, 1, 30, NULL, NULL, NULL, NULL, 'clinical', NULL, 3, '{"statuses":["hospital_hold"]}'::jsonb),
    ('weight_loss', 'Weight down five percent in a month', 'Latest recorded weight is below the highest weight in the span by the threshold percent, or below the highest weight in the longer span by the second threshold percent.', 'elevated', 50, 1, 30, NULL, 5.00, 10.00, 180, 'clinical', NULL, 4, '{"source_column":"daily_logs.weight_lbs"}'::jsonb),
    ('med_refusal_trend', 'Medications refused three times in a week', 'The medication refused chip appears on three or more observations in the lookback span.', 'elevated', 50, 3, 7, NULL, NULL, NULL, NULL, 'clinical', NULL, 5, '{"chip_any":[{"med_response":["refused_meds"]}]}'::jsonb),
    ('behavior_change', 'Agitated or confused, and this is new', 'The agitated or confused chip appears three or more times in the lookback span and not once in the baseline span before it.', 'elevated', 50, 3, 7, 30, NULL, NULL, NULL, 'clinical', NULL, 6, '{"chip_any":[{"mood_state":["agitated"]},{"mood_state":["confused"]}]}'::jsonb),
    ('night_restlessness', 'Awake at the overnight check', 'At the overnight check the resident was recorded in a state other than the settled ones on the threshold number of nights in the lookback span.', 'elevated', 50, 4, 7, NULL, NULL, NULL, NULL, 'clinical', NULL, 7, '{"window_key":"overnight","satisfying_states":["resting_in_bed","sleeping"]}'::jsonb),
    ('monitoring_order_review_overdue', 'Monitoring Order past its review date', 'A Monitoring Order is still in force and its review date has passed. An order past review is never silently expired; somebody decides.', 'elevated', 50, 1, 366, NULL, NULL, NULL, NULL, 'clinical', NULL, 8, '{"statuses":["active"]}'::jsonb),
    ('meal_refusal_trend', 'Meals refused three times in a week', 'The meal refused chip appears on three or more observations in the lookback span.', 'informational', 20, 3, 7, NULL, NULL, NULL, NULL, 'clinical', NULL, 9, '{"chip_any":[{"meal_intake":["refused_meal"]}]}'::jsonb),
    ('withdrawal', 'Stopped joining in', 'No activity attendance at all in the lookback span, where the baseline span before it holds at least the threshold number of attendances.', 'informational', 20, 4, 10, 30, NULL, NULL, NULL, 'clinical', NULL, 10, '{"source_table":"activity_attendance"}'::jsonb),
    ('active_monitoring_order', 'Monitoring Order in force', 'This resident is on a Monitoring Order. Context for the reviewer rather than a reason on its own; the order itself is the plan.', 'informational', 20, 1, 366, NULL, NULL, NULL, NULL, 'clinical', NULL, 11, '{"statuses":["active"]}'::jsonb),
    ('care_plan_review_overdue', 'Care plan review past due', 'An open care plan review alert of a due or overdue kind is outstanding for this resident.', 'informational', 20, 1, 1, NULL, NULL, NULL, NULL, 'clinical', NULL, 12, '{"trigger_types":["quarterly_due","quarterly_overdue"],"statuses":["open","acknowledged"]}'::jsonb),
    ('form_1823_due', 'Form 1823 due within a month', 'The resident''s most recent Form 1823 expires inside the lookback span, or has already expired.', 'informational', 20, 1, 30, NULL, NULL, NULL, NULL, 'clinical', 'FL_AHCA', 13, '{"source_table":"form_1823_records"}'::jsonb),
    ('observation_gap', 'Checks with nothing written down', 'The threshold number of consecutive expected observation windows closed with nothing recorded. A documentation lapse, not resident decline, and the board renders it apart from the clinical signals for that reason.', 'informational', 15, 2, 3, NULL, NULL, NULL, NULL, 'data_quality', NULL, 14, '{"source_function":"observation_compliance_for_range"}'::jsonb)
)
INSERT INTO public.watchlist_signal_rules (organization_id, facility_id, signal_key, label, description, severity_class, severity_weight, threshold_count, lookback_days, baseline_days, threshold_percent, secondary_threshold_percent, secondary_lookback_days, source_filter, enabled, source_kind, jurisdiction, sort_order)
SELECT
  co.id,
  NULL,
  ss.signal_key,
  ss.label,
  ss.description,
  ss.severity_class,
  ss.severity_weight,
  ss.threshold_count,
  ss.lookback_days,
  ss.baseline_days,
  ss.threshold_percent,
  ss.secondary_threshold_percent,
  ss.secondary_lookback_days,
  ss.source_filter,
  TRUE,
  ss.source_kind,
  ss.jurisdiction,
  ss.sort_order
FROM
  col_organization co
  CROSS JOIN signal_seed ss
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.watchlist_signal_rules existing
    WHERE
      existing.organization_id = co.id
      AND existing.facility_id IS NULL
      AND existing.signal_key = ss.signal_key
      AND existing.deleted_at IS NULL);

-- ---------------------------------------------------------------------------
-- Seed: the bands.
--
-- Read the table, not this comment, but the shape is:
--
--   Needs a look   any one open signal, including a documentation one
--   Watch          one elevated signal, or three of anything clinical
--   Acute          one critical signal, or two elevated ones
--   Continued residency risk   three clinical signals open past thirty days
--
-- The continued residency rule is keyed to FL_AHCA because it is a regulator's
-- rule and not the organization's. Another jurisdiction gets another row; no
-- code path changes.
-- ---------------------------------------------------------------------------
WITH col_organization AS (
  SELECT
    o.id
  FROM
    public.organizations o
  WHERE
    o.id = '00000000-0000-0000-0000-000000000001'
),
band_seed (rule_key, band_key, band_label, band_rank, min_open_signal_count, min_severity_weight, min_open_days, counts_data_quality, jurisdiction, sort_order) AS (
  VALUES ('needs_a_look_any_signal', 'needs_a_look', 'Needs a look', 1, 1, 0, NULL, TRUE, NULL, 0),
    ('watch_one_elevated', 'watch', 'Watch', 2, 1, 50, NULL, FALSE, NULL, 1),
    ('watch_three_signals', 'watch', 'Watch', 2, 3, 0, NULL, FALSE, NULL, 2),
    ('acute_one_critical', 'acute', 'Acute', 3, 1, 80, NULL, FALSE, NULL, 3),
    ('acute_two_elevated', 'acute', 'Acute', 3, 2, 50, NULL, FALSE, NULL, 4),
    ('continued_residency_risk_thirty_days', 'continued_residency_risk', 'Continued residency risk', 4, 3, 0, 30, FALSE, 'FL_AHCA', 5)
)
INSERT INTO public.watchlist_band_rules (organization_id, facility_id, rule_key, band_key, band_label, band_rank, min_open_signal_count, min_severity_weight, min_open_days, counts_data_quality, enabled, jurisdiction, sort_order)
SELECT
  co.id,
  NULL,
  bs.rule_key,
  bs.band_key,
  bs.band_label,
  bs.band_rank,
  bs.min_open_signal_count,
  bs.min_severity_weight,
  bs.min_open_days,
  bs.counts_data_quality,
  TRUE,
  bs.jurisdiction,
  bs.sort_order
FROM
  col_organization co
  CROSS JOIN band_seed bs
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.watchlist_band_rules existing
    WHERE
      existing.organization_id = co.id
      AND existing.facility_id IS NULL
      AND existing.rule_key = bs.rule_key
      AND existing.deleted_at IS NULL);

-- ---------------------------------------------------------------------------
-- Resolving a rule for a building.
--
-- A facility row wins over the organization default for the same signal_key.
-- Invoker rights, so the settings surface can print exactly the list that is in
-- force at the building the reader is standing in, and no other.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.watchlist_rules_for_facility (p_facility_id uuid)
  RETURNS TABLE (
    id uuid,
    organization_id uuid,
    facility_id uuid,
    signal_key text,
    label text,
    description text,
    severity_class text,
    severity_weight integer,
    threshold_count integer,
    lookback_days integer,
    baseline_days integer,
    threshold_percent numeric,
    secondary_threshold_percent numeric,
    secondary_lookback_days integer,
    source_filter jsonb,
    enabled boolean,
    source_kind text,
    jurisdiction text,
    sort_order integer,
    inherited boolean)
  LANGUAGE sql
  STABLE
  SET search_path = public, haven, pg_catalog
  AS $func$
  SELECT DISTINCT ON (r.signal_key)
    r.id,
    r.organization_id,
    r.facility_id,
    r.signal_key,
    r.label,
    r.description,
    r.severity_class,
    r.severity_weight,
    r.threshold_count,
    r.lookback_days,
    r.baseline_days,
    r.threshold_percent,
    r.secondary_threshold_percent,
    r.secondary_lookback_days,
    r.source_filter,
    r.enabled,
    r.source_kind,
    r.jurisdiction,
    r.sort_order,
    r.facility_id IS NULL
  FROM
    public.watchlist_signal_rules r
    JOIN public.facilities f ON f.id = p_facility_id
      AND f.deleted_at IS NULL
  WHERE
    r.organization_id = f.organization_id
    AND r.deleted_at IS NULL
    AND (r.facility_id IS NULL
      OR r.facility_id = p_facility_id)
  ORDER BY
    r.signal_key,
    (r.facility_id IS NULL);
$func$;

COMMENT ON FUNCTION public.watchlist_rules_for_facility (uuid) IS
  'The Watchlist rules in force at one building: the facility''s own row for a signal where it has one, the organization default otherwise. Invoker rights, so a reader sees only the buildings they can reach.';

REVOKE ALL ON FUNCTION public.watchlist_rules_for_facility (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.watchlist_rules_for_facility (uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The band.
--
-- Three words and a fourth that belongs to a regulator, and not one of them is
-- computed here: the answer is the highest ranked enabled band rule whose
-- condition this resident's open signal set satisfies. Changing where Acute
-- starts is a row edit.
--
-- Returns no row for a resident with no open signals, which is the correct
-- answer: they are not on the Watchlist, and "no band" is not a band.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.watchlist_band_for_resident (p_resident_id uuid)
  RETURNS TABLE (
    band_key text,
    band_label text,
    band_rank integer)
  LANGUAGE sql
  STABLE
  SET search_path = public, haven, pg_catalog
  AS $func$
  WITH open_signal AS (
    SELECT
      i.organization_id,
      i.facility_id,
      i.severity_weight,
      i.source_kind,
      i.first_detected_at
    FROM
      public.watchlist_signal_instances i
    WHERE
      i.resident_id = p_resident_id
      AND i.status <> 'cleared'
      AND i.deleted_at IS NULL
),
scope AS (
  SELECT
    organization_id,
    facility_id
  FROM
    open_signal
  LIMIT 1
),
applicable AS (
  SELECT DISTINCT ON (br.rule_key)
    br.rule_key,
    br.band_key,
    br.band_label,
    br.band_rank,
    br.min_open_signal_count,
    br.min_severity_weight,
    br.min_open_days,
    br.counts_data_quality,
    br.enabled,
    br.sort_order
  FROM
    public.watchlist_band_rules br
    JOIN scope s ON s.organization_id = br.organization_id
  WHERE
    br.deleted_at IS NULL
    AND (br.facility_id IS NULL
      OR br.facility_id = s.facility_id)
  ORDER BY
    br.rule_key,
    (br.facility_id IS NULL)
)
  SELECT
    a.band_key,
    a.band_label,
    a.band_rank
  FROM
    applicable a
  WHERE
    a.enabled
    AND (
      SELECT
        count(*)
      FROM
        open_signal os
      WHERE
        os.severity_weight >= a.min_severity_weight
        AND (a.counts_data_quality
          OR os.source_kind = 'clinical')
        AND (a.min_open_days IS NULL
          OR os.first_detected_at <= now() - make_interval(days => a.min_open_days))) >= a.min_open_signal_count
  ORDER BY
    a.band_rank DESC,
    a.sort_order
  LIMIT 1;
$func$;

COMMENT ON FUNCTION public.watchlist_band_for_resident (uuid) IS
  'The band a resident is in: the highest ranked enabled public.watchlist_band_rules row their open signal set satisfies. Returns no row when they hold no open signal. Invoker rights; the band is a word and never a number.';

REVOKE ALL ON FUNCTION public.watchlist_band_for_resident (uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.watchlist_band_for_resident (uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The evaluator.
--
-- One pass over one building. Every threshold, span, baseline and source filter
-- comes from the rule row the branch is joined to, which is why there is one
-- branch for the three chip signals rather than three, and why turning the
-- weight loss threshold from five percent to four is a row edit.
--
-- A rule with no branch here evaluates to nothing rather than to everything. A
-- disabled rule is not evaluated at all, and its open instances are left where
-- they are: switching a rule off does not resolve the risk somebody already has
-- to answer for, so a human clears those.
--
-- service_role only. It writes on nobody's authority, reads across the whole
-- building, and is the one caller that must not be reachable from a signed in
-- session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_watchlist_signals (p_facility_id uuid, p_as_of timestamptz DEFAULT now())
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility record;
  v_local_date date;
  v_gap record;
  v_opened integer := 0;
  v_refreshed integer := 0;
  v_cleared integer := 0;
  v_notified integer := 0;
  v_matched integer := 0;
  v_gap_matched integer := 0;
BEGIN
  SELECT
    f.id,
    f.organization_id,
    f.entity_id,
    COALESCE(f.timezone, 'UTC') AS timezone INTO v_facility
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_facility.id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'facility_not_found');
  END IF;

  v_local_date := (p_as_of AT TIME ZONE v_facility.timezone)::date;

  CREATE TEMP TABLE IF NOT EXISTS watchlist_eval_match (
    signal_rule_id uuid,
    signal_key text,
    resident_id uuid,
    observed_count integer,
    evidence jsonb
  ) ON COMMIT DROP;
  DELETE FROM watchlist_eval_match;

  INSERT INTO watchlist_eval_match (signal_rule_id, signal_key, resident_id, observed_count, evidence)
  WITH enabled_rules AS (
    SELECT
      *
    FROM
      public.watchlist_rules_for_facility (p_facility_id)
    WHERE
      enabled
),
-- Residents of record at this building. inquiry and pending_admission are not
-- in the building; discharged and deceased are not coming back.
occupants AS (
  SELECT
    res.id AS resident_id
  FROM
    public.residents res
  WHERE
    res.facility_id = p_facility_id
    AND res.deleted_at IS NULL
    AND res.status IN ('active', 'hospital_hold', 'loa')
),
-- A care event that became an incident is counted once, through the incident.
-- Counting both would report one fall as two and put a resident on the repeat
-- fall rule who has fallen once.
resident_events AS (
  SELECT
    i.resident_id,
    i.occurred_at,
    i.id AS source_id,
    'incident'::text AS source_table,
    i.category::text AS event_code
  FROM
    public.incidents i
  WHERE
    i.facility_id = p_facility_id
    AND i.deleted_at IS NULL
    AND i.resident_id IS NOT NULL
    AND i.occurred_at <= p_as_of
    AND i.occurred_at >= p_as_of - interval '400 days'
  UNION ALL
  SELECT
    ce.resident_id,
    ce.occurred_at,
    ce.id,
    'care_event',
    ce.kind
  FROM
    public.care_events ce
  WHERE
    ce.facility_id = p_facility_id
    AND ce.deleted_at IS NULL
    AND ce.resident_id IS NOT NULL
    AND ce.incident_id IS NULL
    AND ce.occurred_at <= p_as_of
    AND ce.occurred_at >= p_as_of - interval '400 days'
),
weights AS (
  SELECT
    d.resident_id,
    d.log_date,
    d.weight_lbs,
    d.id AS source_id
  FROM
    public.daily_logs d
  WHERE
    d.facility_id = p_facility_id
    AND d.deleted_at IS NULL
    AND d.weight_lbs IS NOT NULL
    AND d.weight_lbs > 0
    AND d.log_date <= v_local_date
),
latest_weight AS (
  SELECT DISTINCT ON (w.resident_id)
    w.resident_id,
    w.log_date,
    w.weight_lbs,
    w.source_id
  FROM
    weights w
  ORDER BY
    w.resident_id,
    w.log_date DESC,
    w.source_id
),
attendance AS (
  SELECT
    a.resident_id,
    s.session_date
  FROM
    public.activity_attendance a
    JOIN public.activity_sessions s ON s.id = a.activity_session_id
      AND s.deleted_at IS NULL
      AND NOT s.cancelled
  WHERE
    a.facility_id = p_facility_id
    AND a.deleted_at IS NULL
    AND a.attended
    AND s.session_date <= v_local_date
),
latest_form_1823 AS (
  SELECT DISTINCT ON (fr.resident_id)
    fr.resident_id,
    fr.id AS source_id,
    fr.expiration_date
  FROM
    public.form_1823_records fr
  WHERE
    fr.facility_id = p_facility_id
    AND fr.deleted_at IS NULL
    AND fr.expiration_date IS NOT NULL
  ORDER BY
    fr.resident_id,
    fr.expiration_date DESC,
    fr.id
)
-- Falls, repeat falls, and leaving the building.
SELECT
  r.id,
  r.signal_key,
  e.resident_id,
  count(*)::integer,
  jsonb_build_object('source', 'incidents_and_care_events', 'lookback_days', r.lookback_days, 'threshold_count', r.threshold_count, 'event_count', count(*), 'event_ids', jsonb_agg(DISTINCT e.source_id))
FROM
  enabled_rules r
  JOIN resident_events e ON e.occurred_at >= p_as_of - make_interval(days => r.lookback_days)
    AND ((e.source_table = 'incident'
        AND jsonb_exists(COALESCE(r.source_filter -> 'incident_categories', '[]'::jsonb), e.event_code))
      OR (e.source_table = 'care_event'
        AND jsonb_exists(COALESCE(r.source_filter -> 'care_event_kinds', '[]'::jsonb), e.event_code)))
  JOIN occupants o ON o.resident_id = e.resident_id
WHERE
  r.signal_key IN ('recent_fall', 'repeat_fall', 'elopement_or_wandering')
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.threshold_count,
  e.resident_id
HAVING
  count(*) >= r.threshold_count
UNION ALL
-- Back from hospital. The history row's effective_to is the day they returned.
SELECT
  r.id,
  r.signal_key,
  h.resident_id,
  count(*)::integer,
  jsonb_build_object('source', 'resident_status_history', 'lookback_days', r.lookback_days, 'history_ids', jsonb_agg(DISTINCT h.id), 'returned_count', count(*))
FROM
  enabled_rules r
  JOIN public.resident_status_history h ON h.facility_id = p_facility_id
    AND h.deleted_at IS NULL
    AND jsonb_exists(COALESCE(r.source_filter -> 'statuses', '[]'::jsonb), h.status::text)
    AND h.effective_to IS NOT NULL
    AND h.effective_to <= p_as_of
    AND h.effective_to >= p_as_of - make_interval(days => r.lookback_days)
  JOIN occupants o ON o.resident_id = h.resident_id
WHERE
  r.signal_key = 'post_hospital_window'
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.threshold_count,
  h.resident_id
HAVING
  count(*) >= r.threshold_count
UNION ALL
-- The three chip signals. Containment against chip_selections, never a string
-- match on the composed sentence, and a baseline of zero where the rule carries
-- one, which is what makes behavior change mean changed rather than present.
SELECT
  r.id,
  r.signal_key,
  l.resident_id,
  count(*) FILTER (WHERE l.observed_at >= p_as_of - make_interval(days => r.lookback_days))::integer,
  jsonb_build_object('source', 'resident_observation_logs.chip_selections', 'chip_any', COALESCE(r.source_filter -> 'chip_any', '[]'::jsonb), 'lookback_days', r.lookback_days, 'baseline_days', r.baseline_days, 'threshold_count', r.threshold_count, 'log_ids', COALESCE(jsonb_agg(DISTINCT l.id) FILTER (WHERE l.observed_at >= p_as_of - make_interval(days => r.lookback_days)), '[]'::jsonb), 'baseline_count', count(*) FILTER (WHERE l.observed_at < p_as_of - make_interval(days => r.lookback_days)))
FROM
  enabled_rules r
  JOIN public.resident_observation_logs l ON l.facility_id = p_facility_id
    AND l.deleted_at IS NULL
    AND l.observed_at <= p_as_of
    AND l.observed_at >= p_as_of - make_interval(days => r.lookback_days + COALESCE(r.baseline_days, 0))
    AND EXISTS (
      SELECT
        1
      FROM
        jsonb_array_elements(COALESCE(r.source_filter -> 'chip_any', '[]'::jsonb)) AS pattern
      WHERE
        l.chip_selections @> pattern.value)
  JOIN occupants o ON o.resident_id = l.resident_id
WHERE
  r.signal_key IN ('meal_refusal_trend', 'med_refusal_trend', 'behavior_change')
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.baseline_days,
  r.threshold_count,
  r.source_filter,
  l.resident_id
HAVING
  count(*) FILTER (WHERE l.observed_at >= p_as_of - make_interval(days => r.lookback_days)) >= r.threshold_count
  AND (r.baseline_days IS NULL
    OR count(*) FILTER (WHERE l.observed_at < p_as_of - make_interval(days => r.lookback_days)) = 0)
UNION ALL
-- Awake at the overnight check. This one reads resident_state rather than a
-- chip: there is no sleep chip group, and the settled states are vocabulary
-- codes the rule names.
SELECT
  r.id,
  r.signal_key,
  l.resident_id,
  count(DISTINCT t.service_date)::integer,
  jsonb_build_object('source', 'resident_observation_logs.resident_state', 'window_key', r.source_filter ->> 'window_key', 'satisfying_states', COALESCE(r.source_filter -> 'satisfying_states', '[]'::jsonb), 'lookback_days', r.lookback_days, 'threshold_count', r.threshold_count, 'night_count', count(DISTINCT t.service_date), 'log_ids', jsonb_agg(DISTINCT l.id))
FROM
  enabled_rules r
  JOIN public.resident_observation_tasks t ON t.facility_id = p_facility_id
    AND t.deleted_at IS NULL
    AND t.window_key = (r.source_filter ->> 'window_key')
  JOIN public.resident_observation_logs l ON l.task_id = t.id
    AND l.deleted_at IS NULL
    AND l.resident_state IS NOT NULL
    AND l.observed_at <= p_as_of
    AND l.observed_at >= p_as_of - make_interval(days => r.lookback_days)
    AND NOT jsonb_exists(COALESCE(r.source_filter -> 'satisfying_states', '[]'::jsonb), l.resident_state)
  JOIN occupants o ON o.resident_id = l.resident_id
WHERE
  r.signal_key = 'night_restlessness'
GROUP BY
  r.id,
  r.signal_key,
  r.lookback_days,
  r.threshold_count,
  r.source_filter,
  l.resident_id
HAVING
  count(DISTINCT t.service_date) >= r.threshold_count
UNION ALL
-- Monitoring Orders, in force and past review.
SELECT
  r.id,
  r.signal_key,
  m.resident_id,
  1,
  jsonb_build_object('source', 'resident_monitoring_orders', 'monitoring_order_id', m.id, 'interval_minutes', m.interval_minutes, 'review_due_at', m.review_due_at, 'starts_at', m.starts_at)
FROM
  enabled_rules r
  JOIN public.resident_monitoring_orders m ON m.facility_id = p_facility_id
    AND m.deleted_at IS NULL
    AND jsonb_exists(COALESCE(r.source_filter -> 'statuses', '[]'::jsonb), m.status)
    AND (r.signal_key = 'active_monitoring_order'
      OR (m.review_due_at IS NOT NULL
        AND m.review_due_at <= p_as_of))
  JOIN occupants o ON o.resident_id = m.resident_id
WHERE
  r.signal_key IN ('active_monitoring_order', 'monitoring_order_review_overdue')
UNION ALL
-- Care plan review past due.
SELECT
  r.id,
  r.signal_key,
  a.resident_id,
  count(*)::integer,
  jsonb_build_object('source', 'care_plan_review_alerts', 'trigger_types', COALESCE(r.source_filter -> 'trigger_types', '[]'::jsonb), 'alert_ids', jsonb_agg(DISTINCT a.id), 'alert_count', count(*))
FROM
  enabled_rules r
  JOIN public.care_plan_review_alerts a ON a.facility_id = p_facility_id
    AND a.deleted_at IS NULL
    AND jsonb_exists(COALESCE(r.source_filter -> 'statuses', '[]'::jsonb), a.status)
    AND jsonb_exists(COALESCE(r.source_filter -> 'trigger_types', '[]'::jsonb), a.trigger_type)
  JOIN occupants o ON o.resident_id = a.resident_id
WHERE
  r.signal_key = 'care_plan_review_overdue'
GROUP BY
  r.id,
  r.signal_key,
  r.threshold_count,
  r.source_filter,
  a.resident_id
HAVING
  count(*) >= r.threshold_count
UNION ALL
-- Form 1823 expiring, or already expired.
SELECT
  r.id,
  r.signal_key,
  f.resident_id,
  1,
  jsonb_build_object('source', 'form_1823_records', 'form_1823_record_id', f.source_id, 'expiration_date', f.expiration_date, 'lookback_days', r.lookback_days)
FROM
  enabled_rules r
  JOIN latest_form_1823 f ON f.expiration_date <= v_local_date + r.lookback_days
  JOIN occupants o ON o.resident_id = f.resident_id
WHERE
  r.signal_key = 'form_1823_due'
UNION ALL
-- Stopped joining in. The baseline has to hold attendances before an absence
-- can mean anything, so a building that records no activities at all never
-- fires this.
SELECT
  r.id,
  r.signal_key,
  o.resident_id,
  0,
  jsonb_build_object('source', 'activity_attendance', 'lookback_days', r.lookback_days, 'baseline_days', r.baseline_days, 'baseline_attendances', baseline.n, 'recent_attendances', 0)
FROM
  enabled_rules r
  CROSS JOIN occupants o
  JOIN LATERAL (
    SELECT
      count(*)::integer AS n
    FROM
      attendance att
    WHERE
      att.resident_id = o.resident_id
      AND att.session_date < v_local_date - r.lookback_days
      AND att.session_date >= v_local_date - (r.lookback_days + COALESCE(r.baseline_days, 0))) baseline ON TRUE
WHERE
  r.signal_key = 'withdrawal'
  AND baseline.n >= r.threshold_count
  AND NOT EXISTS (
    SELECT
      1
    FROM
      attendance recent
    WHERE
      recent.resident_id = o.resident_id
      AND recent.session_date >= v_local_date - r.lookback_days)
UNION ALL
-- Weight loss, measured from the highest weight in the span to the latest one.
SELECT
  r.id,
  r.signal_key,
  lw.resident_id,
  1,
  jsonb_build_object('source', 'daily_logs.weight_lbs', 'latest_log_date', lw.log_date, 'latest_daily_log_id', lw.source_id, 'threshold_percent', r.threshold_percent, 'lookback_days', r.lookback_days, 'drop_percent', primary_span.drop_percent, 'secondary_threshold_percent', r.secondary_threshold_percent, 'secondary_lookback_days', r.secondary_lookback_days, 'secondary_drop_percent', secondary_span.drop_percent)
FROM
  enabled_rules r
  JOIN latest_weight lw ON TRUE
  JOIN occupants o ON o.resident_id = lw.resident_id
  LEFT JOIN LATERAL (
    SELECT
      round(((max(w.weight_lbs) - lw.weight_lbs) / NULLIF(max(w.weight_lbs), 0)) * 100, 2) AS drop_percent
    FROM
      weights w
    WHERE
      w.resident_id = lw.resident_id
      AND w.log_date >= v_local_date - r.lookback_days) primary_span ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      round(((max(w.weight_lbs) - lw.weight_lbs) / NULLIF(max(w.weight_lbs), 0)) * 100, 2) AS drop_percent
    FROM
      weights w
    WHERE
      r.secondary_lookback_days IS NOT NULL
      AND w.resident_id = lw.resident_id
      AND w.log_date >= v_local_date - r.secondary_lookback_days) secondary_span ON TRUE
WHERE
  r.signal_key = 'weight_loss'
  AND r.threshold_percent IS NOT NULL
  AND (COALESCE(primary_span.drop_percent, 0) >= r.threshold_percent
    OR (r.secondary_threshold_percent IS NOT NULL
      AND COALESCE(secondary_span.drop_percent, 0) >= r.secondary_threshold_percent));

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- The documentation signal, read from the compliance contract and never
  -- from a count of task rows.
  --
  -- Counting resident_observation_tasks would report a resident on a 30
  -- minute Monitoring Order as missing six windows a day, because while an
  -- order is in force the standard windows stop generating and there is no
  -- task row left to miss. public.observation_compliance_for_range projects
  -- the windows the cadence version in force defines and marks one satisfied
  -- when any log falls inside its span, whichever kind of task produced it.
  -- Consecutive is measured over the projection in window close order.
  -- ---------------------------------------------------------------------
  SELECT
    gap_rule.id,
    gap_rule.threshold_count,
    gap_rule.lookback_days INTO v_gap
  FROM
    public.watchlist_rules_for_facility (p_facility_id) gap_rule
  WHERE
    gap_rule.signal_key = 'observation_gap'
    AND gap_rule.enabled;

  IF v_gap.id IS NOT NULL THEN
    INSERT INTO watchlist_eval_match (signal_rule_id, signal_key, resident_id, observed_count, evidence)
    WITH closed_windows AS (
      SELECT
        c.resident_id,
        c.satisfied,
        c.window_closes_at_utc
      FROM
        public.observation_compliance_for_range (p_facility_id, v_local_date - v_gap.lookback_days, v_local_date) c
      WHERE
        c.window_key IS NOT NULL
        AND c.window_closes_at_utc IS NOT NULL
        AND c.window_closes_at_utc <= p_as_of
),
    islands AS (
      SELECT
        cw.resident_id,
        cw.satisfied,
        cw.window_closes_at_utc,
        row_number() OVER (PARTITION BY cw.resident_id ORDER BY cw.window_closes_at_utc) - row_number() OVER (PARTITION BY cw.resident_id,
          cw.satisfied ORDER BY cw.window_closes_at_utc) AS island
      FROM
        closed_windows cw
),
    runs AS (
      SELECT
        i.resident_id,
        i.island,
        count(*)::integer AS run_length,
        min(i.window_closes_at_utc) AS run_started_at,
        max(i.window_closes_at_utc) AS run_ended_at
      FROM
        islands i
      WHERE
        NOT i.satisfied
      GROUP BY
        i.resident_id,
        i.island
),
    longest AS (
      SELECT DISTINCT ON (r.resident_id)
        r.resident_id,
        r.run_length,
        r.run_started_at,
        r.run_ended_at
      FROM
        runs r
      ORDER BY
        r.resident_id,
        r.run_length DESC,
        r.run_ended_at DESC
)
    SELECT
      v_gap.id,
      'observation_gap',
      l.resident_id,
      l.run_length,
      jsonb_build_object('source', 'observation_compliance_for_range', 'threshold_count', v_gap.threshold_count, 'lookback_days', v_gap.lookback_days, 'consecutive_unrecorded_windows', l.run_length, 'run_started_at', l.run_started_at, 'run_ended_at', l.run_ended_at)
    FROM
      longest l
      JOIN public.residents res ON res.id = l.resident_id
        AND res.facility_id = p_facility_id
        AND res.deleted_at IS NULL
        AND res.status IN ('active', 'hospital_hold', 'loa')
    WHERE
      l.run_length >= v_gap.threshold_count;

    GET DIAGNOSTICS v_gap_matched = ROW_COUNT;
    v_matched := v_matched + v_gap_matched;
  END IF;

  -- ---------------------------------------------------------------------
  -- Refresh what still holds. No status change, so no ledger row: a signal
  -- that has been true for six days is one event, not six.
  -- ---------------------------------------------------------------------
  UPDATE
    public.watchlist_signal_instances i
  SET
    observed_count = m.observed_count,
    evidence = m.evidence,
    last_evaluated_at = GREATEST(p_as_of, i.first_detected_at)
  FROM
    watchlist_eval_match m
  WHERE
    i.facility_id = p_facility_id
    AND i.resident_id = m.resident_id
    AND i.signal_key = m.signal_key
    AND i.status <> 'cleared'
    AND i.deleted_at IS NULL;

  GET DIAGNOSTICS v_refreshed = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- Open what is new. The severity travels onto the instance so a later
  -- threshold edit changes what fires next rather than what a reviewer was
  -- looking at last week.
  -- ---------------------------------------------------------------------
  INSERT INTO public.watchlist_signal_instances (organization_id, entity_id, facility_id, resident_id, signal_rule_id, signal_key, severity_class, severity_weight, source_kind, first_detected_at, last_evaluated_at, observed_count, evidence, status)
  SELECT
    v_facility.organization_id,
    v_facility.entity_id,
    p_facility_id,
    m.resident_id,
    m.signal_rule_id,
    m.signal_key,
    r.severity_class,
    r.severity_weight,
    r.source_kind,
    p_as_of,
    p_as_of,
    m.observed_count,
    m.evidence,
    'new'
  FROM
    watchlist_eval_match m
    JOIN public.watchlist_signal_rules r ON r.id = m.signal_rule_id
  WHERE
    NOT EXISTS (
      SELECT
        1
      FROM
        public.watchlist_signal_instances existing
      WHERE
        existing.resident_id = m.resident_id
        AND existing.signal_key = m.signal_key
        AND existing.status <> 'cleared'
        AND existing.deleted_at IS NULL);

  GET DIAGNOSTICS v_opened = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- Close what no longer holds, but only where the rule is still running.
  -- Switching a rule off does not resolve the risk somebody already has to
  -- answer for, so an instance under a disabled rule stays open until a
  -- person clears it.
  -- ---------------------------------------------------------------------
  UPDATE
    public.watchlist_signal_instances i
  SET
    status = 'cleared',
    cleared_at = p_as_of,
    cleared_reason = 'condition_no_longer_met',
    last_evaluated_at = GREATEST(p_as_of, i.first_detected_at)
  WHERE
    i.facility_id = p_facility_id
    AND i.status <> 'cleared'
    AND i.deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        public.watchlist_rules_for_facility (p_facility_id) running
      WHERE
        running.signal_key = i.signal_key
        AND running.enabled)
    AND NOT EXISTS (
      SELECT
        1
      FROM
        watchlist_eval_match m
      WHERE
        m.resident_id = i.resident_id
        AND m.signal_key = i.signal_key);

  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- Push the Acute ones. Spec section 7.9: the page is where the list is
  -- worked, not where it is discovered. Acute is whatever the band rules say
  -- it is, read from the rows rather than named here, and the stamp means a
  -- re-evaluation on the next tick does not wake anybody twice.
  -- ---------------------------------------------------------------------
  v_notified := haven.notify_watchlist_acute (p_facility_id, p_as_of);

  RETURN jsonb_build_object('ok', TRUE, 'facility_id', p_facility_id, 'evaluated_at', p_as_of, 'matches', v_matched, 'opened', v_opened, 'refreshed', v_refreshed, 'cleared', v_cleared, 'notified', v_notified);
END;
$func$;

COMMENT ON FUNCTION public.evaluate_watchlist_signals (uuid, timestamptz) IS
  'Evaluates every enabled Watchlist rule at one building, opens what is new, refreshes what still holds, closes what no longer does, and queues the Acute pushes. Every threshold, span, baseline and source filter comes from the rule row; nothing is named here. service_role only.';

REVOKE ALL ON FUNCTION public.evaluate_watchlist_signals (uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_watchlist_signals (uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- The Acute push.
--
-- Same resolution care events and Monitoring Orders use: the facility's active
-- notification_routes rows, their staff_role_targets and user_targets, with the
-- administrator fallback that exists so a building which has configured nothing
-- still reaches somebody. No role and no channel is named here beyond that
-- fallback; which channels a route uses is a row.
--
-- What counts as Acute is read from the band rules, not decided here, so moving
-- where Acute starts moves what gets pushed with it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.notify_watchlist_acute (p_facility_id uuid, p_as_of timestamptz DEFAULT now())
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_facility record;
  v_acute_rank integer;
  v_instance record;
  v_route record;
  v_channel text;
  v_rows integer;
  v_queued integer := 0;
  v_had_target boolean;
BEGIN
  SELECT
    f.id,
    f.organization_id INTO v_facility
  FROM
    public.facilities f
  WHERE
    f.id = p_facility_id
    AND f.deleted_at IS NULL;

  IF v_facility.id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT
    min(br.band_rank) INTO v_acute_rank
  FROM
    public.watchlist_band_rules br
  WHERE
    br.organization_id = v_facility.organization_id
    AND br.band_key = 'acute'
    AND br.enabled
    AND br.deleted_at IS NULL
    AND (br.facility_id IS NULL
      OR br.facility_id = p_facility_id);

  IF v_acute_rank IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_instance IN
  SELECT
    i.id,
    i.resident_id
  FROM
    public.watchlist_signal_instances i
  WHERE
    i.facility_id = p_facility_id
    AND i.status <> 'cleared'
    AND i.deleted_at IS NULL
    AND i.acute_notified_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        public.watchlist_band_for_resident (i.resident_id) b
      WHERE
        b.band_rank >= v_acute_rank) LOOP
          v_had_target := FALSE;
          FOR v_route IN
          SELECT
            nr.id,
            nr.name,
            nr.channels,
            nr.staff_role_targets,
            nr.user_targets
          FROM
            public.notification_routes nr
          WHERE
            nr.organization_id = v_facility.organization_id
            AND (nr.facility_id IS NULL
              OR nr.facility_id = p_facility_id)
            AND nr.is_active
            AND nr.deleted_at IS NULL LOOP
              FOREACH v_channel IN ARRAY COALESCE(v_route.channels, ARRAY[]::text[])
              LOOP
                IF v_channel NOT IN ('in_app', 'push', 'sms', 'voice', 'email') THEN
                  CONTINUE;
                END IF;

                INSERT INTO public.watchlist_signal_notifications (organization_id, facility_id, signal_instance_id, notification_route_id, target_role, target_user_id, target_phone, channel, status, send_after)
                SELECT DISTINCT
                  v_facility.organization_id,
                  p_facility_id,
                  v_instance.id,
                  v_route.id,
                  COALESCE(v_route.name, 'route'),
                  recipient.user_id,
                  recipient.phone,
                  v_channel,
                  'queued',
                  p_as_of
                FROM (
                  SELECT
                    s.user_id,
                    NULLIF(btrim(s.phone), '') AS phone
                  FROM
                    public.staff s
                  WHERE
                    s.organization_id = v_facility.organization_id
                    AND s.facility_id = p_facility_id
                    AND s.employment_status = 'active'
                    AND s.deleted_at IS NULL
                    AND s.user_id IS NOT NULL
                    AND v_route.staff_role_targets IS NOT NULL
                    AND s.staff_role = ANY (v_route.staff_role_targets)
                  UNION
                  SELECT
                    up.id,
                    NULLIF(btrim(up.phone), '')
                  FROM
                    public.user_profiles up
                  WHERE
                    v_route.user_targets IS NOT NULL
                    AND up.id = ANY (v_route.user_targets)
                    AND up.organization_id = v_facility.organization_id
                    AND up.is_active
                    AND up.deleted_at IS NULL) recipient
              WHERE
                EXISTS (
                  SELECT
                    1
                  FROM
                    public.user_profiles keep
                  WHERE
                    keep.id = recipient.user_id);

                GET DIAGNOSTICS v_rows = ROW_COUNT;
                v_queued := v_queued + v_rows;
                IF v_rows > 0 THEN
                  v_had_target := TRUE;
                END IF;
              END LOOP;
            END LOOP;

      -- Nothing configured, or nothing the routes resolved to. The
      -- administrator still hears about it.
      IF NOT v_had_target THEN
        INSERT INTO public.watchlist_signal_notifications (organization_id, facility_id, signal_instance_id, notification_route_id, target_role, target_user_id, target_phone, channel, status, send_after)
        SELECT
          v_facility.organization_id,
          p_facility_id,
          v_instance.id,
          NULL,
          up.app_role::text,
          up.id,
          NULLIF(btrim(up.phone), ''),
          'in_app',
          'queued',
          p_as_of
        FROM
          public.user_profiles up
        WHERE
          up.organization_id = v_facility.organization_id
          AND up.is_active
          AND up.deleted_at IS NULL
          AND (up.app_role IN ('owner', 'org_admin')
            OR (up.app_role IN ('facility_admin', 'admin_assistant')
              AND EXISTS (
                SELECT
                  1
                FROM
                  public.user_facility_access ufa
                WHERE
                  ufa.user_id = up.id
                  AND ufa.facility_id = p_facility_id
                  AND ufa.revoked_at IS NULL)));

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_queued := v_queued + v_rows;

        IF v_rows = 0 THEN
          INSERT INTO public.watchlist_signal_notifications (organization_id, facility_id, signal_instance_id, notification_route_id, target_role, target_user_id, target_phone, channel, status, skip_reason, send_after)
            VALUES (v_facility.organization_id, p_facility_id, v_instance.id, NULL, 'facility_administrator', NULL, NULL, 'in_app', 'skipped', 'no_target', p_as_of);
          v_queued := v_queued + 1;
        END IF;
      END IF;

      UPDATE
        public.watchlist_signal_instances
      SET
        acute_notified_at = p_as_of
      WHERE
        id = v_instance.id;
    END LOOP;

  RETURN v_queued;
END;
$func$;

COMMENT ON FUNCTION haven.notify_watchlist_acute (uuid, timestamptz) IS
  'Queues the push for every open Acute signal at a building that has not been pushed yet, through notification_routes, and stamps the instance so the next tick does not wake anybody twice. What counts as Acute is read from public.watchlist_band_rules.';

REVOKE ALL ON FUNCTION haven.notify_watchlist_acute (uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION haven.notify_watchlist_acute (uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- The disposition command.
--
-- The most valuable thing on the page, and the only write a signed in person
-- makes in this module. Forward only: a signal that has a plan against it does
-- not go back to being new, because the ledger is a record of what happened and
-- not a workflow toy.
--
-- A definer, so it must check facility reach itself rather than leaning on row
-- level security, which it bypasses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disposition_watchlist_signal (p_instance_id uuid, p_to_status text, p_note text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  c_order CONSTANT text[] := ARRAY['new', 'acknowledged', 'plan_in_place', 'cleared'];
  v_caller uuid;
  v_role text;
  v_instance record;
  v_note text;
  v_from_rank integer;
  v_to_rank integer;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'A signed in reviewer is required to disposition a Watchlist signal'
      USING ERRCODE = '42501';
  END IF;

  v_role := haven.app_role()::text;
  IF NOT haven.can_disposition_watchlist_signal (v_role) THEN
    RAISE EXCEPTION 'Clinical and facility leaders disposition Watchlist signals'
      USING ERRCODE = '42501';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'Write one line about what was done'
      USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'Keep the disposition line to 2000 characters or fewer'
      USING ERRCODE = '22023';
  END IF;

  v_to_rank := array_position(c_order, p_to_status);
  IF v_to_rank IS NULL THEN
    RAISE EXCEPTION 'Not a Watchlist disposition'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    i.id,
    i.organization_id,
    i.facility_id,
    i.status INTO v_instance
  FROM
    public.watchlist_signal_instances i
  WHERE
    i.id = p_instance_id
    AND i.deleted_at IS NULL;

  IF v_instance.id IS NULL THEN
    RAISE EXCEPTION 'Watchlist signal not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_instance.organization_id <> haven.organization_id () OR v_instance.facility_id NOT IN (
    SELECT
      haven.accessible_facility_ids ()) THEN
    RAISE EXCEPTION 'No access to this facility'
      USING ERRCODE = '42501';
  END IF;

  v_from_rank := array_position(c_order, v_instance.status);
  IF v_to_rank <= v_from_rank THEN
    RAISE EXCEPTION 'A Watchlist signal moves forward only'
      USING ERRCODE = '22023';
  END IF;

  UPDATE
    public.watchlist_signal_instances
  SET
    status = p_to_status,
    disposition_note = v_note,
    owner_user_id = v_caller,
    updated_by = v_caller,
    cleared_at = CASE WHEN p_to_status = 'cleared' THEN
      now()
    ELSE
      NULL
    END,
    cleared_reason = CASE WHEN p_to_status = 'cleared' THEN
      'reviewed'
    ELSE
      NULL
    END
  WHERE
    id = p_instance_id;

  RETURN p_instance_id;
END;
$func$;

COMMENT ON FUNCTION public.disposition_watchlist_signal (uuid, text, text) IS
  'Moves a Watchlist signal forward and records who did it and what was done. Forward only, one line required, and the append only ledger row is written by the trigger rather than by this function so no writer can skip it. COL-37 ruling: definer required -- authenticated holds SELECT and nothing else on watchlist_signal_instances and no grant at all on the disposition ledger, so a reviewer has no invoker path to write either, and the command re-checks the signed in caller, their app_role, the organization and facility access before it writes.';

REVOKE ALL ON FUNCTION public.disposition_watchlist_signal (uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disposition_watchlist_signal (uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The three tiers, as views.
--
-- All three run on the reader's authority. A facility administrator reading the
-- portfolio sees the buildings they can reach and no others, and the resident
-- rows underneath come through row level security on residents, beds and rooms
-- rather than through a predicate written here.
--
-- v_facility_risk_index is the only composite in the module and it carries no
-- resident_id. Neither resident facing view exposes severity_weight, which is
-- the number a composite would be built out of: a facility trend is a
-- management instrument, a resident level 94 is false precision.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_watchlist_portfolio;
DROP VIEW IF EXISTS public.v_watchlist_facility;
DROP VIEW IF EXISTS public.v_facility_risk_index;

CREATE VIEW public.v_facility_risk_index WITH ( security_invoker = TRUE
) AS
WITH facility_day AS (
  SELECT
    f.id AS facility_id,
    f.organization_id,
    COALESCE(f.timezone, 'UTC') AS timezone,
    day_series::date AS service_date
  FROM
    public.facilities f
    CROSS JOIN LATERAL generate_series((now() AT TIME ZONE COALESCE(f.timezone, 'UTC'))::date - 89, (now() AT TIME ZONE COALESCE(f.timezone, 'UTC'))::date, interval '1 day') AS day_series
  WHERE
    f.deleted_at IS NULL
)
SELECT
  fd.organization_id,
  fd.facility_id,
  fd.service_date,
  count(i.id)::integer AS open_signal_count,
  count(i.id) FILTER (WHERE i.severity_class = 'critical')::integer AS critical_signal_count,
  count(i.id) FILTER (WHERE i.severity_class = 'elevated')::integer AS elevated_signal_count,
  count(i.id) FILTER (WHERE i.severity_class = 'informational')::integer AS informational_signal_count,
  count(i.id) FILTER (WHERE i.source_kind = 'data_quality')::integer AS data_quality_signal_count,
  count(DISTINCT i.resident_id)::integer AS residents_with_open_signals,
  census.resident_count AS census,
  -- Weighted clinical signal load per resident of record. Documentation signals
  -- are excluded on purpose: a building that is behind on its paperwork has a
  -- paperwork problem, and letting that move a clinical risk trend is how the
  -- number stops meaning anything.
  round(COALESCE(sum(i.severity_weight) FILTER (WHERE i.source_kind = 'clinical'), 0)::numeric / GREATEST(census.resident_count, 1), 2) AS risk_index
FROM
  facility_day fd
  JOIN LATERAL (
    SELECT
      count(*)::integer AS resident_count
    FROM
      public.residents res
    WHERE
      res.facility_id = fd.facility_id
      AND res.deleted_at IS NULL
      AND res.status NOT IN ('inquiry', 'pending_admission')
      AND res.admission_date IS NOT NULL
      AND res.admission_date <= fd.service_date
      AND (res.discharge_date IS NULL
        OR res.discharge_date >= fd.service_date)) census ON TRUE
  LEFT JOIN public.watchlist_signal_instances i ON i.facility_id = fd.facility_id
    AND i.deleted_at IS NULL
    AND (i.first_detected_at AT TIME ZONE fd.timezone)::date <= fd.service_date
    AND (i.cleared_at IS NULL
      OR (i.cleared_at AT TIME ZONE fd.timezone)::date > fd.service_date)
GROUP BY
  fd.organization_id,
  fd.facility_id,
  fd.service_date,
  census.resident_count;

COMMENT ON VIEW public.v_facility_risk_index IS
  'Ninety days of weighted clinical signal load per resident of record, one row per facility per day. Facility level only: it carries no resident_id and there is no resident equivalent of it anywhere in the module.';

CREATE VIEW public.v_watchlist_facility WITH ( security_invoker = TRUE
) AS
SELECT
  i.organization_id,
  i.facility_id,
  f.name AS facility_name,
  i.resident_id,
  res.first_name AS resident_first_name,
  res.last_name AS resident_last_name,
  res.preferred_name AS resident_preferred_name,
  room.room_number,
  i.id AS signal_instance_id,
  i.signal_key,
  r.label AS signal_label,
  r.description AS signal_description,
  i.severity_class,
  i.source_kind,
  i.status,
  i.first_detected_at,
  i.last_evaluated_at,
  i.observed_count,
  i.evidence,
  (date_part('day', now() - i.first_detected_at))::integer AS days_open,
  i.disposition_note,
  i.owner_user_id,
  owner.full_name AS owner_name,
  band.band_key,
  band.band_label,
  band.band_rank,
  resident_totals.open_signal_count
FROM
  public.watchlist_signal_instances i
  JOIN public.watchlist_signal_rules r ON r.id = i.signal_rule_id
  JOIN public.residents res ON res.id = i.resident_id
  JOIN public.facilities f ON f.id = i.facility_id
  LEFT JOIN public.beds bed ON bed.id = res.bed_id
  LEFT JOIN public.rooms room ON room.id = bed.room_id
  LEFT JOIN public.user_profiles owner ON owner.id = i.owner_user_id
  LEFT JOIN LATERAL public.watchlist_band_for_resident (i.resident_id) band ON TRUE
  JOIN LATERAL (
    SELECT
      count(*)::integer AS open_signal_count
    FROM
      public.watchlist_signal_instances peer
    WHERE
      peer.resident_id = i.resident_id
      AND peer.status <> 'cleared'
      AND peer.deleted_at IS NULL) resident_totals ON TRUE
WHERE
  i.status <> 'cleared'
  AND i.deleted_at IS NULL;

COMMENT ON VIEW public.v_watchlist_facility IS
  'Tier 2. One row per open signal, with the resident, the room, the band, the status and the owner. Carries no score, no percentage and no severity weight: the numbers on it are a count of named signals and an age in days, each of which traces to a row a reader can open.';

CREATE VIEW public.v_watchlist_portfolio WITH ( security_invoker = TRUE
) AS
WITH index_window AS (
  SELECT
    v.facility_id,
    max(v.risk_index) FILTER (WHERE v.service_date = span.max_date) AS risk_index_latest,
    round(avg(v.risk_index) FILTER (WHERE v.service_date > span.max_date - 7), 2) AS risk_index_recent_avg,
    round(avg(v.risk_index) FILTER (WHERE v.service_date <= span.max_date - 7
      AND v.service_date > span.max_date - 14), 2) AS risk_index_prior_avg
  FROM
    public.v_facility_risk_index v
    JOIN (
      SELECT
        facility_id,
        max(service_date) AS max_date
      FROM
        public.v_facility_risk_index
      GROUP BY
        facility_id) span ON span.facility_id = v.facility_id
  GROUP BY
    v.facility_id
)
SELECT
  f.organization_id,
  f.id AS facility_id,
  f.name AS facility_name,
  COALESCE(board.residents_on_watchlist, 0) AS residents_on_watchlist,
  COALESCE(board.open_signal_count, 0) AS open_signal_count,
  COALESCE(board.acute_signal_count, 0) AS open_acute_signal_count,
  COALESCE(board.acute_resident_count, 0) AS acute_resident_count,
  COALESCE(board.data_quality_signal_count, 0) AS data_quality_signal_count,
  board.worst_band_key,
  board.worst_band_label,
  board.worst_band_rank,
  iw.risk_index_latest,
  iw.risk_index_recent_avg,
  iw.risk_index_prior_avg,
  CASE WHEN iw.risk_index_recent_avg IS NULL
    OR iw.risk_index_prior_avg IS NULL THEN
    'unknown'
  WHEN iw.risk_index_recent_avg > iw.risk_index_prior_avg THEN
    'rising'
  WHEN iw.risk_index_recent_avg < iw.risk_index_prior_avg THEN
    'easing'
  ELSE
    'steady'
  END AS trend_direction
FROM
  public.facilities f
  LEFT JOIN LATERAL (
    SELECT
      min(br.band_rank) AS acute_floor
    FROM
      public.watchlist_band_rules br
    WHERE
      br.organization_id = f.organization_id
      AND br.band_key = 'acute'
      AND br.enabled
      AND br.deleted_at IS NULL
      AND (br.facility_id IS NULL
        OR br.facility_id = f.id)) acute ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT w.resident_id)::integer AS residents_on_watchlist,
      count(*)::integer AS open_signal_count,
      count(*) FILTER (WHERE w.source_kind = 'data_quality')::integer AS data_quality_signal_count,
      count(*) FILTER (WHERE acute.acute_floor IS NOT NULL
        AND w.band_rank >= acute.acute_floor
        AND w.source_kind = 'clinical')::integer AS acute_signal_count,
      count(DISTINCT w.resident_id) FILTER (WHERE acute.acute_floor IS NOT NULL
        AND w.band_rank >= acute.acute_floor)::integer AS acute_resident_count,
      max(w.band_rank) AS worst_band_rank,
      (array_agg(w.band_key ORDER BY w.band_rank DESC))[1] AS worst_band_key,
      (array_agg(w.band_label ORDER BY w.band_rank DESC))[1] AS worst_band_label
    FROM
      public.v_watchlist_facility w
    WHERE
      w.facility_id = f.id) board ON TRUE
  LEFT JOIN index_window iw ON iw.facility_id = f.id
WHERE
  f.deleted_at IS NULL;

COMMENT ON VIEW public.v_watchlist_portfolio IS
  'Tier 1. One row per building: how many residents are on the Watchlist, how many open Acute signals, the worst band in the building, and which way the ninety day facility trend is pointing. Facility level throughout.';

REVOKE ALL ON public.v_facility_risk_index, public.v_watchlist_facility, public.v_watchlist_portfolio FROM PUBLIC, anon;
GRANT SELECT ON public.v_facility_risk_index TO authenticated, service_role;
GRANT SELECT ON public.v_watchlist_facility TO authenticated, service_role;
GRANT SELECT ON public.v_watchlist_portfolio TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
