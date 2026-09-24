import { randomUUID } from 'node:crypto';

function cronFieldMatches(field, value, min, max, { sundaySeven = false } = {}) {
  const normalize = input => sundaySeven && input === 7 ? 0 : input;
  const ranges = field.split(',').map(part => {
    const match = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/([1-9]\d*))?$/);
    if (!match) throw new Error('Unsupported cron schedule');
    const step = Number(match[3] ?? 1);
    const start = match[1] === '*' ? min : Number(match[1]);
    const end = match[2] === undefined ? (match[1] === '*' ? max : start) : Number(match[2]);
    const allowedMax = sundaySeven ? 7 : max;
    if (start < min || start > allowedMax || end < min || end > allowedMax || start > end) {
      throw new Error('Invalid cron field');
    }
    return { start, end, step };
  });
  return ranges.some(({ start, end, step }) => {
    const candidate = normalize(value);
    for (let current = start; current <= end; current += step) {
      if (normalize(current) === candidate) return true;
    }
    return false;
  });
}

// Only supported cron syntax is interpreted. Unknown schedules are visible errors.
export function latestDue(schedule, now) {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Unsupported cron schedule');
  const limits = [[0,59],[0,23],[1,31],[1,12],[0,6]];
  fields.forEach((field,index) => cronFieldMatches(field,limits[index][0],...limits[index],{sundaySeven:index===4}));
  // Day-of-month AND day-of-week has OR semantics in cron; reject rather than guess.
  if (fields[2] !== '*' && fields[4] !== '*') throw new Error('Unsupported combined day fields');
  const minute = Math.floor(now.getTime()/60000)*60000;
  for (let i=0;i<366*24*60;i++) {
    const date = new Date(minute-i*60000);
    const values = [date.getUTCMinutes(),date.getUTCHours(),date.getUTCDate(),date.getUTCMonth()+1,date.getUTCDay()];
    if (fields.every((field,index) => cronFieldMatches(field,values[index],...limits[index],{sundaySeven:index===4}))) return date;
  }
  throw new Error('No scheduled occurrence found');
}

export function assessJob(job, now = new Date()) {
  const base = { jobid: job.jobid, jobname: job.jobname, endpoint: job.endpoint };
  if (job.removed) return { ...base,state:'removed',alert:true };
  if (!job.active) return { ...base, state:'disabled', alert:!!job.installed_at };
  if (!job.installed_at || !job.command_matches) return { ...base, state:'not_monitored',alert:true };
  let due;
  // Ten-minute allowance covers runner cadence and pg_net response deadline.
  try { due = latestDue(job.schedule,new Date(now.getTime()-10*60000)); }
  catch { return { ...base,state:'unsupported_schedule',alert:true }; }
  if (job.monitoring_mode === 'cron') {
    const runs = [...(job.cron_runs ?? [])].sort((a,b)=>Date.parse(b.start_time)-Date.parse(a.start_time));
    const newest = runs[0];
    if (due.getTime() >= Date.parse(job.installed_at) && (!newest || Date.parse(newest.start_time)<due.getTime())) {
      return { ...base,state:'did_not_run',alert:true,expected_at:due.toISOString() };
    }
    if (!newest) return { ...base,state:'awaiting_first_run',alert:false };
    const age = now.getTime()-Date.parse(newest.start_time);
    const state = newest.status === 'succeeded' ? 'success'
      : newest.status === 'running' && age < 10*60000 ? 'running' : 'error';
    const eligible = runs.filter(run => run.status !== 'running' || now.getTime()-Date.parse(run.start_time)>=10*60000);
    return { ...base,state,started_at:newest.start_time,ended_at:newest.end_time,
      alert:state==='error',consecutive_failures:eligible.findIndex(run=>run.status==='succeeded') < 0
        ? eligible.length : eligible.findIndex(run=>run.status==='succeeded') };
  }
  const runs = [...(job.runs ?? [])].sort((a,b)=>Date.parse(b.requested_at)-Date.parse(a.requested_at));
  const newest = runs[0];
  if (due.getTime() >= Date.parse(job.installed_at) && (!newest || Date.parse(newest.requested_at)<due.getTime())) {
    return { ...base,state:'did_not_run',alert:true,expected_at:due.toISOString() };
  }
  if (!newest) return { ...base,state:'awaiting_first_run',alert:false };
  const eligible=runs.filter(r=>r.outcome!=='pending' || now.getTime()-Date.parse(r.requested_at)>=10*60000);
  const last=eligible[0] ?? newest;
  const state = last.outcome === 'pending' && now.getTime()-Date.parse(last.requested_at)>=10*60000
    ? 'response_missing' : last.outcome;
  const knownGovernance = job.endpoint==='resident-assurance-ai' && last.governance_refusal && last.http_status===403;
  const failure = ['refused','error','response_missing'].includes(state);
  return { ...base,state,http_status:last.http_status,request_id:last.request_id,
    requested_at:last.requested_at,governance_refusal:!!knownGovernance,
    // First refusal/error is already significant for daily/monthly safety jobs.
    alert: failure && !knownGovernance,
    latest_request_pending:newest.outcome==='pending',
    consecutive_failures: eligible.findIndex(r => r.outcome==='success') < 0
      ? eligible.length : eligible.findIndex(r => r.outcome==='success') };
}

