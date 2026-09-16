-- 07A "Something happened" capture: care events, delivery ledger, follow-up
-- protocols, escalation policies, and the private incident photo bucket.
--
-- Spec: docs/specs/07A-something-happened-capture.md section 6.2.
-- Level engine contract: docs/specs/07A-level-engine-contract.md.
--
-- A care event is the one row a caregiver writes from the three-tap flow. The
-- level, category, flags and factual sentence are derived on the server by
-- public.care_event_derive (402); the caregiver never picks a severity. The
-- fan-out into incidents, behavioral_logs, condition_changes, incident_followups,
-- regulatory_reporting_obligations, exec_alerts and care_event_deliveries is
-- done by public.submit_care_event (402) inside one transaction.
--
-- No named person appears in this file. Routing reads configuration rows.

BEGIN;

-- ---------------------------------------------------------------------------
-- care_events
-- ---------------------------------------------------------------------------
CREATE TABLE public.care_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid REFERENCES public.residents(id),
  client_event_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fall','injury_found','condition_change','behavior','wandering','medication','family_complaint','environment')),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  derived_level incident_severity NOT NULL,
  final_level incident_severity NOT NULL,
  level_bumped_by_reporter boolean NOT NULL DEFAULT false,
  level_changed_by uuid REFERENCES public.user_profiles(id),
  level_changed_at timestamptz,
  level_change_reason text,
  category incident_category NOT NULL,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  sentence text NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  location_code text,
  reported_by uuid NOT NULL REFERENCES public.user_profiles(id),
  captured_offline boolean NOT NULL DEFAULT false,
  incident_id uuid REFERENCES public.incidents(id),
  behavioral_log_id uuid REFERENCES public.behavioral_logs(id),
  condition_change_id uuid REFERENCES public.condition_changes(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','closed')),
  acknowledged_by uuid REFERENCES public.user_profiles(id),
  acknowledged_at timestamptz,
  closed_by uuid REFERENCES public.user_profiles(id),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, client_event_id)
);

