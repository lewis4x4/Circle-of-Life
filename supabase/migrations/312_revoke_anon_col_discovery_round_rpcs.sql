-- Production already applied (revoke_anon_col_discovery_round_rpcs).
-- CREATE OR REPLACE in 310 reset PUBLIC EXECUTE; re-pin grants and helper search_path.

REVOKE ALL ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) TO authenticated, service_role;

ALTER FUNCTION haven._col_discovery_discrete_rule(time, text, integer)
  SET search_path = haven, public, pg_temp;

ALTER FUNCTION haven._col_discovery_standard_preset_rules()
  SET search_path = haven, public, pg_temp;

ALTER FUNCTION haven._col_discovery_homewood_preset_rules()
  SET search_path = haven, public, pg_temp;
