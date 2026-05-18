-- Smart Rounding — observation plan form hardening
-- Requires clinical provenance, strict effective windows, and bounded rule cadence values.

UPDATE public.resident_observation_plans
SET rationale = 'Legacy observation plan created before rationale provenance was required.'
WHERE rationale IS NULL OR char_length(btrim(rationale)) < 30;

UPDATE public.resident_observation_plans
SET effective_to = NULL
WHERE effective_to IS NOT NULL
  AND effective_to <= effective_from;

ALTER TABLE public.resident_observation_plans
  ALTER COLUMN rationale SET NOT NULL;

ALTER TABLE public.resident_observation_plans
  ADD CONSTRAINT resident_observation_plans_effective_window_strict
  CHECK (effective_to IS NULL OR effective_to > effective_from);

ALTER TABLE public.resident_observation_plans
  ADD CONSTRAINT resident_observation_plans_rationale_min_length
  CHECK (char_length(btrim(rationale)) >= 30);

UPDATE public.resident_observation_plan_rules
SET interval_minutes = 5
WHERE interval_minutes IS NOT NULL
  AND interval_minutes < 5;

UPDATE public.resident_observation_plan_rules
SET interval_minutes = 1440
WHERE interval_minutes IS NOT NULL
  AND interval_minutes > 1440;

UPDATE public.resident_observation_plan_rules
SET grace_minutes = 0
WHERE grace_minutes < 0;

UPDATE public.resident_observation_plan_rules
SET grace_minutes = GREATEST(interval_minutes - 1, 0)
WHERE interval_minutes IS NOT NULL
  AND grace_minutes >= interval_minutes;

ALTER TABLE public.resident_observation_plan_rules
  ADD CONSTRAINT resident_observation_plan_rules_interval_minutes_bounds
  CHECK (interval_minutes IS NULL OR interval_minutes BETWEEN 5 AND 1440);

ALTER TABLE public.resident_observation_plan_rules
  ADD CONSTRAINT resident_observation_plan_rules_grace_before_interval
  CHECK (interval_minutes IS NULL OR grace_minutes < interval_minutes);
