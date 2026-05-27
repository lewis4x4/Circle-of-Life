-- Round 3 post-build audit Bucket 3: DB hardening for migrations 274-284

-- #7: Replace trusted caller-supplied org/user parameters with server-derived identity.
DROP FUNCTION IF EXISTS public.get_nlq_conversation_context(uuid, uuid, uuid, int);

CREATE OR REPLACE FUNCTION public.get_nlq_conversation_context(
  p_session_id uuid,
  p_limit int DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_msgs jsonb;
  v_limit int;
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 12), 0), 50);
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT up.organization_id
    INTO v_org_id
    FROM public.user_profiles up
   WHERE up.id = v_user_id
     AND up.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.message_count, s.rolling_summary_text
    INTO v_session
    FROM public.exec_nlq_sessions s
   WHERE s.id = p_session_id
     AND s.organization_id = v_org_id
     AND (s.user_id = v_user_id OR s.shared_with_org = true)
     AND s.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordinal)
    INTO v_msgs
    FROM (
      SELECT role, content, ordinal
        FROM public.exec_nlq_messages
       WHERE session_id = p_session_id
         AND organization_id = v_org_id
         AND deleted_at IS NULL
         AND role != 'system'
       ORDER BY ordinal DESC
       LIMIT v_limit
    ) m;

  RETURN jsonb_build_object(
    'message_count', COALESCE(v_session.message_count, 0),
    'rolling_summary_text', v_session.rolling_summary_text,
    'messages', COALESCE(v_msgs, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_nlq_conversation_context(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_nlq_conversation_context(uuid, int) FROM anon;
REVOKE ALL ON FUNCTION public.get_nlq_conversation_context(uuid, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_nlq_conversation_context(uuid, int) TO service_role;

-- #8: Make ON DELETE behavior explicit for compliance FKs.
ALTER TABLE public.legal_entities
  DROP CONSTRAINT IF EXISTS legal_entities_entity_id_fkey,
  ADD CONSTRAINT legal_entities_entity_id_fkey
    FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;

ALTER TABLE public.legal_entities
  DROP CONSTRAINT IF EXISTS legal_entities_organization_id_fkey,
  ADD CONSTRAINT legal_entities_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.fl_statutes
  DROP CONSTRAINT IF EXISTS fl_statutes_organization_id_fkey,
  ADD CONSTRAINT fl_statutes_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.background_screenings
  DROP CONSTRAINT IF EXISTS background_screenings_staff_id_fkey,
  ADD CONSTRAINT background_screenings_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;

ALTER TABLE public.background_screenings
  DROP CONSTRAINT IF EXISTS background_screenings_facility_id_fkey,
  ADD CONSTRAINT background_screenings_facility_id_fkey
    FOREIGN KEY (facility_id) REFERENCES public.facilities(id) ON DELETE RESTRICT;

ALTER TABLE public.background_screenings
  DROP CONSTRAINT IF EXISTS background_screenings_organization_id_fkey,
  ADD CONSTRAINT background_screenings_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'background_screenings'
       AND column_name = 'legal_entity_id'
  ) THEN
    ALTER TABLE public.background_screenings
      DROP CONSTRAINT IF EXISTS background_screenings_legal_entity_id_fkey;

    ALTER TABLE public.background_screenings
      ADD CONSTRAINT background_screenings_legal_entity_id_fkey
        FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

-- #9: Add composite RLS index for org + staff lookups.
CREATE INDEX IF NOT EXISTS idx_background_screenings_org_staff
  ON public.background_screenings(organization_id, staff_id)
  WHERE deleted_at IS NULL;

-- #10: Constrain nullable facility enum/range columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_facilities_pharmacy_vendor'
       AND conrelid = 'public.facilities'::regclass
  ) THEN
    ALTER TABLE public.facilities
      ADD CONSTRAINT chk_facilities_pharmacy_vendor
      CHECK (
        pharmacy_vendor IS NULL
        OR pharmacy_vendor IN ('BAYA_PHARMACY', 'NORTH_FLORIDA_PHARMACY')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_facilities_occupancy_pct'
       AND conrelid = 'public.facilities'::regclass
  ) THEN
    ALTER TABLE public.facilities
      ADD CONSTRAINT chk_facilities_occupancy_pct
      CHECK (
        occupancy_pct IS NULL
        OR (occupancy_pct >= 0 AND occupancy_pct <= 100)
      );
  END IF;
END;
$$;
