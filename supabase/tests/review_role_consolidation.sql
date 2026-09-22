-- Role consolidation (Brian, 2026-09-22), migration 464. Fails the replay if a later
-- migration grants a retired role again:
--   nurse, caregiver -> med_tech        dietary, dietary_aide -> cook        + marketing
-- Retired literals may remain only inside exclusion lists (NOT IN / <> ALL), where they
-- exclude nobody.
BEGIN;
DO $probe$
DECLARE v text;
  granting text := '(= ANY \(ARRAY\[[^]]*|[^T] IN \([^)]*|[^!<>]= )''(nurse|caregiver|dietary|dietary_aide)''';
  -- A negative list naming an administrator is an allow-list guard ("NOT IN (allowed) THEN RAISE").
  guard text := '(NOT IN \(|<> ALL \(ARRAY\[)[^])]*''(owner|org_admin|facility_admin)''[^])]*''(nurse|caregiver|dietary|dietary_aide)''|(NOT IN \(|<> ALL \(ARRAY\[)[^])]*''(nurse|caregiver|dietary|dietary_aide)''[^])]*''(owner|org_admin|facility_admin)''';
BEGIN
  SELECT string_agg(schemaname||'.'||tablename||'.'||policyname, ', ') INTO v FROM pg_policies
    WHERE (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ granting
       OR (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ guard;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'Policies grant a retired role: %', v; END IF;

  SELECT string_agg(n.nspname||'.'||p.proname, ', ') INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','haven') AND (p.prosrc ~ granting OR p.prosrc ~ guard)
      AND p.proname NOT IN ('role_tier','submit_care_event');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'Functions grant a retired role: %', v; END IF;

  IF haven.role_tier('med_tech') <> 50 OR haven.role_tier('cook') <> 40 OR haven.role_tier('marketing') <> 50 THEN
    RAISE EXCEPTION 'role_tier: med_tech 50, cook 40, marketing 50';
  END IF;
  IF NOT (ARRAY['cook','housekeeper','marketing','med_tech'] <@ enum_range(NULL::public.app_role)::text[]) THEN
    RAISE EXCEPTION 'cook, housekeeper, marketing and med_tech must be login roles';
  END IF;
  IF NOT (ARRAY['cook','housekeeping'] <@ enum_range(NULL::public.staff_role)::text[]) THEN
    RAISE EXCEPTION 'cook and housekeeping must be staff positions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE app_role::text IN ('nurse','caregiver','dietary','dietary_aide') AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.role_permissions WHERE app_role IN ('nurse','caregiver','dietary','dietary_aide'))
    OR EXISTS (SELECT 1 FROM public.search_tool_policies WHERE app_role IN ('nurse','caregiver','dietary','dietary_aide')) THEN
    RAISE EXCEPTION 'A retired role is still held or configured';
  END IF;
  IF position('''marketing''' IN (SELECT prosrc FROM pg_proc WHERE proname = 'referral_capability')) = 0 THEN
    RAISE EXCEPTION 'Marketing has no referral capability';
  END IF;
END
$probe$;
ROLLBACK;