CREATE INDEX idx_care_events_resident ON public.care_events (resident_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_care_events_facility_open ON public.care_events (facility_id, final_level, occurred_at DESC) WHERE deleted_at IS NULL AND status <> 'closed';
CREATE INDEX idx_care_events_reporter ON public.care_events (reported_by, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_care_events_incident ON public.care_events (incident_id) WHERE incident_id IS NOT NULL;

COMMENT ON TABLE public.care_events IS
  'One row per "Something happened" capture. Level, category, flags and sentence are server-derived; see docs/specs/07A-level-engine-contract.md.';
COMMENT ON COLUMN public.care_events.answers IS
  'Flat object of the caregiver tap answers keyed per kind (docs/specs/07A-level-engine-contract.md section 2). The administrator completion form writes under answers->''admin'' and never replaces the caregiver keys.';
COMMENT ON COLUMN public.care_events.flags IS
  'Exactly the eight boolean keys of docs/specs/07A-level-engine-contract.md section 6: ahca_reportable, insurance_reportable, dcf_report_required, grievance_clock, neuro_checks, call_911_prompt, photo_prompt, emar_reminder.';
COMMENT ON COLUMN public.care_events.derived_level IS
  'Level before the reporter bump. Never changed after insert; the original stays on the row when an administrator lowers final_level.';

-- ---------------------------------------------------------------------------
-- care_event_deliveries: one row per target per channel per escalation step
-- ---------------------------------------------------------------------------
CREATE TABLE public.care_event_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  care_event_id uuid NOT NULL REFERENCES public.care_events(id) ON DELETE CASCADE,
  escalation_step integer NOT NULL DEFAULT 0 CHECK (escalation_step >= 0),
  target_role text,
  target_user_id uuid REFERENCES public.user_profiles(id),
  target_phone text,
  channel text NOT NULL CHECK (channel IN ('in_app','push','sms','voice')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','skipped','acknowledged')),
  skip_reason text,
  provider_message_id text,
  error_message text,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_care_event_deliveries_queue ON public.care_event_deliveries (status, send_after) WHERE status = 'queued';
CREATE INDEX idx_care_event_deliveries_event ON public.care_event_deliveries (care_event_id, escalation_step);

COMMENT ON TABLE public.care_event_deliveries IS
  'Delivery ledger for care events: "was the Administrator told" is a query over this table, not a checkbox. Written only by definer functions and the care-event-dispatcher Edge Function.';

-- ---------------------------------------------------------------------------
-- incident_followup_protocols: which follow-up tasks a kind and level create
-- ---------------------------------------------------------------------------
CREATE TABLE public.incident_followup_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  kind text NOT NULL,
  min_level incident_severity NOT NULL,
  requires_flag text,
  task_type text NOT NULL,
  description text NOT NULL,
  due_offset_minutes integer NOT NULL,
  repeat_every_minutes integer,
  repeat_until_minutes integer,
  assign_to_role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_incident_followup_protocols_org_kind ON public.incident_followup_protocols (organization_id, kind, min_level) WHERE deleted_at IS NULL AND is_active;

COMMENT ON TABLE public.incident_followup_protocols IS
  'Follow-up task templates by kind and minimum level. kind = ''any'' applies to every kind. facility_id NULL is the organization default; a facility row with the same task_type wins. Timers live here, not in function code.';

-- ---------------------------------------------------------------------------
-- care_event_escalation_policies: who is told, on which channel, after how long
-- ---------------------------------------------------------------------------
CREATE TABLE public.care_event_escalation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  level incident_severity NOT NULL,
  ack_within_minutes integer,
  step integer NOT NULL,
  after_minutes integer NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('route','on_call_primary','on_call_secondary')),
  notification_route_id uuid REFERENCES public.notification_routes(id),
  channels text[] NOT NULL,
  repeat_every_minutes integer,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (organization_id, facility_id, level, step)
);

CREATE INDEX idx_care_event_escalation_policies_org_level ON public.care_event_escalation_policies (organization_id, level, step) WHERE is_active;

COMMENT ON TABLE public.care_event_escalation_policies IS
  'Escalation ladder per level. Facility rows override the organization default (facility_id NULL) as a whole set. after_minutes is measured from care_events.created_at; repeat_every_minutes repeats the step until acknowledgment.';

-- ---------------------------------------------------------------------------
-- notification_routes: explicit recipient extension (HAVEN_BRAIN 6.4)
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_routes ADD COLUMN IF NOT EXISTS user_targets uuid[];

COMMENT ON COLUMN public.notification_routes.user_targets IS
  'Explicit user_profiles ids added to the route in addition to staff_role_targets. Configured on the settings page, never in a migration.';

-- ---------------------------------------------------------------------------
-- Private incident-photos bucket. Path law: <organization_id>/<facility_id>/<care_event_id>/<file>
-- (append_care_event_note validates the prefix; the policies scope on the first two segments).
-- Guarded so the replay stub (which carries a minimal storage schema) and a
-- hosted project both pass; every policy is dropped before it is created.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN

    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES (
        'incident-photos',
        'incident-photos',
        false,
        15728640,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
      )
      ON CONFLICT (id) DO UPDATE SET
        public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types
    $sql$;

    EXECUTE 'DROP POLICY IF EXISTS incident_photos_storage_read ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY incident_photos_storage_read ON storage.objects
        FOR SELECT
        TO authenticated
        USING (
          bucket_id = 'incident-photos'
          AND split_part(name, '/', 1) = haven.organization_id()::text
          AND (CASE WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN split_part(name, '/', 2)::uuid END)
              IN (SELECT haven.accessible_facility_ids())
          AND haven.app_role() IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech')
        )
    $sql$;

    EXECUTE 'DROP POLICY IF EXISTS incident_photos_storage_insert ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY incident_photos_storage_insert ON storage.objects
        FOR INSERT
        TO authenticated
        WITH CHECK (
          bucket_id = 'incident-photos'
          AND split_part(name, '/', 1) = haven.organization_id()::text
          AND (CASE WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN split_part(name, '/', 2)::uuid END)
              IN (SELECT haven.accessible_facility_ids())
          AND haven.app_role() IN ('owner','org_admin','facility_admin','manager','admin_assistant','coordinator','nurse','caregiver','med_tech')
        )
    $sql$;

    EXECUTE 'DROP POLICY IF EXISTS incident_photos_storage_delete ON storage.objects';
    EXECUTE $sql$
      CREATE POLICY incident_photos_storage_delete ON storage.objects
        FOR DELETE
        TO authenticated
        USING (
          bucket_id = 'incident-photos'
          AND split_part(name, '/', 1) = haven.organization_id()::text
          AND (CASE WHEN split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN split_part(name, '/', 2)::uuid END)
              IN (SELECT haven.accessible_facility_ids())
          AND haven.app_role() IN ('owner','org_admin','facility_admin')
        )
    $sql$;
  END IF;
END
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
