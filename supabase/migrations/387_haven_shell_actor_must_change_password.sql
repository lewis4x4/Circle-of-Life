-- Expose must_change_password from user_profiles.settings to the shell actor RPC.

CREATE OR REPLACE FUNCTION public.haven_current_shell_actor()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'user_id', actor.actor_user_id,
    'organization_id', actor.actor_organization_id,
    'app_role', actor.actor_role_text,
    'auth_claim_version', actor.actor_claim_version,
    'is_managed', actor.actor_is_managed,
    'full_name', profile.full_name,
    'avatar_url', profile.avatar_url,
    'organization_name', organization.name,
    'must_change_password', COALESCE((profile.settings ->> 'must_change_password')::boolean, false)
  )
  FROM haven.current_authorized_actor() actor
  LEFT JOIN public.user_profiles profile
    ON actor.actor_is_managed AND profile.id = actor.actor_user_id
  LEFT JOIN public.organizations organization
    ON organization.id = actor.actor_organization_id
  LIMIT 1;
$function$;
