-- COL V2 Slice 10: activity session confirmations + family message delivery metadata

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activity_sessions'
      AND column_name = 'confirmed_by_user_id'
  ) THEN
    ALTER TABLE public.activity_sessions
      ADD COLUMN confirmed_by_user_id uuid REFERENCES public.user_profiles(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activity_sessions'
      AND column_name = 'confirmed_by_initials'
  ) THEN
    ALTER TABLE public.activity_sessions
      ADD COLUMN confirmed_by_initials text;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activity_sessions'
      AND column_name = 'confirmed_at'
  ) THEN
    ALTER TABLE public.activity_sessions
      ADD COLUMN confirmed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activity_sessions'
      AND column_name = 'provider_type'
  ) THEN
    ALTER TABLE public.activity_sessions
      ADD COLUMN provider_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activity_sessions'
      AND column_name = 'provider_name'
  ) THEN
    ALTER TABLE public.activity_sessions
      ADD COLUMN provider_name text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activity_sessions_provider_type_check'
      AND conrelid = 'public.activity_sessions'::regclass
  ) THEN
    ALTER TABLE public.activity_sessions
      ADD CONSTRAINT activity_sessions_provider_type_check
      CHECK (provider_type IS NULL OR provider_type IN ('facility_staff', 'external'));
  END IF;
END $$;

CREATE OR REPLACE VIEW public.daily_activity_completion_check
WITH (security_invoker = true) AS
SELECT
  activity_sessions.facility_id,
  activity_sessions.organization_id,
  activity_sessions.session_date,
  COUNT(*) AS scheduled_count,
  COUNT(*) FILTER (WHERE activity_sessions.cancelled = false) AS active_scheduled_count,
  COUNT(*) FILTER (
    WHERE activity_sessions.cancelled = false
      AND activity_sessions.confirmed_at IS NOT NULL
  ) AS completed_count,
  (
    COUNT(*) FILTER (
      WHERE activity_sessions.cancelled = false
        AND activity_sessions.confirmed_at IS NOT NULL
    ) < 2
  ) AS below_minimum_threshold
FROM public.activity_sessions
WHERE activity_sessions.deleted_at IS NULL
GROUP BY
  activity_sessions.facility_id,
  activity_sessions.organization_id,
  activity_sessions.session_date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'family_portal_messages'
      AND column_name = 'delivery_method'
  ) THEN
    ALTER TABLE public.family_portal_messages
      ADD COLUMN delivery_method text NOT NULL DEFAULT 'portal_only';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'family_portal_messages'
      AND column_name = 'family_acknowledged_at'
  ) THEN
    ALTER TABLE public.family_portal_messages
      ADD COLUMN family_acknowledged_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'family_portal_messages_delivery_method_check'
      AND conrelid = 'public.family_portal_messages'::regclass
  ) THEN
    ALTER TABLE public.family_portal_messages
      ADD CONSTRAINT family_portal_messages_delivery_method_check
      CHECK (delivery_method IN ('portal_only', 'portal_and_email', 'portal_and_sms', 'portal_and_call'));
  END IF;
END $$;
