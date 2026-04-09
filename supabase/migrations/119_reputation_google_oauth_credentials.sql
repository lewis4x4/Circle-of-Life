-- Module 23 — Google OAuth token storage for reputation (Track D D44; server/service-role only)

CREATE TABLE reputation_google_oauth_credentials (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  access_token text,
  access_token_expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  connected_by uuid REFERENCES auth.users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE reputation_google_oauth_credentials IS 'Google OAuth tokens for future Business Profile / review sync; no user-facing RLS — use service role in Next.js API routes only.';

CREATE INDEX idx_reputation_google_oauth_connected_at ON reputation_google_oauth_credentials (connected_at DESC);

ALTER TABLE reputation_google_oauth_credentials ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: deny all for anon/authenticated; service role bypasses RLS.

CREATE TRIGGER tr_reputation_google_oauth_credentials_set_updated_at
  BEFORE UPDATE ON reputation_google_oauth_credentials
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();
