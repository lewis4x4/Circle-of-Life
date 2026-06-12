-- ============================================================================
-- 292_office_document_acknowledgments.sql
-- Module 35 (Office Suite) — F2-3 E-signature + read-acknowledgment
--
-- Acknowledgment requirements layered on PUBLISHED KB documents (F0-4: the KB
-- publish flow is the only path to staff-facing policy; this segment never
-- bypasses it). Per-role requirements + an immutable typed-name e-signature
-- log. Direct AHCA survey evidence → audit-logged, soft deletes, no UPDATE on
-- signatures.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- document_acknowledgment_requirements
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_acknowledgment_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  document_id uuid NOT NULL REFERENCES public.documents(id),
  -- Snapshot so the dashboard stays legible if the KB title changes
  document_title text NOT NULL,

  -- app_role enum values (text[] so role additions don't need a migration here)
  required_roles text[] NOT NULL DEFAULT '{}',
  -- true → typed-name e-signature attestation; false → simple "mark as read"
  require_signature boolean NOT NULL DEFAULT true,
  due_date date,
  note text,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_doc_ack_requirements_facility
  ON document_acknowledgment_requirements(facility_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_ack_requirements_document_id
  ON document_acknowledgment_requirements(document_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- document_acknowledgments (immutable signature log)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),

  requirement_id uuid NOT NULL REFERENCES document_acknowledgment_requirements(id),
  document_id uuid NOT NULL REFERENCES public.documents(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),

  -- Typed-name e-signature: the staff member types their full legal name as
  -- the attestation. Stored verbatim with their role at signature time.
  signature_name text NOT NULL,
  signer_role text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,

  CONSTRAINT document_acknowledgments_once_per_user UNIQUE (requirement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_acknowledgments_requirement
  ON document_acknowledgments(requirement_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_acknowledgments_user
  ON document_acknowledgments(user_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER doc_ack_requirements_set_updated_at
  BEFORE UPDATE ON document_acknowledgment_requirements
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TRIGGER doc_acknowledgments_set_updated_at
  BEFORE UPDATE ON document_acknowledgments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS (enabled before any data lands)
-- ----------------------------------------------------------------------------

ALTER TABLE document_acknowledgment_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_acknowledgments ENABLE ROW LEVEL SECURITY;

-- requirements: all facility staff read (they must see what applies to them);
-- admin roles manage.

CREATE POLICY "Staff see acknowledgment requirements in accessible facilities"
  ON document_acknowledgment_requirements FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

CREATE POLICY "Admins create acknowledgment requirements"
  ON document_acknowledgment_requirements FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

CREATE POLICY "Admins update acknowledgment requirements"
  ON document_acknowledgment_requirements FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
  );

-- acknowledgments: staff sign for THEMSELVES only; admins read the dashboard;
-- signers can read their own rows. No UPDATE policy at all — a signature is
-- immutable survey evidence (soft delete would also be an UPDATE, so even
-- admins cannot alter a signature; corrections happen by new requirement).

CREATE POLICY "Staff sign acknowledgments for themselves"
  ON document_acknowledgments FOR INSERT WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND user_id = auth.uid()
  );

CREATE POLICY "Signers and admins see acknowledgments"
  ON document_acknowledgments FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (
      user_id = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator')
    )
  );

-- No UPDATE or DELETE policies on document_acknowledgments. Ever.

-- ----------------------------------------------------------------------------
-- Audit triggers (AHCA survey evidence)
-- ----------------------------------------------------------------------------

CREATE TRIGGER doc_ack_requirements_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON document_acknowledgment_requirements
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

CREATE TRIGGER doc_acknowledgments_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON document_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION haven_capture_audit_log();

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE document_acknowledgment_requirements IS
  'Per-role read/sign requirements layered on published KB documents (F0-4 publish flow). Module 35 F2-3.';

COMMENT ON TABLE document_acknowledgments IS
  'Immutable typed-name e-signature log (one per user per requirement); AHCA survey evidence. Module 35 F2-3.';
