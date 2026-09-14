-- COL-253: private, organization-scoped email configuration and durable attempts.
-- No recipient is seeded by a migration. Configure through the admin page.
-- Explicit infrastructure scope is provisioned by the platform operator, never by an org admin.
create table job_monitor.email_monitor_scope (organization_id uuid primary key references public.organizations(id));
alter table job_monitor.email_monitor_scope enable row level security;
create table job_monitor.email_settings (
 organization_id uuid primary key references public.organizations(id),
 version integer not null default 1 check(version>0), enabled boolean not null default false,
 recipients text[] not null default '{}', alert_kinds text[] not null default '{job_failure,job_recovery,monitor_failure}',
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 check(cardinality(recipients)<=10), check(not enabled or cardinality(recipients)>0),
 check(alert_kinds <@ array['job_failure','job_recovery','monitor_failure']::text[])
);
create table job_monitor.email_settings_audit (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 actor_id uuid not null, changed_at timestamptz not null default now(), before_settings jsonb, after_settings jsonb not null
);
create table job_monitor.email_deliveries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 kind text not null check(kind in('job_failure','job_recovery','monitor_failure','test')),
 event_key text not null, settings_version integer not null, recipients text[] not null,
 status text not null default 'pending' check(status in('pending','sending','provider_accepted','failed','unconfigured','indeterminate','cancelled')),
 error_code text, provider_id text, attempts integer not null default 0, lease_until timestamptz, claim_token uuid, first_provider_attempt_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,event_key,settings_version)
);
create table job_monitor.email_signal_state (
 organization_id uuid not null references public.organizations(id), stream text not null,
 fingerprint text not null, has_findings boolean not null, sequence bigint not null default 1,
 primary key(organization_id,stream)
);
create table job_monitor.email_job_status (
 organization_id uuid not null references public.organizations(id), jobid bigint not null,
 jobname text not null, state text not null, checked_at timestamptz not null default now(),
 primary key(organization_id,jobid)
);
alter table job_monitor.email_settings enable row level security;
alter table job_monitor.email_settings_audit enable row level security;
alter table job_monitor.email_deliveries enable row level security;
alter table job_monitor.email_signal_state enable row level security;
alter table job_monitor.email_job_status enable row level security;
revoke all on all tables in schema job_monitor from public,anon,authenticated,service_role;

create function job_monitor.require_email_admin() returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if auth.uid() is null or haven.app_role()::text not in('owner','org_admin') or haven.app_role() is null then
  raise exception 'Organization administrator required' using errcode='42501';
 end if;
 org:=haven.organization_id();
 if org is null then raise exception 'Current organization required' using errcode='42501'; end if;
 return org;
end $$;
create function job_monitor.settings_json(s job_monitor.email_settings) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version',s.version,'enabled',s.enabled,'recipients',s.recipients,'alertKinds',s.alert_kinds)
$$;
create function public.system_alert_settings_get() returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=job_monitor.require_email_admin(); settings jsonb; deliveries jsonb; jobs jsonb; audit jsonb;
begin
 select job_monitor.settings_json(s) into settings from job_monitor.email_settings s where organization_id=org;
 select coalesce(jsonb_agg(d order by d.created_at desc),'[]') into deliveries from
  (select id,kind,status,error_code,created_at,updated_at from job_monitor.email_deliveries where organization_id=org order by created_at desc limit 50)d;
 select coalesce(jsonb_agg(j order by j.jobid),'[]') into jobs from
  (select jobid,jobname,state,checked_at from job_monitor.email_job_status where organization_id=org
   and exists(select 1 from job_monitor.email_monitor_scope where organization_id=org))j;
 select coalesce(jsonb_agg(a order by a.changed_at desc),'[]') into audit from
  (select h.actor_id,coalesce(nullif(btrim(p.full_name),''),'Administrator') actor_name,h.changed_at,h.before_settings,h.after_settings
   from job_monitor.email_settings_audit h left join public.user_profiles p on p.id=h.actor_id and p.organization_id=h.organization_id
   where h.organization_id=org order by h.changed_at desc limit 50)a;
 return jsonb_build_object('monitoringConfigured',exists(select 1 from job_monitor.email_monitor_scope where organization_id=org),'audit',audit,'settings',coalesce(settings,'{"version":0,"enabled":false,"recipients":[],"alertKinds":["job_failure","job_recovery","monitor_failure"]}'), 'deliveries',deliveries,'jobs',jobs);
