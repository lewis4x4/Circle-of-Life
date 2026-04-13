-- Migration 171: Med-Tech Shift Cockpit — Core Tables
--
-- Creates 7 tables for the dedicated medication technician cockpit:
--   1. med_tech_shifts        — shift assignments with clock-in/out
--   2. med_tech_shift_residents — denormalized shift↔resident mapping
--   3. med_passes             — every scheduled/PRN administration attempt
--   4. witness_signatures     — immutable audit trail for controlled substances
--   5. prn_events             — PRN requests, dispositions, effectiveness
--   6. shift_tape_events      — append-only cockpit action timeline
--   7. pre_pass_holds         — runtime safety gates against scheduled passes
--
-- Follows Haven conventions: org_id + facility_id denormalization, UUIDs,
-- RLS with haven.* helpers, soft deletes, audit triggers, money in cents.

-- ============================================================
-- 1. MED TECH SHIFTS
-- ============================================================

CREATE TABLE med_tech_shifts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  facility_id      uuid NOT NULL REFERENCES facilities(id),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  shift_start      timestamptz NOT NULL,
  shift_end        timestamptz NOT NULL,
  clocked_in_at    timestamptz,
  clocked_out_at   timestamptz,
  handoff_document_id uuid,
  device_id        text,
  status           text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','active','completed','missed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id),
  updated_by       uuid REFERENCES auth.users(id),
  deleted_at       timestamptz
);

CREATE INDEX idx_med_tech_shifts_user_active
  ON med_tech_shifts(user_id, status) WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX idx_med_tech_shifts_facility_window
  ON med_tech_shifts(facility_id, shift_start, shift_end) WHERE deleted_at IS NULL;

CREATE INDEX idx_med_tech_shifts_org
  ON med_tech_shifts(organization_id) WHERE deleted_at IS NULL;

ALTER TABLE med_tech_shifts ENABLE ROW LEVEL SECURITY;

-- Med tech sees own shifts
CREATE POLICY "Med tech sees own shifts"
  ON med_tech_shifts FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND user_id = auth.uid()
    AND deleted_at IS NULL
  );

-- Clinical + admin roles see all facility shifts
CREATE POLICY "Clinical staff see facility shifts"
  ON med_tech_shifts FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
    AND deleted_at IS NULL
  );

-- Med tech can update own shift (clock in/out)
CREATE POLICY "Med tech updates own shift"
  ON med_tech_shifts FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND user_id = auth.uid()
    AND deleted_at IS NULL
  );

-- Managers can insert/update shifts (scheduling)
CREATE POLICY "Managers manage shifts"
  ON med_tech_shifts FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
  );

CREATE TRIGGER trg_med_tech_shifts_updated_at
  BEFORE UPDATE ON med_tech_shifts
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER trg_med_tech_shifts_audit
  AFTER INSERT OR UPDATE OR DELETE ON med_tech_shifts
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ============================================================
-- 2. MED TECH SHIFT RESIDENTS
-- ============================================================

CREATE TABLE med_tech_shift_residents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id     uuid NOT NULL REFERENCES med_tech_shifts(id) ON DELETE CASCADE,
  resident_id  uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id  uuid NOT NULL REFERENCES facilities(id),
  priority     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shift_id, resident_id)
);

CREATE INDEX idx_shift_residents_shift
  ON med_tech_shift_residents(shift_id);

CREATE INDEX idx_shift_residents_resident
  ON med_tech_shift_residents(resident_id);

ALTER TABLE med_tech_shift_residents ENABLE ROW LEVEL SECURITY;

-- Via shift ownership
CREATE POLICY "See residents via own shift"
  ON med_tech_shift_residents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id
        AND s.user_id = auth.uid()
        AND s.deleted_at IS NULL
    )
  );

-- Clinical staff see all
CREATE POLICY "Clinical staff see shift residents"
  ON med_tech_shift_residents FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
  );

-- Managers can assign residents to shifts
CREATE POLICY "Managers assign shift residents"
  ON med_tech_shift_residents FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
  );

-- ============================================================
-- 3. MED PASSES
-- ============================================================

