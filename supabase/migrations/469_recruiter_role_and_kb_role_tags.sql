-- COL-627 (Brian, 2026-09-22): "marketing" was the wrong name. The role is the people
-- whose sole job is to go out and find residents to place; Brian chose "Recruiter".
-- Same access as migration 468 gave it: referrals, pipeline and reputation only.
--
--   * the enum value is renamed in place, so every policy that compares against it
--     (they store the enum constant, not the text) follows automatically;
--   * the two functions that spell the role as text are redefined from their
--     production definitions with only that literal changed;
--   * knowledge-base role tags (published from the COL Knowledge Vault frontmatter)
--     still carried nurse/caregiver, so Grace packs filtered by role were invisible to
--     med-techs. They are folded here the same way 468 folded role columns; the vault
--     files themselves were corrected the same day so a republish keeps it.
BEGIN;

ALTER TYPE public.app_role RENAME VALUE 'marketing' TO 'recruiter';

CREATE OR REPLACE FUNCTION haven.role_tier(p_role app_role)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_role
    WHEN 'owner' THEN 100 WHEN 'org_admin' THEN 90 WHEN 'facility_admin' THEN 80
    WHEN 'manager' THEN 70 WHEN 'coordinator' THEN 60
    WHEN 'admin_assistant' THEN 50 WHEN 'med_tech' THEN 50 WHEN 'recruiter' THEN 50
    WHEN 'cook' THEN 40 WHEN 'maintenance_role' THEN 40
    WHEN 'broker' THEN 30 WHEN 'housekeeper' THEN 30
    WHEN 'family' THEN 10
    -- Retired roles (2026-09-22): no one holds them; kept so an old value still sorts.
    WHEN 'nurse' THEN 50 WHEN 'dietary' THEN 40 WHEN 'caregiver' THEN 20 WHEN 'dietary_aide' THEN 20
    ELSE 0 END
$function$
;

CREATE OR REPLACE FUNCTION haven.referral_capability(p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
    SELECT CASE p_capability
      WHEN 'lead_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'contact_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'clinical_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','med_tech'])
      WHEN 'lead_write' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','med_tech','recruiter'])
      WHEN 'lead_export' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'duplicate_review' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','med_tech'])
      WHEN 'triage_submit' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech','recruiter'])
      WHEN 'triage_read' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin'])
      WHEN 'source_manage' THEN actor.actor_role_text = ANY (ARRAY['owner','org_admin'])
      ELSE false
    END
    FROM haven.current_authorized_actor() AS actor
    WHERE actor.actor_is_managed
    LIMIT 1
  ), false)
$function$
;

CREATE FUNCTION pg_temp.role_json_fold(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY o), '[]'::jsonb) FROM (
    SELECT DISTINCT ON (r) r, o FROM (
      SELECT CASE e WHEN 'nurse' THEN 'med_tech' WHEN 'caregiver' THEN 'med_tech'
               WHEN 'dietary' THEN 'cook' WHEN 'dietary_aide' THEN 'cook'
               WHEN 'marketing' THEN 'recruiter' ELSE e END r, o
      FROM jsonb_array_elements_text(p) WITH ORDINALITY u(e, o)
    ) s ORDER BY r, o) d
$$;

UPDATE public.chunks SET metadata = jsonb_set(metadata, '{role_tags}', pg_temp.role_json_fold(metadata->'role_tags'))
WHERE jsonb_typeof(metadata->'role_tags') = 'array'
  AND metadata->'role_tags' ?| ARRAY['nurse','caregiver','dietary','dietary_aide','marketing'];

UPDATE public.documents SET metadata = jsonb_set(metadata, '{frontmatter,roles}', pg_temp.role_json_fold(metadata->'frontmatter'->'roles'))
WHERE jsonb_typeof(metadata->'frontmatter'->'roles') = 'array'
  AND metadata->'frontmatter'->'roles' ?| ARRAY['nurse','caregiver','dietary','dietary_aide','marketing'];

UPDATE public.documents SET role_tags = ARRAY(SELECT DISTINCT CASE WHEN r = 'marketing' THEN 'recruiter' ELSE r END FROM unnest(role_tags) r)
WHERE 'marketing' = ANY (role_tags);

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chunks WHERE metadata->'role_tags' ?| ARRAY['nurse','caregiver','dietary','dietary_aide','marketing'])
    OR EXISTS (SELECT 1 FROM public.documents WHERE metadata->'frontmatter'->'roles' ?| ARRAY['nurse','caregiver','dietary','dietary_aide','marketing']) THEN
    RAISE EXCEPTION 'Knowledge-base role tags still name a retired role';
  END IF;
END
$check$;

NOTIFY pgrst, 'reload schema';
COMMIT;
