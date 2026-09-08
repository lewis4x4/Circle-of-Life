#!/usr/bin/env node
// Synthetic-only full-stack acceptance. Never point this harness at a hosted project.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const { Client } = createRequire(import.meta.url)('pg');
let database;


const repo = process.cwd();
const run = process.env.HAVEN_STAGE_RUN;
if (!run || !run.startsWith(`${process.env.HOME}/.hermes/tmp/agent-runs/`)) throw Error('HAVEN_STAGE_RUN must be a private owned agent-run directory');
const stage = resolve(run, 'staging');
if (!/^project_id\s*=\s*"haven-s2-release-01a07e17"/m.test(readFileSync(resolve(stage,'supabase/config.toml'),'utf8'))) throw Error('Unexpected isolated Supabase project identity');
const output = resolve(repo, 'docs/remediation/2026-09-review/section-2-release');
mkdirSync(output, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), target: 'isolated local Supabase', source: execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim(), authHelpersStubbed: false, checks: [] };
const report = (name, ok, detail={}) => { evidence.checks.push({ name, pass: !!ok, ...detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const q = value => `'${String(value).replaceAll("'", "''")}'`;
async function sql(command) {
  if (!database) {
    database=new Client({host:'127.0.0.1',port:59222,user:'postgres',password:'postgres',database:'postgres',connectionTimeoutMillis:30000});
    await database.connect();
  }
  const results=await database.query(command);
  return (Array.isArray(results)?results:[results]).flatMap(r=>r.rows||[]).map(r=>Object.values(r).map(v=>v==null?'':String(v)).join('|')).join('\n').trim();
}
function privateFile(name, data) {
  const path = resolve(run, name);
  writeFileSync(path, JSON.stringify(data,null,2)+'\n',{mode:0o600});
  return path;
}
function save(name) {
  evidence.completedAt = new Date().toISOString();
  evidence.pass = evidence.checks.length > 0 && evidence.checks.every(c=>c.pass);
  writeFileSync(resolve(output,name),JSON.stringify(evidence,null,2)+'\n');
}
const mode = process.argv[2] || 'checks';
try {
 if (mode === 'migrate') {
  evidence.localPrerequisites={nativeSupabaseAuthHelpers:true,syntheticForeignKeyActors:['00000000-0000-0000-0000-000000000001','062c3cfb-53a5-4482-814a-cbef2b028760'],reason:'Historical seed created_by foreign keys; synthetic local Auth rows only, no authorization helper stubs'};
  await sql(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES('00000000-0000-0000-0000-000000000001','stage-synthetic-system@example.invalid','{}','{"purpose":"synthetic isolated migration prerequisite"}'),('062c3cfb-53a5-4482-814a-cbef2b028760','stage-synthetic-system-281@example.invalid','{}','{"purpose":"synthetic isolated migration prerequisite"}') ON CONFLICT(id) DO NOTHING`);
  const resume = Number(process.env.HAVEN_STAGE_RESUME || '1');
  const startName=process.env.HAVEN_STAGE_RESUME_FILE || String(resume).padStart(3,'0');
  const migrationPath=resolve(output,'staging-migrations.json');
  if (resume > 1 || process.env.HAVEN_STAGE_RESUME_FILE) {
   const previous=JSON.parse(readFileSync(migrationPath,'utf8'));
   writeFileSync(resolve(output,`staging-migrations-attempt-${Date.now()}.json`),JSON.stringify(previous,null,2)+'\n');
   evidence.checks=previous.checks.filter(c=>c.pass && c.name<startName);
  }
  const migrations = readdirSync(resolve(repo,'supabase/migrations')).filter(n=>n.endsWith('.sql')&&n>=startName).sort();
  const bodies=migrations.map(name=>({name,body:readFileSync(resolve(repo,'supabase/migrations',name),'utf8')}));
  const prefix=resume===77?`DO $$ DECLARE t text; occupied boolean; BEGIN
    FOREACH t IN ARRAY ARRAY['admission_cases','admission_case_rate_terms'] LOOP
      IF to_regclass('public.'||t) IS NOT NULL THEN
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)',t) INTO occupied;
        IF occupied THEN RAISE EXCEPTION 'Refusing to reset nonempty migration77 table'; END IF;
      END IF;
    END LOOP;
    END $$;
    DROP TABLE IF EXISTS public.admission_case_rate_terms,public.admission_cases;
    DROP TYPE IF EXISTS public.admission_case_status,public.admission_accommodation_quote;
  `:'';
  const input=prefix+bodies.map(({name,body})=>`\\echo HAVEN_STAGE_START:${name}\n${body}\n\\echo HAVEN_STAGE_PASS:${name}\n`).join('');
  const child=spawn('/opt/homebrew/opt/libpq/bin/psql',['-h','127.0.0.1','-p','59222','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGPASSWORD:'postgres',PGCONNECT_TIMEOUT:'15'},stdio:['pipe','pipe','pipe']});
  let pending='',current='connection',stderr='';
  child.stdout.on('data',chunk=>{pending+=chunk;let cut;while((cut=pending.indexOf('\n'))>=0){const line=pending.slice(0,cut);pending=pending.slice(cut+1);if(line.startsWith('HAVEN_STAGE_START:'))current=line.slice("HAVEN_STAGE_START:".length);if(line.startsWith('HAVEN_STAGE_PASS:')){const name=line.slice("HAVEN_STAGE_PASS:".length),body=bodies.find(b=>b.name===name)?.body;if(body){report(name,true,{sha256:createHash('sha256').update(body).digest('hex')});save('staging-migrations.json');}}}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-12000)});
  child.stdin.on('error',()=>{});
  child.stdin.end(input);
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
  if(exit!==0)report(current,false,{error:stderr.slice(Math.max(0,stderr.lastIndexOf('ERROR:'))),exitCode:exit});
  save('staging-migrations.json');
  process.exitCode = evidence.pass ? 0 : 1;
 } else {
  const status = process.env.HAVEN_STAGE_STATUS_FILE ? JSON.parse(readFileSync(process.env.HAVEN_STAGE_STATUS_FILE,'utf8')) : JSON.parse(execFileSync('supabase',['status','--workdir',stage,'-o','json'],{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}));
  privateFile('stage-status.json',status);
  const base = status.API_URL;
  if (base !== 'http://127.0.0.1:59221') throw Error('Refusing target other than isolated API http://127.0.0.1:59221');
  const anon = status.ANON_KEY, service = status.SERVICE_ROLE_KEY;
  if (!anon || !service) throw Error('Local Supabase keys unavailable');
  async function request(path, token=service, body, method=body ? 'POST':'GET') {
   const res = await fetch(`${base}${path}`, {method, headers:{apikey:anon, Authorization:`Bearer ${token}`, 'Content-Type':'application/json', Prefer:'return=representation'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(20000)});
   const text = await res.text(); let data; try {data=JSON.parse(text);} catch {data=text;}
   return {status:res.status,data};
  }
  const rest = (table, token, body, method) => request(`/rest/v1/${table}`,token,body,method);
  const rpc = (name, token, args={}) => rest(`rpc/${name}`,token,args);
  const decode = token => JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  const f = { organization:randomUUID(), entity:randomUUID(), facility:randomUUID(), otherFacility:randomUUID(), foreignOrg:randomUUID(), foreignEntity:randomUUID(), foreignFacility:randomUUID(), resident:randomUUID(), foreignResident:randomUUID(), measure:randomUUID(), foreignMeasure:randomUUID(), plan:randomUUID(), rule:randomUUID(), task:randomUUID(), directTask:randomUUID(), lateTask:randomUUID(), users:{} };
  privateFile('stage-fixture.json',f);
  await sql(`INSERT INTO organizations(id,name) VALUES(${q(f.organization)},'Synthetic Section Two staging'),(${q(f.foreignOrg)},'Synthetic foreign staging');
  INSERT INTO entities(id,organization_id,name) VALUES(${q(f.entity)},${q(f.organization)},'Synthetic entity'),(${q(f.foreignEntity)},${q(f.foreignOrg)},'Synthetic foreign entity');
  INSERT INTO facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) VALUES
  (${q(f.facility)},${q(f.organization)},${q(f.entity)},'Synthetic stage A','Synthetic','Synthetic','00000',3),
  (${q(f.otherFacility)},${q(f.organization)},${q(f.entity)},'Synthetic stage B','Synthetic','Synthetic','00000',3),
  (${q(f.foreignFacility)},${q(f.foreignOrg)},${q(f.foreignEntity)},'Synthetic foreign','Synthetic','Synthetic','00000',3);`);
  for (const role of ['owner','org_admin','facility_admin','nurse','caregiver','family']) {
   const email = `s2-${role}-${randomUUID()}@example.invalid`, password = `Stage!${randomBytes(24).toString('hex')}`;
   const created = await request('/auth/v1/admin/users',service,{email,password,email_confirm:true});
   if (created.status!==200 && created.status!==201) throw Error(`Auth create ${role}: ${JSON.stringify(created)}`);
   const id=created.data.id, staff= randomUUID();
   await sql(`INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active) VALUES(${q(id)},${q(f.organization)},${q(email)},'Synthetic ${role}',${q(role)},true) ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
   INSERT INTO user_facility_access(user_id,organization_id,facility_id) VALUES(${q(id)},${q(f.organization)},${q(f.facility)});
   INSERT INTO staff(id,user_id,organization_id,facility_id,first_name,last_name,staff_role,employment_status,hire_date) VALUES(${q(staff)},${q(id)},${q(f.organization)},${q(f.facility)},'Synthetic',${q(role)},'cna','active',current_date);`);
   f.users[role]={id,staff,email,password};
  }
  async function login(role) {
   const user=f.users[role];
   const response=await request('/auth/v1/token?grant_type=password',anon,{email:user.email,password:user.password});
   if(response.status!==200) throw Error(`Sign-in ${role}: ${JSON.stringify(response)}`);
   user.session=response.data; user.claims=decode(response.data.access_token); privateFile('stage-fixture.json',f);
   return response.data.access_token;
  }
  await sql(`INSERT INTO residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) VALUES
  (${q(f.resident)},${q(f.organization)},${q(f.facility)},'SectionTwoSigned','Synthetic','1940-01-01','female','active'),
  (${q(f.foreignResident)},${q(f.foreignOrg)},${q(f.foreignFacility)},'SectionTwoForeign','Synthetic','1940-01-01','female','active');
  INSERT INTO quality_measures(id,organization_id,measure_key,name) VALUES(${q(f.measure)},${q(f.organization)},'section2signed','Synthetic measure'),(${q(f.foreignMeasure)},${q(f.foreignOrg)},'section2signed','Foreign synthetic measure');
  INSERT INTO quality_measure_results(organization_id,facility_id,quality_measure_id,period_start,period_end,value_numeric,created_at) VALUES
  (${q(f.organization)},${q(f.facility)},${q(f.measure)},'2026-01-01','2026-01-31',5,'2026-02-01'),
  (${q(f.organization)},${q(f.facility)},${q(f.measure)},'2026-01-01','2026-01-31',8,'2026-02-02'),
  (${q(f.organization)},${q(f.facility)},${q(f.measure)},'2025-12-01','2025-12-31',3,'2026-03-01'),
  (${q(f.organization)},${q(f.otherFacility)},${q(f.measure)},'2026-01-01','2026-01-31',9,'2026-02-01'),
  (${q(f.foreignOrg)},${q(f.foreignFacility)},${q(f.foreignMeasure)},'2026-01-01','2026-01-31',99,'2026-02-01');
  INSERT INTO resident_observation_plans(id,organization_id,facility_id,resident_id,status,source_type,effective_from,rationale) VALUES(${q(f.plan)},${q(f.organization)},${q(f.facility)},${q(f.resident)},'active','manual',now(),'Section 2 rounding receipt integrity regression fixture');
  INSERT INTO resident_observation_plan_rules(id,plan_id,organization_id,facility_id,resident_id,interval_type,interval_minutes,grace_minutes) VALUES(${q(f.rule)},${q(f.plan)},${q(f.organization)},${q(f.facility)},${q(f.resident)},'fixed_minutes',60,15);
  INSERT INTO resident_observation_tasks(id,organization_id,facility_id,resident_id,plan_id,plan_rule_id,assigned_staff_id,scheduled_for,due_at,grace_ends_at,status) VALUES
  ${[f.task,f.directTask,f.lateTask].map((id,i)=>`(${q(id)},${q(f.organization)},${q(f.facility)},${q(f.resident)},${q(f.plan)},${q(f.rule)},${q(f.users.caregiver.staff)},now()+interval '${i} hours',now()+interval '${i+1} hours',now()+interval '${i+1} hours 15 minutes','upcoming')`).join(',')};`);
  report('PostgREST pre-request guard configured',(await sql(`SELECT rolconfig::text FROM pg_roles WHERE rolname='authenticator'`)).includes('pgrst.db_pre_request=public.haven_assert_authorized_request'));
  for (const role of Object.keys(f.users)) {
   const token=await login(role), user=f.users[role];
   report(`${role} Auth signed hook claims`,Number.isInteger(user.claims.auth_claim_version)&&!!user.claims.session_id&&user.claims.app_role===role);
   const actor=await rpc('haven_current_edge_actor',token);
   report(`${role} current actor`,actor.status===200&&actor.data?.user_id===user.id&&actor.data?.auth_claim_version===user.claims.auth_claim_version,{status:actor.status});
   const quality=await rest(`quality_latest_facility_measures?quality_measure_id=in.(${f.measure},${f.foreignMeasure})&select=organization_id,facility_id,value_numeric`,token);
   const expected=['owner','org_admin'].includes(role)?2:['facility_admin','nurse'].includes(role)?1:0;
   report(`${role} quality role/facility/tenant boundary`,quality.status===200&&Array.isArray(quality.data)&&quality.data.length===expected&&quality.data.every(r=>r.organization_id===f.organization),{status:quality.status,expected,rows:quality.data});
   if(role==='nurse') {const history=await rest(`quality_measure_results?quality_measure_id=eq.${f.measure}&select=id`,token);report('quality correction and retained history',quality.data[0]?.value_numeric===8&&history.data?.length===3);}
  }
  let nurse=f.users.nurse.session.access_token;
  async function search(token,expected,label) {const r=await rest(`search_documents?source_id=eq.${f.resident}&select=source_id`,token);report(label,r.status===200&&r.data?.length===expected,{status:r.status,rows:r.data?.length});}
  await search(nurse,1,'search current authorized source');
  await sql(`UPDATE residents SET facility_id=${q(f.otherFacility)} WHERE id=${q(f.resident)}`);
  await search(nurse,0,'search transferred source hidden from former facility');
  await sql(`UPDATE search_documents SET facility_id=${q(f.facility)} WHERE source_id=${q(f.resident)}`);
  await search(nurse,0,'search stale index cannot override live source scope');
  await sql(`UPDATE residents SET facility_id=${q(f.facility)} WHERE id=${q(f.resident)}`);
  let family=f.users.family.session.access_token;
  await search(family,0,'family facility grant alone cannot disclose resident');
  await sql(`INSERT INTO family_resident_links(user_id,organization_id,resident_id,relationship) VALUES(${q(f.users.family.id)},${q(f.organization)},${q(f.resident)},'family')`);
  family=await login('family'); await search(family,1,'linked family search');
  await sql(`UPDATE family_resident_links SET revoked_at=now() WHERE user_id=${q(f.users.family.id)} AND resident_id=${q(f.resident)}`);
  family=await login('family'); await search(family,0,'fresh family token revoked link denies search');
  const caregiver=f.users.caregiver.session.access_token, manager=f.users.facility_admin.session.access_token;
  if (status.JWT_SECRET) {
   const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
   const claims=Buffer.from(JSON.stringify({...f.users.caregiver.claims,iat:Math.floor(Date.now()/1000)-7200,exp:Math.floor(Date.now()/1000)-3600})).toString('base64url');
   const unsigned=`${header}.${claims}`;
   const expiredToken=`${unsigned}.${createHmac('sha256',status.JWT_SECRET).update(unsigned).digest('base64url')}`;
   const expiredJwt=await rpc('haven_current_edge_actor',expiredToken);
   report('expired cryptographically signed local JWT denied',expiredJwt.status===401&&/expired/i.test(expiredJwt.data?.message||''),{status:expiredJwt.status,code:expiredJwt.data?.code,source:'real Auth claims with expired timestamps, re-signed using isolated local JWT secret'});
  } else report('expired cryptographically signed local JWT denied',false,{reason:'Local JWT_SECRET unavailable'});
  for (const [name,token,payload] of [
   ['caregiver direct finalize',caregiver,{status:'completed_on_time'}],
   ['manager forged finalize',manager,{status:'completed_on_time'}],
   ['caregiver protected pointer',caregiver,{completed_log_id:randomUUID()}],
   ['manager protected assignment',manager,{assigned_staff_id:f.users.facility_admin.staff}],
  ]) {const r=await rest(`resident_observation_tasks?id=eq.${f.directTask}`,token,payload,'PATCH');report(name,r.status>=400||(r.status===200&&r.data?.length===0),{status:r.status,code:r.data?.code});}
  const receiptRead=await rest('rounding_completion_receipts?select=id',caregiver); report('receipt table private',receiptRead.status>=400,{status:receiptRead.status});
  const observed=new Date(Date.now()-10*60000).toISOString();
  const payload={request_id:randomUUID(),observed_at:observed,quick_status:'awake',resident_location:'Bed',resident_position:'Lying',resident_state:'Alert',late_reason:'Synthetic earlier check during outage',note:'Synthetic observation'};
  const command=(task,p=payload)=>({p_task_id:task,p_actor_id:f.users.caregiver.id,p_actor_role:'caregiver',p_session_id:f.users.caregiver.claims.session_id,p_claim_version:f.users.caregiver.claims.auth_claim_version,p_organization_id:f.organization,p_facility_id:f.facility,p_actual_staff_id:f.users.caregiver.staff,p_payload:p});
  const forbidden=await rpc('complete_rounding_task_review',caregiver,command(f.task)); report('authenticated cannot call privileged completion',forbidden.status>=400,{status:forbidden.status,code:forbidden.data?.code});
  for (const reason of [null,'','\t\n\u00a0','\u2000\u2001\u2028\ufeff']) {const r=await rpc('complete_rounding_task_review',service,command(f.lateTask,{...payload,request_id:randomUUID(),late_reason:reason}));report(`late reason rejection ${JSON.stringify(reason)}`,r.status===400&&r.data?.code==='22023',{status:r.status,code:r.data?.code});}
  const completed=await rpc('complete_rounding_task_review',service,command(f.task)); report('privileged completion revalidates real signed actor session',completed.status===200&&!!completed.data?.log_id,{status:completed.status,result:completed.data});
  const before=await sql(`SELECT count(*) FROM audit_log`);
  const replay=await rpc('complete_rounding_task_review',service,command(f.task));report('exact receipt replay',replay.status===200&&replay.data?.replayed===true&&replay.data?.log_id===completed.data?.log_id,{status:replay.status});
  report('replay appends no audit or clinical evidence',before===await sql(`SELECT count(*) FROM audit_log`)&&await sql(`SELECT count(*) FROM resident_observation_logs WHERE task_id=${q(f.task)}`)==='1');
  const conflict=await rpc('complete_rounding_task_review',service,command(f.task,{...payload,note:'Changed synthetic observation'}));report('changed receipt payload conflicts',conflict.status===409&&conflict.data?.code==='23505',{status:conflict.status,code:conflict.data?.code});
  // Version and Auth session denial use the previously issued, unmodified signed JWT.
  await sql(`UPDATE user_facility_access SET revoked_at=now() WHERE user_id=${q(f.users.nurse.id)}`);
  const stale=await rpc('haven_current_edge_actor',nurse);report('old signed version denied after grant revocation',stale.status===401,{status:stale.status,code:stale.data?.code});
  nurse=await login('nurse'); const empty=await rest(`quality_latest_facility_measures?quality_measure_id=eq.${f.measure}`,nurse); report('fresh version still denies revoked facility',empty.status===200&&empty.data?.length===0,{status:empty.status});
  await sql(`UPDATE user_profiles SET is_active=false WHERE id=${q(f.users.nurse.id)}`); const disabled=await rpc('haven_current_edge_actor',nurse);report('disabled signed actor denied',disabled.status===401,{status:disabled.status});
  await sql(`DELETE FROM auth.sessions WHERE id=${q(f.users.caregiver.claims.session_id)}`);
  const dead=await rpc('haven_current_edge_actor',caregiver);report('deleted Auth session signed token denied',dead.status===401,{status:dead.status});
  const expired=await rpc('complete_rounding_task_review',service,command(f.task));report('lost session authority denies receipt replay',expired.status===403&&expired.data?.code==='42501',{status:expired.status,code:expired.data?.code});
  // Restore live users for the independent browser/API acceptance lane using new genuine sign-ins.
  await sql(`UPDATE user_profiles SET is_active=true WHERE id=${q(f.users.nurse.id)}; UPDATE user_facility_access SET revoked_at=NULL WHERE user_id=${q(f.users.nurse.id)}`);
  for (const role of Object.keys(f.users)) await login(role);
  privateFile('stage-fixture.json',f);
  save('staging-auth-postgrest.json');
  process.exitCode=evidence.pass?0:1;
 }
} catch(error) {
 report('harness execution',false,{error:[error.message,error.stderr].filter(Boolean).join('\n').slice(-6000)});
 save(mode==='migrate'?'staging-migrations.json':'staging-auth-postgrest.json'); process.exitCode=1;
}

if(database) await database.end();
