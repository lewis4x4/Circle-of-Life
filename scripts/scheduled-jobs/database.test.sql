-- Run ONLY in a new disposable database. pg_net/cron here are test doubles.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema cron;
create table cron.job(jobid bigint primary key,jobname text,command text,username text,schedule text,active boolean);
create function cron.alter_job(job_id bigint,command text) returns void language sql as
  'update cron.job set command=$2 where jobid=$1';
create schema net;
create sequence net.request_ids;
create table net.test_timeouts(value integer);
create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 5000) returns bigint
  language plpgsql as $$ begin insert into net.test_timeouts values(timeout_milliseconds);
    return nextval('net.request_ids'); end $$;
create table net._http_response(id bigint,status_code integer,timed_out boolean,error_msg text,content text);
\ir ../../supabase/migrations/382_scheduled_job_monitoring.sql
\ir ../../supabase/migrations/441_col253_scheduler_platform_compatibility.sql

insert into cron.job values(1,'test','select net.http_post(url := ''https://example.invalid/functions/v1/ar-aging-check'', body := ''{}''::jsonb);','postgres','* * * * *',true);
select job_monitor.instrument(1);
do $$ declare command text; begin
  select j.command into command from cron.job j where jobid=1;
  execute command;
  if not exists(select 1 from job_monitor.runs where jobid=1 and request_id=1) then
    raise exception 'Actual returned request ID was not recorded'; end if;
  if (select value from net.test_timeouts limit 1)<>5000 then raise exception 'Installed timeout default changed'; end if;
end $$;
insert into job_monitor.runs(request_id,jobid,requested_at) select n,1,now()-interval '15 minutes' from generate_series(2,10) n;
insert into net._http_response values
 (1,200,false,null,'{"ok":true}'),
 (2,401,false,null,'{"error":"Unauthorized"}'),
 (3,500,false,null,'{"error":"private patient content never stored"}'),
 (4,200,false,null,'{"facilities":[{"outcome":"success"},{"outcome":"error"}]}'),
 (5,403,false,null,'{"error":"PHI processing not authorized for this organization"}'),
 (6,null,true,'private transport detail',null),
 (7,200,false,null,'{"outcome":"blocked"}'),
 (8,200,false,null,'{"ok":false}'),
 (9,200,false,null,'invalid json');
select job_monitor.collect();
do $$ begin
  if (select array_agg(outcome order by request_id) from job_monitor.runs)<>
    array['success','refused','error','error','refused','error','refused','error','success','response_missing'] then
    raise exception 'Outcome classification failed'; end if;
  if (select count(*) from job_monitor.runs where governance_refusal)<>1 then
    raise exception 'Governance classification failed'; end if;
  if exists(select 1 from information_schema.columns where table_schema='job_monitor' and table_name='runs'
    and column_name in ('content','body','headers','url','error_msg')) then raise exception 'Unsafe persisted columns'; end if;
  if has_schema_privilege('anon','job_monitor','USAGE') or
    has_schema_privilege('authenticated','job_monitor','USAGE') or
    has_schema_privilege('service_role','job_monitor','USAGE') or
    has_function_privilege('anon','job_monitor.collect()','EXECUTE') then raise exception 'Unsafe ACL'; end if;
end $$;
select setval('net.request_ids',10);
select job_monitor.http_post(1,url:='https://example.invalid',timeout_milliseconds:=12345);
do $$ begin
  if not exists(select 1 from net.test_timeouts where value=12345) then raise exception 'Explicit timeout changed'; end if;
end $$;
update cron.job set command='select 123' where jobid=1;
do $$ begin
  begin perform job_monitor.restore(1); raise exception 'Unsafe restore succeeded';
  exception when others then if sqlerrm <> 'Cron command changed since instrumentation; preserve concurrent edit' then raise; end if; end;
end $$;
update cron.job set command=(select instrumented_command from job_monitor.jobs where jobid=1) where jobid=1;
select job_monitor.restore(1);
insert into cron.job values(2,'positional','select net.http_post(''https://example.invalid'');','postgres','* * * * *',true);
do $$ begin
  begin perform job_monitor.instrument(2); raise exception 'Positional command was rewritten';
  exception when others then if sqlerrm <> 'Unsupported scheduler owner or HTTP command' then raise; end if; end;
end $$;
insert into cron.job values(3,'native','select 1;','postgres','20 7,8 * * *',true);
select job_monitor.register_native(3);
do $$ begin
  if not exists(select 1 from job_monitor.jobs where jobid=3 and original_command=instrumented_command)
    then raise exception 'Native job was not registered'; end if;
  begin perform job_monitor.restore(3); raise exception 'Native restore unexpectedly rewrote the job';
  exception when others then if sqlerrm <> 'Native jobs are registered, not rewritten' then raise; end if; end;
  if has_function_privilege('authenticated','job_monitor.register_native(bigint)','EXECUTE')
    then raise exception 'Unsafe native registration ACL'; end if;
end $$;
do $$ begin
  if (select command from cron.job where jobid=1)<>(select original_command from job_monitor.jobs where jobid=1)
    then raise exception 'Restore did not preserve original'; end if;
  if (select count(*) from job_monitor.runs)<>11 then raise exception 'Restore removed evidence'; end if;
end $$;
select 'PASS: request capture, native registration, outcome classification, PHI-safe columns, ACLs, concurrent edit and evidence-preserving restore' result;