end $$;
create function public.system_alert_settings_update(p_expected_version integer,p_enabled boolean,p_recipients text[],p_alert_kinds text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=job_monitor.require_email_admin(); old job_monitor.email_settings; fresh job_monitor.email_settings;
begin
 perform pg_advisory_xact_lock(hashtextextended('system-alert-settings:'||org::text,0));
 select * into old from job_monitor.email_settings where organization_id=org for update;
 if p_expected_version is null or coalesce(old.version,0)<>p_expected_version then raise exception 'Settings changed; reload before saving' using errcode='40001';end if;
 if p_enabled is null or p_recipients is null or cardinality(p_recipients)>10
  or (p_enabled and cardinality(p_recipients)=0) or array_position(p_recipients,null) is not null
  or exists(select 1 from unnest(p_recipients) e where length(e)>254 or e<>lower(btrim(e)) or e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  or cardinality(p_recipients)<>(select count(distinct e) from unnest(p_recipients)e)
  or p_alert_kinds is null or cardinality(p_alert_kinds)=0 or array_position(p_alert_kinds,null) is not null
  or not p_alert_kinds <@ array['job_failure','job_recovery','monitor_failure']::text[] then
  raise exception 'Invalid alert settings' using errcode='22023';
 end if;
 insert into job_monitor.email_settings(organization_id,enabled,recipients,alert_kinds,updated_by)
 values(org,p_enabled,p_recipients,p_alert_kinds,auth.uid()) on conflict(organization_id) do update
 set enabled=excluded.enabled,recipients=excluded.recipients,alert_kinds=excluded.alert_kinds,
 version=email_settings.version+1,updated_at=now(),updated_by=auth.uid() returning * into fresh;
 insert into job_monitor.email_settings_audit(organization_id,actor_id,before_settings,after_settings)
 values(org,auth.uid(),case when old.organization_id is not null then job_monitor.settings_json(old) end,job_monitor.settings_json(fresh));
 return jsonb_build_object('settings',job_monitor.settings_json(fresh));
end $$;
create function public.system_alert_email_test(p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=job_monitor.require_email_admin(); s job_monitor.email_settings; d job_monitor.email_deliveries;
begin
 perform pg_advisory_xact_lock(hashtextextended('system-alert-settings:'||org::text,0));
 select * into s from job_monitor.email_settings where organization_id=org for update;
 if s.version is null or p_expected_version is distinct from s.version then raise exception 'Settings changed; save and reload first' using errcode='40001';end if;
 if cardinality(s.recipients)=0 then raise exception 'Save at least one recipient first' using errcode='22023';end if;
 if exists(select 1 from job_monitor.email_deliveries where organization_id=org and kind='test' and created_at>now()-interval '1 minute') then
 raise exception 'Wait one minute before another test' using errcode='54000';end if;
 insert into job_monitor.email_deliveries(organization_id,kind,event_key,settings_version,recipients)
 values(org,'test','test:'||gen_random_uuid()::text,s.version,s.recipients) returning * into d;
 return jsonb_build_object('id',d.id);
end $$;
-- Server delivery operations. Service role cannot create tests or change settings.
create function public.system_alert_email_claim(p_id uuid,p_configured boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare d job_monitor.email_deliveries; s job_monitor.email_settings; token uuid:=gen_random_uuid();
begin
 select * into d from job_monitor.email_deliveries where id=p_id for update;
 if not found then return null;end if;
 select * into s from job_monitor.email_settings where organization_id=d.organization_id;
 if s.version is distinct from d.settings_version or (d.kind<>'test' and (not s.enabled or not exists(select 1 from job_monitor.email_monitor_scope where organization_id=d.organization_id))) then
 update job_monitor.email_deliveries set status='cancelled',updated_at=now() where id=d.id and status in('pending','failed','unconfigured');return null;end if;
 if d.status not in('pending','failed','unconfigured','sending') or d.lease_until>now() then return null;end if;
 if not p_configured then
 update job_monitor.email_deliveries set status='unconfigured',error_code='email_provider_not_configured',lease_until=null,updated_at=now() where id=d.id;
 return jsonb_build_object('id',d.id,'status','unconfigured');end if;
 -- Resend's idempotency retention is 24 hours; never blindly retry outside it.
 if d.first_provider_attempt_at<now()-interval '23 hours' then
 update job_monitor.email_deliveries set status='indeterminate',error_code='retry_window_expired',updated_at=now() where id=d.id; return null;end if;
 update job_monitor.email_deliveries set status='sending',attempts=attempts+1,claim_token=token,first_provider_attempt_at=coalesce(first_provider_attempt_at,now()),lease_until=now()+interval '2 minutes',updated_at=now() where id=d.id;
 return jsonb_build_object('id',d.id,'kind',d.kind,'recipients',d.recipients,'claim_token',token);
end $$;
create function public.system_alert_email_finish(p_id uuid,p_claim_token uuid,p_status text,p_provider_id text default null,p_error_code text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in('provider_accepted','failed','unconfigured') then raise exception 'Invalid delivery outcome';end if;
 update job_monitor.email_deliveries set status=p_status,provider_id=left(p_provider_id,100),error_code=left(p_error_code,60),lease_until=null,updated_at=now()
 where id=p_id and status='sending' and claim_token=p_claim_token;
 if not found then raise exception 'Delivery lease changed' using errcode='40001';end if;
end $$;
revoke all on all functions in schema job_monitor from public,anon,authenticated,service_role;
revoke all on function public.system_alert_settings_get(), public.system_alert_settings_update(integer,boolean,text[],text[]),public.system_alert_email_test(integer) from public,anon,service_role;
grant execute on function public.system_alert_settings_get(),public.system_alert_settings_update(integer,boolean,text[],text[]),public.system_alert_email_test(integer) to authenticated;
revoke all on function public.system_alert_email_claim(uuid,boolean),public.system_alert_email_finish(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.system_alert_email_claim(uuid,boolean),public.system_alert_email_finish(uuid,uuid,text,text,text) to service_role;

-- Invoked only by the trusted monitor through the Management API (postgres).
create function job_monitor.queue_email_signal(p_stream text,p_fingerprint text,p_has_findings boolean,p_jobs jsonb default '[]')
returns void language plpgsql security invoker set search_path='' as $$
declare s job_monitor.email_settings; previous job_monitor.email_signal_state; seq bigint; kind text;
begin
 if p_stream not in('jobs','monitor') or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid signal';end if;
 for s in select e.* from job_monitor.email_settings e join job_monitor.email_monitor_scope scope using(organization_id) where e.enabled order by e.organization_id for update of e loop
  select * into previous from job_monitor.email_signal_state where organization_id=s.organization_id and stream=p_stream for update;
  seq:=coalesce(previous.sequence,0)+case when previous.fingerprint is distinct from p_fingerprint then 1 else 0 end;
  kind:=case when p_stream='monitor' and p_has_findings then 'monitor_failure'
    when p_stream='jobs' and p_has_findings then 'job_failure'
    when p_stream='jobs' and previous.has_findings and not p_has_findings then 'job_recovery' end;
  insert into job_monitor.email_signal_state(organization_id,stream,fingerprint,has_findings,sequence)
  values(s.organization_id,p_stream,p_fingerprint,p_has_findings,seq) on conflict(organization_id,stream)
  do update set fingerprint=excluded.fingerprint,has_findings=excluded.has_findings,sequence=excluded.sequence;
  if kind=any(s.alert_kinds) then
   insert into job_monitor.email_deliveries(organization_id,kind,event_key,settings_version,recipients)
   values(s.organization_id,kind,p_stream||':'||seq::text,s.version,s.recipients) on conflict do nothing;
  end if;
  if p_stream='jobs' then
   delete from job_monitor.email_job_status where organization_id=s.organization_id;
   insert into job_monitor.email_job_status(organization_id,jobid,jobname,state)
   select s.organization_id,(j->>'jobid')::bigint,left(j->>'jobname',150),left(j->>'state',80) from jsonb_array_elements(p_jobs)j;
  end if;
 end loop;
end $$;
revoke all on function job_monitor.queue_email_signal(text,text,boolean,jsonb) from public,anon,authenticated,service_role;