CREATE TABLE med_passes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  facility_id             uuid NOT NULL REFERENCES facilities(id),
  shift_id                uuid NOT NULL REFERENCES med_tech_shifts(id),
  resident_id             uuid NOT NULL REFERENCES residents(id),
  resident_medication_id  uuid NOT NULL REFERENCES resident_medications(id),
  emar_record_id          uuid REFERENCES emar_records(id),
  scheduled_time          timestamptz,
  administered_time       timestamptz,
  status                  text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','overdue','held','refused','given','missed','error')),
  hold_reason             text,
  refusal_reason          text,
  pre_pass_sweep_result   jsonb,
  barcode_scan_verified   boolean NOT NULL DEFAULT false,
  wristband_scan_verified boolean NOT NULL DEFAULT false,
  geofence_verified       boolean NOT NULL DEFAULT false,
  geofence_distance_ft    numeric(5,2),
  voice_transcript        text,
  voice_audio_url         text,
  administered_by         uuid NOT NULL REFERENCES auth.users(id),
  witnessed_by            uuid REFERENCES auth.users(id),
  witness_required        boolean NOT NULL DEFAULT false,
  controlled_substance    boolean NOT NULL DEFAULT false,
  device_id               text,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users(id),
  updated_by              uuid REFERENCES auth.users(id),
  deleted_at              timestamptz
);

CREATE INDEX idx_med_passes_shift_status
  ON med_passes(shift_id, status) WHERE deleted_at IS NULL;

CREATE INDEX idx_med_passes_resident_recent
  ON med_passes(resident_id, administered_time DESC) WHERE deleted_at IS NULL;

CREATE INDEX idx_med_passes_scheduled
  ON med_passes(scheduled_time) WHERE status = 'pending' AND deleted_at IS NULL;

CREATE INDEX idx_med_passes_org
  ON med_passes(organization_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_med_passes_facility
  ON med_passes(facility_id) WHERE deleted_at IS NULL;

ALTER TABLE med_passes ENABLE ROW LEVEL SECURITY;

-- Med tech sees own shift's passes
CREATE POLICY "Med tech sees own shift passes"
  ON med_passes FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL
    )
    AND deleted_at IS NULL
  );

-- Med tech can update own shift's passes
CREATE POLICY "Med tech updates own shift passes"
  ON med_passes FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL
    )
    AND deleted_at IS NULL
  );

-- Med tech can insert passes for own shift
CREATE POLICY "Med tech inserts own shift passes"
  ON med_passes FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL
    )
  );

-- Clinical staff read all facility passes
CREATE POLICY "Clinical staff read facility passes"
  ON med_passes FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
    AND deleted_at IS NULL
  );

CREATE TRIGGER trg_med_passes_updated_at
  BEFORE UPDATE ON med_passes
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER trg_med_passes_audit
  AFTER INSERT OR UPDATE OR DELETE ON med_passes
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ============================================================
-- 4. WITNESS SIGNATURES (immutable — no UPDATE/DELETE policies)
-- ============================================================

CREATE TABLE witness_signatures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  facility_id       uuid NOT NULL REFERENCES facilities(id),
  med_pass_id       uuid NOT NULL REFERENCES med_passes(id) ON DELETE RESTRICT,
  witness_user_id   uuid NOT NULL REFERENCES auth.users(id),
  signature_method  text NOT NULL CHECK (signature_method IN ('pin','biometric','nfc')),
  signature_hash    text NOT NULL,
  device_id         text NOT NULL,
  ip_address        inet,
  signed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_witness_med_pass ON witness_signatures(med_pass_id);

ALTER TABLE witness_signatures ENABLE ROW LEVEL SECURITY;

-- Read: pass actors + clinical staff
CREATE POLICY "Pass actors and clinical staff read witness sigs"
  ON witness_signatures FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND (
      EXISTS (
        SELECT 1 FROM med_passes mp
        WHERE mp.id = med_pass_id
          AND (mp.administered_by = auth.uid() OR mp.witnessed_by = auth.uid())
      )
      OR (
        facility_id IN (SELECT haven.accessible_facility_ids())
        AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
      )
    )
  );

-- Insert only — no update or delete
CREATE POLICY "Authenticated users insert witness signatures"
  ON witness_signatures FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
  );

-- Revoke UPDATE/DELETE from authenticated role
REVOKE UPDATE, DELETE ON witness_signatures FROM authenticated;

CREATE TRIGGER trg_witness_signatures_audit
  AFTER INSERT ON witness_signatures
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ============================================================
-- 5. PRN EVENTS
-- ============================================================

CREATE TABLE prn_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id),
  facility_id              uuid NOT NULL REFERENCES facilities(id),
  resident_id              uuid NOT NULL REFERENCES residents(id),
  shift_id                 uuid NOT NULL REFERENCES med_tech_shifts(id),
  resident_medication_id   uuid REFERENCES resident_medications(id),
  requested_at             timestamptz NOT NULL DEFAULT now(),
  request_reason           text NOT NULL,
  pain_score               integer CHECK (pain_score BETWEEN 0 AND 10),
  disposition              text CHECK (disposition IN ('given','held','nurse_escalated','refused')),
  disposition_at           timestamptz,
  med_pass_id              uuid REFERENCES med_passes(id),
  effectiveness_rating     integer CHECK (effectiveness_rating BETWEEN 0 AND 10),
  effectiveness_charted_at timestamptz,
  effectiveness_notes      text,
  nurse_notified_user_id   uuid REFERENCES auth.users(id),
  follow_up_due_at         timestamptz,
  created_by               uuid NOT NULL REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid REFERENCES auth.users(id),
  deleted_at               timestamptz
);

