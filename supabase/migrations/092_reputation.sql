-- Phase 6: Reputation (spec 23-reputation) — listings + reply workflow

CREATE TYPE reputation_platform AS ENUM (
  'google_business',
  'yelp',
  'facebook',
  'caring_com',
  'other'
);

CREATE TYPE reputation_reply_status AS ENUM (
  'draft',
  'posted',
  'failed'
);

CREATE TABLE reputation_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  platform reputation_platform NOT NULL DEFAULT 'other',
  label text NOT NULL,
  external_place_id text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_reputation_accounts_facility ON reputation_accounts (facility_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE reputation_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  reputation_account_id uuid NOT NULL REFERENCES reputation_accounts (id) ON DELETE CASCADE,
  external_review_id text,
  review_excerpt text,
  reply_body text NOT NULL,
  status reputation_reply_status NOT NULL DEFAULT 'draft',
  posted_to_platform_at timestamptz,
  posted_by_user_id uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz
);

CREATE INDEX idx_reputation_replies_facility ON reputation_replies (facility_id, created_at DESC)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_reputation_replies_account ON reputation_replies (reputation_account_id, created_at DESC)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE reputation_accounts IS 'External review listings per facility; RLS spec 23.';

COMMENT ON TABLE reputation_replies IS 'Review replies with posted_by_user_id audit; RLS spec 23.';

ALTER TABLE reputation_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY reputation_accounts_select ON reputation_accounts
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY reputation_accounts_write ON reputation_accounts
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

ALTER TABLE reputation_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY reputation_replies_select ON reputation_replies
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY reputation_replies_write ON reputation_replies
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_reputation_accounts_set_updated_at
  BEFORE UPDATE ON reputation_accounts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_reputation_accounts_audit
  AFTER INSERT OR UPDATE OR DELETE ON reputation_accounts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_reputation_replies_set_updated_at
  BEFORE UPDATE ON reputation_replies
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_reputation_replies_audit
  AFTER INSERT OR UPDATE OR DELETE ON reputation_replies
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
