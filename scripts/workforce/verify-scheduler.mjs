#!/usr/bin/env node
/** Provider pg_cron proof on an explicitly owned, disposable local Supabase stack. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = process.env.WORKFORCE_SCHEDULER_CONTAINER;
assert.match(container ?? '', /^supabase_db_col721-scheduler-[a-z0-9-]+$/, 'An owned scheduler provider stack is required');
const project = container.slice('supabase_db_'.length);
const metadata = spawnSync('docker', ['inspect', container, '--format', '{{index .Config.Labels "com.supabase.cli.project"}}'], { encoding: 'utf8' });
assert.equal(metadata.status, 0); assert.equal(metadata.stdout.trim(), project);
const migration = readFileSync(new URL('../../supabase/migrations/496_workforce_roster_publisher.sql', import.meta.url), 'utf8');
const scheduler = migration.match(/DO \$workforce_cron\$[\s\S]*?END \$workforce_cron\$;/)?.[0];
assert.ok(scheduler, 'Test the exact migration scheduler block');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const jobName = 'workforce-publisher-daily';
const command = 'SELECT haven.workforce_publisher_tick()';
function sql(input, actor = 'postgres') {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', actor, '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const assertFn = `CREATE FUNCTION pg_temp.scheduler_assert(ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'scheduler assertion failed'; END IF; END $$;`;
const managed = `SELECT pg_temp.scheduler_assert(current_user='postgres' AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user));
 SELECT pg_temp.scheduler_assert(NOT has_column_privilege(current_user,'cron.job','active','UPDATE'));
 SELECT pg_temp.scheduler_assert(has_function_privilege(current_user,'cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE'));`;
const refusal = `DO $probe$ BEGIN
 BEGIN EXECUTE ${quote(scheduler)};
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM='workforce_scheduler_name_conflict' THEN RETURN; END IF; RAISE;
 END;
 RAISE EXCEPTION 'scheduler accepted a conflicting job';
 END $probe$;`;
const capture = `CREATE TEMP TABLE scheduler_before AS SELECT to_jsonb(j) AS value FROM cron.job j WHERE jobname=${quote(jobName)};`;
const unchanged = `SELECT pg_temp.scheduler_assert((SELECT value FROM scheduler_before) IS NOT DISTINCT FROM (SELECT to_jsonb(j) FROM cron.job j WHERE jobname=${quote(jobName)}));`;
const create = (schedule = '0 10 * * *', body = command) => `SELECT cron.schedule(${quote(jobName)},${quote(schedule)},${quote(body)});`;
const alter = (values) => `SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname=${quote(jobName)}),${values});`;

// The dedicated stack must already have provider pg_cron installed by its owner.
const environment = JSON.parse(sql(`SELECT json_build_object('role',current_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'cron',(SELECT extversion FROM pg_extension WHERE extname='pg_cron'),'net',(SELECT extversion FROM pg_extension WHERE extname='pg_net'),'existing_jobs',(SELECT count(*) FROM cron.job WHERE jobname=${quote(jobName)}));`));
assert.equal(environment.role, 'postgres'); assert.equal(environment.superuser, false);
assert.ok(environment.cron); assert.equal(environment.existing_jobs, 0, 'Refuse to change an existing job on this stack');

sql(`BEGIN; ${assertFn} ${managed} ${scheduler}
 SELECT pg_temp.scheduler_assert((SELECT count(*)=1 AND bool_and(NOT active AND username=current_user AND database=current_database() AND nodename=current_setting('cron.host') AND nodeport=current_setting('port')::integer AND schedule='0 10 * * *' AND command=${quote(command)}) FROM cron.job WHERE jobname=${quote(jobName)}));
 ${capture} ${scheduler} ${unchanged} ROLLBACK;`);
console.log('[workforce:scheduler] PASS managed caller creates inactive job atomically and exact replay retains it');

for (const [name, setup] of [
  ['command', `${create('0 10 * * *', 'SELECT 1')}${alter('active:=false')}`],
  ['schedule', `${create('1 10 * * *')}${alter('active:=false')}`],
  ['database', `${create()}${alter("database:='template1',active:=false")}`],
  ['active', create()],
]) {
  // Even the active collision stays uncommitted, so no background worker can execute it.
  sql(`BEGIN; ${assertFn} ${managed} ${setup} ${capture} ${refusal} ${unchanged} ROLLBACK;`);
  console.log(`[workforce:scheduler] PASS ${name} collision refuses without changing the job`);
}

// Provider administrator is used only to arrange otherwise inaccessible local metadata fixtures.
// All scheduler executions still connect directly as the managed non-superuser postgres role.
for (const [name, owner, mutation] of [
  ['owner', 'supabase_admin', ''],
  ['host', 'postgres', "nodename='synthetic.invalid'"],
  ['port', 'postgres', 'nodeport=1'],
]) {
  let job;
  try {
    job = Number(sql(`SELECT cron.schedule_in_database(${quote(jobName)},'0 10 * * *',${quote(command)},'postgres',${quote(owner)},false);`, 'supabase_admin'));
    assert.ok(Number.isSafeInteger(job) && job > 0);
    if (mutation) sql(`UPDATE cron.job SET ${mutation} WHERE jobid=${job};`, 'supabase_admin');
    sql(`BEGIN; ${assertFn} ${managed} ${capture} ${refusal} ${unchanged} ROLLBACK;`);
    console.log(`[workforce:scheduler] PASS ${name} collision refuses without changing the job`);
  } finally {
    if (job) sql(`SELECT cron.unschedule(${job});`, 'supabase_admin');
  }
}
assert.equal(sql(`SELECT count(*) FROM cron.job WHERE jobname=${quote(jobName)};`), '0');
console.log(JSON.stringify({ check: 'workforce-managed-scheduler', ...environment, scheduler_cases: 9, residual_jobs: 0, production_changes: false }));
