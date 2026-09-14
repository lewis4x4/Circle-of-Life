import { createHash } from 'node:crypto';
import { sendAlertEmail } from './email.mjs';
// Values are JSON-encoded then escaped as SQL literals; no recipient is logged.
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export async function dispatchEmail(sql, findings, jobs, stream = 'jobs', env = process.env, fetcher = fetch) {
  const fingerprint = createHash('sha256').update(JSON.stringify(findings.map(f => ({ jobid: f.jobid, state: f.state, http_status: f.http_status })).sort((a,b) => (a.jobid ?? 0)-(b.jobid ?? 0)))).digest('hex');
  const safeJobs = jobs.map(j => ({ jobid: j.jobid, jobname: j.jobname ?? `Job ${j.jobid}`, state: j.state }));
  await sql(`select job_monitor.queue_email_signal(${literal(stream)},${literal(fingerprint)},${findings.length > 0},${literal(JSON.stringify(safeJobs))}::jsonb)`);
  const ids = await sql("select id from job_monitor.email_deliveries where status in ('pending','failed','unconfigured','sending') order by created_at limit 100");
  let accepted = 0, failed = 0;
  for (const row of ids) {
    const claim = await sql(`select public.system_alert_email_claim(${literal(row.id)}::uuid,${Boolean(env.RESEND_API_KEY && env.SYSTEM_ALERT_EMAIL_FROM)}) delivery`);
    const delivery = claim[0]?.delivery;
    if (!delivery) continue;
    if (delivery.status === 'unconfigured') { failed++; continue; }
    const result = await sendAlertEmail(delivery, env, fetcher);
    await sql(`select public.system_alert_email_finish(${literal(delivery.id)}::uuid,${literal(delivery.claim_token)}::uuid,${literal(result.status)},${result.provider_id ? literal(result.provider_id) : 'null'},${result.error_code ? literal(result.error_code) : 'null'})`);
    if (result.status === 'provider_accepted') accepted++; else failed++;
  }
  const settings = await sql('select count(*)::integer count from job_monitor.email_settings e join job_monitor.email_monitor_scope scope using(organization_id) where e.enabled');
  return { provider_accepted: accepted, failed, enabled_organizations: settings[0]?.count ?? 0, recipient_receipt: 'not_verified' };
}
