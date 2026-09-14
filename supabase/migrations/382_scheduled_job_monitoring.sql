-- COL-253: retain actual HTTP outcomes, independently of pg_cron's SQL success.
-- Additive only. Existing schedules are instrumented explicitly after review.
create schema if not exists job_monitor;
revoke all on schema job_monitor from public, anon, authenticated, service_role;

create table job_monitor.jobs (
  jobid bigint primary key,
  jobname text not null,
  original_command text not null,
  instrumented_command text not null,
  installed_at timestamptz not null default now()
);
create table job_monitor.runs (
  request_id bigint primary key,
  jobid bigint not null references job_monitor.jobs(jobid),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  http_status integer,
  governance_refusal boolean not null default false,
  outcome text not null default 'pending'
    check (outcome in ('pending','success','refused','error','response_missing'))
);
create index on job_monitor.runs(jobid, requested_at desc);
alter table job_monitor.jobs enable row level security;
alter table job_monitor.runs enable row level security;
create table job_monitor.signal_state (
  name text primary key check(name='findings'),
  fingerprint text not null,
  event_id uuid,
  delivered_at timestamptz not null default now()
);
alter table job_monitor.signal_state enable row level security;
revoke all on all tables in schema job_monitor from public, anon, authenticated, service_role;

create function job_monitor.http_post(
  monitored_jobid bigint, url text, body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb,
  timeout_milliseconds integer default null
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare request_id bigint;
begin
  if timeout_milliseconds is null then
    -- Extension defaults vary by version; preserve the installed default.
    request_id := net.http_post(url := url, body := body, params := params,headers := headers);
  else
    request_id := net.http_post(url := url, body := body, params := params,
      headers := headers, timeout_milliseconds := timeout_milliseconds);
  end if;
  insert into job_monitor.runs(request_id,jobid) values(request_id,monitored_jobid);
  return request_id;
end $$;

-- Only postgres can opt in. Reject unsupported commands instead of guessing.
create function job_monitor.instrument(target_jobid bigint) returns void
language plpgsql security invoker set search_path = '' as $$
declare j record; rewritten text;
begin
  select * into strict j from cron.job where jobid=target_jobid for update;
  if exists(select 1 from job_monitor.jobs where jobid=target_jobid) then
    raise exception 'Job already instrumented; inspect existing registration';
  end if;
  if j.username <> current_user or
     (select count(*) from regexp_matches(j.command,'net\.http_post\s*\(','g')) <> 1 or
     j.command !~ 'net\.http_post\s*\(\s*(url|body|params|headers|timeout_milliseconds)\s*(:=|=>)' then
    raise exception 'Unsupported scheduler owner or HTTP command';
  end if;
  rewritten := regexp_replace(j.command,'net\.http_post\s*\(',
    format('job_monitor.http_post(monitored_jobid := %s, ',target_jobid));
  insert into job_monitor.jobs(jobid,jobname,original_command,instrumented_command)
    values(j.jobid,j.jobname,j.command,rewritten);
  perform cron.alter_job(target_jobid,command := rewritten);
end $$;

create function job_monitor.restore(target_jobid bigint) returns void
language plpgsql security invoker set search_path = '' as $$
declare saved record; actual text;
begin
  select * into strict saved from job_monitor.jobs where jobid=target_jobid;
  select command into strict actual from cron.job where jobid=target_jobid for update;
  if actual <> saved.instrumented_command then
    raise exception 'Cron command changed since instrumentation; preserve concurrent edit';
  end if;
  perform cron.alter_job(target_jobid,command := saved.original_command);
  -- Preserve the ledger and original command for audit; never delete evidence.
end $$;

-- Only persist whitelisted outcome fields. No response bodies, headers, URLs,
-- secrets, or clinical data enter the ledger. pg_net responses are short lived.
create function job_monitor.collect() returns bigint
language plpgsql security invoker set search_path = '' as $$
declare item record; payload jsonb; state text; changed bigint := 0;
begin
  for item in
    select r.request_id,n.id,n.status_code,n.timed_out,n.error_msg,n.content,r.requested_at
    from job_monitor.runs r left join net._http_response n on n.id=r.request_id
    where r.outcome='pending' for update of r skip locked
  loop
    if item.id is null and item.requested_at > now()-interval '10 minutes' then continue; end if;
    state := 'success';
    payload := null;
    begin payload := item.content::jsonb; exception when others then null; end;
    if item.id is null then state := 'response_missing';
    elsif item.timed_out or item.error_msg is not null then state := 'error';
    elsif item.status_code in (401,403) then state := 'refused';
    elsif item.status_code is null or item.status_code < 200 or item.status_code >= 300 then state := 'error';
    else
      if payload->>'ok'='false' or payload->>'outcome'='error' or
         (payload ? 'error' and payload->'error' not in ('null'::jsonb,'false'::jsonb,'""'::jsonb)) or
         exists(select 1 from jsonb_array_elements(case when jsonb_typeof(payload->'facilities')='array'
           then payload->'facilities' else '[]'::jsonb end) x where x->>'outcome'='error')
      then state := 'error';
      elsif payload->>'outcome'='blocked' or
         exists(select 1 from jsonb_array_elements(case when jsonb_typeof(payload->'facilities')='array'
           then payload->'facilities' else '[]'::jsonb end) x where x->>'outcome'='blocked')
      then state := 'refused'; end if;
    end if;
    update job_monitor.runs set completed_at=now(), http_status=item.status_code,outcome=state,
      governance_refusal=coalesce(item.status_code=403 and
        payload->>'error'='PHI processing not authorized for this organization',false)
      where request_id=item.request_id;
    changed := changed+1;
  end loop;
  return changed;
end $$;
revoke all on all functions in schema job_monitor from public, anon, authenticated, service_role;
