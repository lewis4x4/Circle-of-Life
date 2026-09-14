#!/usr/bin/env node
import { assessJob, compareSecrets, sendSentry } from './monitor.mjs';
import { createHash } from 'node:crypto';

const project=process.env.SUPABASE_PROJECT_REF;
const token=process.env.SUPABASE_ACCESS_TOKEN;
if (!/^[a-z]{20}$/.test(project ?? '') || !token) {
  console.error('SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required');
  process.exit(1);
}
const args=new Set(process.argv.slice(2));
if ([...args].some(a=>!['--secrets-only','--send-sentry'].includes(a))) {
  console.error('Usage: check.mjs [--secrets-only] [--send-sentry]');process.exit(1);
}
if(args.has('--secrets-only') && args.has('--send-sentry')) {
  console.error('A partial secrets-only check cannot update the full monitor alert state');process.exit(1);
}
async function api(path,body) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/${path}`,{
    method:body ? 'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:body ? JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  // Do not print provider bodies: SQL errors may repeat credential-bearing commands.
  if (!response.ok) throw new Error(`Supabase ${path} HTTP ${response.status}`);
  return response.json();
}
const sql=query=>api('database/query',{query});
try {
  const jobs=await sql(`select j.jobid,j.jobname,j.schedule,j.active,
    substring(j.command from '/functions/v1/([a-z0-9-]+)') endpoint,
    array(select m[1] from regexp_matches(j.command,'name\\s*=\\s*''([^'']+)''','g') m) vault_names,
    (select substring(v.decrypted_secret from '^https://([a-z]{20})\\.supabase\\.co/?$')
      from vault.decrypted_secrets v where v.name in
      (select m[1] from regexp_matches(j.command,'name\\s*=\\s*''([^'']+)''','g') m)
      and (v.name='project_url' or v.name like '%\\_project\\_url')) target_project_ref
    from cron.job j order by j.jobid`);
  const edge=await api('secrets');
  const vault=await sql(`select name,case when length(decrypted_secret)>0 then
    encode(sha256(convert_to(decrypted_secret,'UTF8')),'hex') end digest
    from vault.decrypted_secrets where name in
    (select m[1] from cron.job j cross join lateral regexp_matches(j.command,'name\\s*=\\s*''([^'']+)''','g') m)`);
  const parity=compareSecrets(jobs,vault,edge,project);
  const report={project_ref:project,checked_at:new Date().toISOString(),secret_parity:parity,
    edge_sentry_configuration:{SENTRY_DSN:edge.some(s=>s.name==='SENTRY_DSN'),
      SENTRY_DSN_EDGE:edge.some(s=>s.name==='SENTRY_DSN_EDGE'),delivery:'not_verified_by_configuration'}};
  let outcomes=[];
  if (!args.has('--secrets-only')) {
    const timezone=await sql("select coalesce(current_setting('cron.timezone',true),'GMT') timezone");
    if (!['GMT','UTC','Etc/UTC'].includes(timezone[0]?.timezone)) throw new Error('Monitor requires UTC cron timezone');
    await sql('select job_monitor.collect()');
    const records=await sql(`select coalesce(j.jobid,m.jobid) jobid,m.installed_at,
      coalesce(j.jobname,m.jobname) jobname,j.jobid is null removed,
      substring(m.original_command from '/functions/v1/([a-z0-9-]+)') endpoint,
      j.command=m.instrumented_command command_matches,
      coalesce((select jsonb_agg(r) from (select request_id,requested_at,http_status,outcome,governance_refusal
        from job_monitor.runs where jobid=coalesce(j.jobid,m.jobid) order by requested_at desc limit 100) r),'[]') runs
      from cron.job j full outer join job_monitor.jobs m on m.jobid=j.jobid`);
    outcomes=records.map(record=>assessJob({...record,...jobs.find(j=>j.jobid===record.jobid)}));
    report.jobs=outcomes;
  }
  const findings=[...parity.filter(p=>p.state!=='match'),...outcomes.filter(o=>o.alert)];
  if (args.has('--send-sentry')) {
    if (!process.env.SENTRY_DSN_JOB_MONITOR) throw new Error('SENTRY_DSN_JOB_MONITOR is required for delivery');
    // Dedupe by problem state, not request IDs/timestamps that change every run.
    const fingerprint=createHash('sha256').update(JSON.stringify(findings.map(f=>({
      jobid:f.jobid,state:f.state,http_status:f.http_status})).sort((a,b)=>a.jobid-b.jobid))).digest('hex');
    const previous=await sql("select fingerprint from job_monitor.signal_state where name='findings'");
    if(previous[0]?.fingerprint===fingerprint) report.sentry={delivery:'unchanged_suppressed'};
    else {
      if(findings.length) report.sentry=await sendSentry(process.env.SENTRY_DSN_JOB_MONITOR,project,findings);
      const event=report.sentry?.event_id;
      await sql(`insert into job_monitor.signal_state(name,fingerprint,event_id) values
        ('findings','${fingerprint}',${event ? `'${event}'::uuid`:'null'}) on conflict(name)
        do update set fingerprint=excluded.fingerprint,event_id=excluded.event_id,delivered_at=now()`);
    }
  }
  console.log(JSON.stringify(report,null,2));
  if (findings.length) process.exitCode=2;
} catch (error) {
  // All error text originates in this script; never emit raw fetch/SQL exceptions.
  const message=String(error?.message ?? '');
  console.error(JSON.stringify({project_ref:project,monitor:'failed',
    reason:/^(Supabase |Sentry delivery failed:|Monitor requires |SENTRY_DSN_JOB_MONITOR |Invalid Sentry DSN)/.test(message)
      ? message:'Monitor request failed; inspect provider status without logging secrets'}));
  if(args.has('--send-sentry') && process.env.SENTRY_DSN_JOB_MONITOR) {
    try {
      console.error(JSON.stringify({monitor_failure_signal:await sendSentry(process.env.SENTRY_DSN_JOB_MONITOR,
        project,[{state:'monitor_failed',reason:'Outcome or parity collection failed'}])}));
    } catch { console.error('Monitor failure signal could not reach Sentry; workflow failure routing is required'); }
  }
  process.exitCode=1;
}
