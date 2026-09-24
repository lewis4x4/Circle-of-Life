#!/usr/bin/env node
import { assessJob, applyAlertPolicy, compareSecrets, sendSentry, ALERT_POLICY } from './monitor.mjs';
import { dispatchEmail } from './email-dispatch.mjs';
import { sendLinear, toJobResults, MONITOR_JOB } from './linear-alert.mjs';
import { createHash } from 'node:crypto';

const project=process.env.SUPABASE_PROJECT_REF;
const token=process.env.SUPABASE_ACCESS_TOKEN;
if (!/^[a-z]{20}$/.test(project ?? '') || !token) {
  console.error('SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required');
  process.exit(1);
}
const args=new Set(process.argv.slice(2));
if ([...args].some(a=>!['--secrets-only','--send-sentry','--send-email','--send-linear'].includes(a))) {
  console.error('Usage: check.mjs [--secrets-only] [--send-sentry] [--send-email] [--send-linear]');process.exit(1);
}
if(args.has('--secrets-only') && (args.has('--send-sentry') || args.has('--send-email') || args.has('--send-linear'))) {
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
const recheckDelay=process.env.JOB_MONITOR_RECHECK_DELAY_MS ? Number(process.env.JOB_MONITOR_RECHECK_DELAY_MS)
  : ALERT_POLICY.recheckDelayMs;
if (!Number.isInteger(recheckDelay) || recheckDelay<0 || recheckDelay>120000) {
  console.error('JOB_MONITOR_RECHECK_DELAY_MS must be an integer from 0 to 120000');process.exit(1);
}
try {
  const jobs=await sql(`select j.jobid,j.jobname,j.schedule,j.active,
    substring(j.command from '(?:/functions/v1/|\\.functions\\.supabase\\.co/)([a-z0-9-]+)') endpoint,
    array(select m[1] from regexp_matches(j.command,'name\\s*=\\s*''([^'']+)''','g') m) vault_names,
    coalesce(
      substring(j.command from 'https://([a-z]{20})\\.functions\\.supabase\\.co/'),
      substring(j.command from 'https://([a-z]{20})\\.supabase\\.co/functions/v1/'),
      (select substring(v.decrypted_secret from '^https://([a-z]{20})\\.supabase\\.co/?$')
      from vault.decrypted_secrets v where v.name in
      (select m[1] from regexp_matches(j.command,'name\\s*=\\s*''([^'']+)''','g') m)
      and (v.name='project_url' or v.name like '%\\_project\\_url'))) target_project_ref
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
    const collect=async()=>{
      await sql('select job_monitor.collect()');
      const records=await sql(`select coalesce(j.jobid,m.jobid) jobid,m.installed_at,
      coalesce(j.jobname,m.jobname) jobname,j.jobid is null removed,
      substring(m.original_command from '(?:/functions/v1/|\\.functions\\.supabase\\.co/)([a-z0-9-]+)') endpoint,
      j.command=m.instrumented_command command_matches,
      case when m.original_command ~ 'net\\.http_post\\s*\\(' then 'http' else 'cron' end monitoring_mode,
      coalesce((select jsonb_agg(r) from (select request_id,requested_at,http_status,outcome,governance_refusal
        from job_monitor.runs where jobid=coalesce(j.jobid,m.jobid) order by requested_at desc limit 100) r),'[]') runs
      ,coalesce((select jsonb_agg(r) from (select start_time,end_time,status
        from cron.job_run_details where jobid=coalesce(j.jobid,m.jobid) order by start_time desc limit 100) r),'[]') cron_runs
      from cron.job j full outer join job_monitor.jobs m on m.jobid=j.jobid`);
      const now=new Date();
      return records.map(record=>applyAlertPolicy(assessJob({...record,...jobs.find(j=>j.jobid===record.jobid)},now),now));
    };
    outcomes=await collect();
    // Retry once: a transient failure still inside its hold is re-collected after a short
    // delay, so a late pg_net response or a fast job's next run can clear it before paging.
    for (let attempt=0; attempt<ALERT_POLICY.recheckRetries && outcomes.some(o=>o.held); attempt++) {
      const held=new Set(outcomes.filter(o=>o.held).map(o=>o.jobid));
      await new Promise(resolve=>setTimeout(resolve,recheckDelay));
      outcomes=(await collect()).map(o=>held.has(o.jobid) ? {...o,rechecked:true} : o);
    }
    report.jobs=outcomes;
    // Quiet log: held transient failures appear here and in report.jobs, never as alerts.
    report.held=outcomes.filter(o=>o.held).map(o=>({jobname:o.jobname,state:o.state,http_status:o.http_status,
      likely_cause:o.likely_cause,consecutive_failures:o.consecutive_failures,hold_until:o.hold_until}));
  }
  const findings=[...parity.filter(p=>p.state!=='match'),...outcomes.filter(o=>o.alert)];
  if (args.has('--send-email')) {
    report.email=await dispatchEmail(sql,findings,outcomes);
    // A successful collection clears the independent monitor-failure episode.
    await dispatchEmail(sql,[],[],'monitor');
    if(report.email.failed || !report.email.enabled_organizations) process.exitCode=1;
  }
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
  if (args.has('--send-linear')) {
    // One Linear issue per job: opened on failure, commented on change, closed on recovery.
    // A completed collection also closes any open issue about the monitor itself.
    report.linear=await sendLinear([...toJobResults(outcomes,parity),{job:MONITOR_JOB,status:'healthy'}]);
    if(report.linear.errors.length) process.exitCode=1;
  }
  console.log(JSON.stringify(report,null,2));
  if (findings.length && !process.exitCode) process.exitCode=2;
} catch (error) {
  // All error text originates in this script; never emit raw fetch/SQL exceptions.
  const message=String(error?.message ?? '');
  console.error(JSON.stringify({project_ref:project,monitor:'failed',
    reason:/^(Supabase |Sentry delivery failed:|Monitor requires |SENTRY_DSN_JOB_MONITOR |Invalid Sentry DSN|Linear |LINEAR_MONITOR_)/.test(message)
      ? message:'Monitor request failed; inspect provider status without logging secrets'}));
  if(args.has('--send-email')) {
    try { await dispatchEmail(sql,[{state:'monitor_failed'}],[],'monitor'); }
    catch { console.error('Monitor failure email could not be recorded or sent; workflow failure routing is required'); }
  }
  if(args.has('--send-sentry') && process.env.SENTRY_DSN_JOB_MONITOR) {
    try {
      console.error(JSON.stringify({monitor_failure_signal:await sendSentry(process.env.SENTRY_DSN_JOB_MONITOR,
        project,[{state:'monitor_failed',reason:'Outcome or parity collection failed'}])}));
    } catch { console.error('Monitor failure signal could not reach Sentry; workflow failure routing is required'); }
  }
  if(args.has('--send-linear')) {
    try {
      console.error(JSON.stringify({monitor_failure_linear:await sendLinear([{job:MONITOR_JOB,status:'failing',
        signature:'Monitor run failed',detail:'Outcome or parity collection failed; open the monitor run for the sanitized reason.'}])}));
    } catch { console.error('Monitor failure could not reach Linear; workflow failure routing is required'); }
  }
  process.exitCode=1;
}
