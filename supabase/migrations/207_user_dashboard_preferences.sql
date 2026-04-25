-- UI-V2 S2: per-user dashboard preferences.

CREATE TABLE IF NOT EXISTS public.user_dashboard_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard_id text NOT NULL,
  column_order text[] NOT NULL DEFAULT '{}',
  column_visibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_views jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (user_id, dashboard_id)
);

ALTER TABLE public.user_dashboard_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_dashboard_preferences_select ON public.user_dashboard_preferences
  FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY user_dashboard_preferences_insert ON public.user_dashboard_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_dashboard_preferences_update ON public.user_dashboard_preferences
  FOR UPDATE USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY user_dashboard_preferences_delete ON public.user_dashboard_preferences
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS user_dashboard_preferences_user_dashboard_idx
  ON public.user_dashboard_preferences (user_id, dashboard_id);

CREATE TRIGGER user_dashboard_preferences_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.user_dashboard_preferences
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

COMMENT ON TABLE public.user_dashboard_preferences IS
  'Per-user dashboard customization: column order, visibility, and saved views. UI-V2 S2.';
