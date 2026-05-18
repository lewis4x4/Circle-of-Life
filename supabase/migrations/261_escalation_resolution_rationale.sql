-- Require survey-ready resolution rationale on resolved Smart rounding escalations.

alter table public.resident_observation_escalations
  add column if not exists resolution_rationale text;

update public.resident_observation_escalations
set resolution_rationale = coalesce(
  nullif(trim(resolution_note), ''),
  'Legacy resolved escalation migrated before rationale enforcement.'
)
where status = 'resolved'
  and resolution_rationale is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'resident_observation_escalations_resolved_rationale_required'
  ) then
    alter table public.resident_observation_escalations
      add constraint resident_observation_escalations_resolved_rationale_required
      check (
        status <> 'resolved'
        or (
          resolution_rationale is not null
          and length(trim(resolution_rationale)) >= 30
        )
      );
  end if;
end $$;
