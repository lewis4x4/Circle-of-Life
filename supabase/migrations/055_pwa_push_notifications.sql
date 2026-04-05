-- Phase 3.5-B: pwa-push-notifications

CREATE TABLE notification_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  user_id uuid NOT NULL REFERENCES auth.users (id),
  endpoint text NOT NULL,
  keys_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now (),
  last_used_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT notification_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX idx_notification_subs_user ON notification_subscriptions (user_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE notification_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_subs_own ON notification_subscriptions
  FOR ALL
  USING (
    user_id = auth.uid ()
    AND organization_id = haven.organization_id ())
  WITH CHECK (
    user_id = auth.uid ()
    AND organization_id = haven.organization_id ());