export const secretMapping = {
  'ar-aging-check':['ar_aging_check_secret','AR_AGING_CHECK_SECRET'],
  'daily-census-log':['daily_census_log_cron_secret','DAILY_CENSUS_LOG_SECRET'],
  'emar-missed-dose-check':['emar_missed_dose_secret','EMAR_MISSED_DOSE_SECRET'],
  'exec-alert-evaluator':['exec_alert_evaluator_secret','EXEC_ALERT_EVALUATOR_SECRET'],
  'exec-kpi-snapshot':['exec_kpi_snapshot_secret','EXEC_KPI_SNAPSHOT_SECRET'],
  'facility-expiration-scanner':['facility_expiration_scanner_secret','FACILITY_EXPIRATION_SCANNER_SECRET'],
  'generate-emar-schedule':['generate_emar_schedule_secret','GENERATE_EMAR_SCHEDULE_SECRET'],
  'generate-monthly-invoices':['generate_monthly_invoices_secret','GENERATE_MONTHLY_INVOICES_SECRET'],
  'grace-redteam-nightly':['grace_redteam_secret','GRACE_REDTEAM_SECRET'],
  'observation-escalation-engine':['observation_escalation_secret','OBSERVATION_ESCALATION_SECRET'],
  'observation-task-generator':['observation_task_generator_secret','OBSERVATION_TASK_GENERATOR_SECRET'],
  'report-scheduler':['report_scheduler_secret','REPORT_SCHEDULER_SECRET'],
  'resident-assurance-ai':['resident_assurance_ai_secret','RESIDENT_ASSURANCE_AI_SECRET'],
  'resident-safety-scorer':['resident_safety_scorer_secret','RESIDENT_SAFETY_SCORER_SECRET'],
  'risk-nightly-scorer':['risk_nightly_scorer_secret','RISK_NIGHTLY_SCORER_SECRET'],
  'stand-up-google':['stand_up_google_cron_secret','STAND_UP_GOOGLE_CRON_SECRET'],
  'stand-up-publisher':['stand_up_publisher_cron_secret','STAND_UP_PUBLISHER_CRON_SECRET'],
  'stand-up-history-publisher':['stand_up_history_cron_secret','STAND_UP_HISTORY_PUBLISHER_CRON_SECRET'],
  'care-event-dispatcher':['care_event_dispatcher_cron_secret','CARE_EVENT_DISPATCHER_SECRET'],
  'cadence-version-activator':['cadence_version_activator_secret','CADENCE_VERSION_ACTIVATOR_SECRET'],
  'watchlist-signal-engine':['watchlist_signal_secret','WATCHLIST_SIGNAL_SECRET'],
  'oce-task-scheduler':['oce_task_scheduler_secret','OCE_TASK_SCHEDULER_SECRET'],
};

export function compareSecrets(jobs, vault, edge, projectRef) {
  return jobs.filter(j=>j.active && j.endpoint).map(job=>{
    const mapping=secretMapping[job.endpoint];
    let state='unknown_mapping';
    if (mapping) {
      const [vaultName,envName]=mapping;
      const v=vault.filter(s=>s.name===vaultName), e=edge.filter(s=>s.name===envName);
      state = projectRef && job.target_project_ref!==projectRef ? 'target_project_mismatch'
        : !job.vault_names.includes(vaultName) ? 'unexpected_vault_reference'
        : v.length!==1 || !v[0].digest ? 'missing_vault_secret'
        : e.length!==1 || !e[0].value ? 'missing_edge_secret'
        : v[0].digest.toLowerCase()===e[0].value.toLowerCase() ? 'match' : 'mismatch';
    }
    return {jobid:job.jobid,jobname:job.jobname,endpoint:job.endpoint,state};
  });
}

export async function sendSentry(dsn, projectRef, findings, fetcher = fetch) {
  const url = new URL(dsn);
  const project = url.pathname.split('/').filter(Boolean).pop();
  if (url.protocol!=='https:' || !url.username || !/^\d+$/.test(project ?? '')) throw new Error('Invalid Sentry DSN');
  const eventId=randomUUID().replaceAll('-','');
  const event = {event_id:eventId,timestamp:Date.now()/1000,platform:'node',level:'error',
    message:'Haven scheduled job needs attention',fingerprint:['haven-scheduled-jobs',projectRef],
    tags:{supabase_project:projectRef},extra:{findings}};
  const response=await fetcher(`${url.origin}/api/${project}/envelope/`,{
    method:'POST',headers:{'Content-Type':'application/x-sentry-envelope',
      'X-Sentry-Auth':`Sentry sentry_version=7,sentry_key=${url.username},sentry_client=haven-job-monitor/1.0`},
    body:[JSON.stringify({event_id:eventId,sent_at:new Date().toISOString()}),JSON.stringify({type:'event'}),JSON.stringify(event)].join('\n')+'\n',
    signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`Sentry delivery failed: HTTP ${response.status}`);
  return {event_id:eventId,ingest_http_status:response.status,recipient_receipt:'not_verified'};
}
