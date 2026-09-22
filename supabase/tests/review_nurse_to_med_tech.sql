-- 2026-09-22 (Brian): "Nurse is to not be used. Use Med-Tech instead." and "make sure
-- Cook and Housekeeper are added". Migration 462 is generated; this probe fails the
-- replay if a later migration reintroduces nurse as a granted role, or lists dietary
-- without cook.
BEGIN;
DO $probe$
DECLARE v text;
BEGIN
  SELECT string_agg(schemaname||'.'||tablename||'.'||policyname, ', ') INTO v FROM pg_policies
    WHERE (coalesce(qual,'')||coalesce(with_check,'')) ~ '''nurse''';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'Policies still grant nurse: %', v; END IF;

  SELECT string_agg(n.nspname||'.'||p.proname, ', ') INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','haven') AND p.prosrc ~ '''nurse''' AND p.proname <> 'role_tier';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'Functions still name nurse: %', v; END IF;

  SELECT string_agg(schemaname||'.'||tablename||'.'||policyname, ', ') INTO v FROM pg_policies
    WHERE (coalesce(qual,'')||coalesce(with_check,'')) ~ '''dietary''' AND (coalesce(qual,'')||coalesce(with_check,'')) !~ '''cook''';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'Policies list dietary without cook: %', v; END IF;

  SELECT string_agg(n.nspname||'.'||p.proname, ', ') INTO v FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public','haven') AND p.prosrc ~ '''dietary''' AND p.prosrc !~ '''cook''';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'Functions list dietary without cook: %', v; END IF;

  IF haven.role_tier('med_tech') <> haven.role_tier('nurse') OR haven.role_tier('cook') <> haven.role_tier('dietary') THEN
    RAISE EXCEPTION 'role_tier: med_tech must hold nurse''s tier and cook dietary''s';
  END IF;
  IF NOT ('cook' = ANY (enum_range(NULL::public.app_role)::text[])) OR NOT ('housekeeper' = ANY (enum_range(NULL::public.app_role)::text[])) THEN
    RAISE EXCEPTION 'cook and housekeeper must be login roles';
  END IF;
  IF NOT ('cook' = ANY (enum_range(NULL::public.staff_role)::text[])) OR NOT ('housekeeping' = ANY (enum_range(NULL::public.staff_role)::text[])) THEN
    RAISE EXCEPTION 'cook and housekeeping must be staff positions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE app_role = 'nurse')
    OR EXISTS (SELECT 1 FROM public.search_tool_policies WHERE app_role = 'nurse') THEN
    RAISE EXCEPTION 'Role configuration still keyed to nurse';
  END IF;
END
$probe$;
ROLLBACK;