CREATE INDEX idx_prn_resident_recent
  ON prn_events(resident_id, requested_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX idx_prn_follow_up_due
  ON prn_events(follow_up_due_at) WHERE effectiveness_rating IS NULL AND deleted_at IS NULL;

CREATE INDEX idx_prn_shift
  ON prn_events(shift_id) WHERE deleted_at IS NULL;

ALTER TABLE prn_events ENABLE ROW LEVEL SECURITY;

-- Med tech sees own shift PRNs
CREATE POLICY "Med tech sees own shift PRNs"
  ON prn_events FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL
    )
    AND deleted_at IS NULL
  );

-- Med tech manages own shift PRNs
CREATE POLICY "Med tech manages own shift PRNs"
  ON prn_events FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL
    )
    AND deleted_at IS NULL
  );

-- Clinical staff read
CREATE POLICY "Clinical staff read facility PRNs"
  ON prn_events FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
    AND deleted_at IS NULL
  );

CREATE TRIGGER trg_prn_events_updated_at
  BEFORE UPDATE ON prn_events
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER trg_prn_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON prn_events
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ============================================================
-- 6. SHIFT TAPE EVENTS (append-only timeline)
-- ============================================================

CREATE TABLE shift_tape_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id     uuid NOT NULL REFERENCES facilities(id),
  shift_id        uuid NOT NULL REFERENCES med_tech_shifts(id) ON DELETE CASCADE,
  resident_id     uuid REFERENCES residents(id),
  event_type      text NOT NULL,
  event_ref_table text,
  event_ref_id    uuid,
  summary         text NOT NULL,
  metadata        jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tape_shift_time
  ON shift_tape_events(shift_id, occurred_at DESC);

CREATE INDEX idx_tape_org
  ON shift_tape_events(organization_id);

ALTER TABLE shift_tape_events ENABLE ROW LEVEL SECURITY;

-- Med tech sees own shift tape
CREATE POLICY "Med tech sees own shift tape"
  ON shift_tape_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL
    )
  );

-- Med tech appends to own shift tape
CREATE POLICY "Med tech appends to own shift tape"
  ON shift_tape_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM med_tech_shifts s
      WHERE s.id = shift_id AND s.user_id = auth.uid() AND s.deleted_at IS NULL
    )
  );

-- Clinical staff read
CREATE POLICY "Clinical staff read shift tape"
  ON shift_tape_events FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse')
  );

-- No update/delete — append only
REVOKE UPDATE, DELETE ON shift_tape_events FROM authenticated;

CREATE TRIGGER trg_shift_tape_events_audit
  AFTER INSERT ON shift_tape_events
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ============================================================
-- 7. PRE-PASS HOLDS
-- ============================================================

CREATE TABLE pre_pass_holds (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  facility_id            uuid NOT NULL REFERENCES facilities(id),
  resident_id            uuid NOT NULL REFERENCES residents(id),
  resident_medication_id uuid REFERENCES resident_medications(id),
  hold_type              text NOT NULL
    CHECK (hold_type IN ('vitals_ooR','npo','nurse_hold','fall_recent','new_allergy','med_interaction','other')),
  reason                 text NOT NULL,
  triggered_by           text NOT NULL,
  source_ref             jsonb,
  active                 boolean NOT NULL DEFAULT true,
  cleared_by             uuid REFERENCES auth.users(id),
  cleared_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_holds_resident_active
  ON pre_pass_holds(resident_id, active) WHERE active = true;

CREATE INDEX idx_holds_facility
  ON pre_pass_holds(facility_id) WHERE active = true;

ALTER TABLE pre_pass_holds ENABLE ROW LEVEL SECURITY;

-- Clinical roles read holds
CREATE POLICY "Clinical staff read holds"
  ON pre_pass_holds FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('med_tech','nurse','owner','org_admin','facility_admin')
  );

-- Nurses/managers create holds
CREATE POLICY "Nurses create holds"
  ON pre_pass_holds FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse','owner','org_admin','facility_admin')
  );

-- Nurses/managers clear holds
CREATE POLICY "Nurses clear holds"
  ON pre_pass_holds FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('nurse','owner','org_admin','facility_admin')
  );

CREATE TRIGGER trg_pre_pass_holds_audit
  AFTER INSERT OR UPDATE ON pre_pass_holds
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ============================================================
-- NOTIFY PostgREST to pick up new tables
-- ============================================================

NOTIFY pgrst, 'reload schema';
