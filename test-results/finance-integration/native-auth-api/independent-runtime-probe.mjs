import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync as exec} from 'node:child_process';
const r='/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/native-services', out=r+'/independent-f01-review';
const read=f=>fs.readFileSync(r+'/'+f,'utf8'), j=f=>JSON.parse(read(f)), sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), checks=[];
function check(name,ok,details={}){checks.push({name,status:ok?'PASS':'FAIL',...details});if(!ok)throw Error(name)}
const m=j('manifest.private.json');
const sql=s=>exec('/opt/homebrew/opt/postgresql@17/bin/psql',['-X','-qAt','-h',r,'-p','55448','-U','postgres','-d','hfa_native_01a08335','-c',s],{encoding:'utf8',timeout:10000,env:{...process.env,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=5000'}}).trim();
let error=null;try{
check('manifest identity',m.created_by==='codex'&&m.run_id==='hfa-20260908-01a08335');
for(const s of [...m.services,...m.auxiliary_services.filter(s=>s.name==='standalone-audit')]){
 const args=exec('ps',['-p',String(s.pid),'-o','args='],{encoding:'utf8'}).trim();
 const listeners=exec('lsof',['-nP',`-iTCP:${s.port}`,'-sTCP:LISTEN','-FpFn'],{encoding:'utf8'}).trim().split('\n');
 check(s.name+' exact process and exclusive loopback listener',args===s.command.join(' ')&&listeners.filter(v=>v.startsWith('p')).length===1&&listeners.includes('p'+s.pid)&&listeners.filter(v=>v.startsWith('n')).every(v=>v==='n127.0.0.1:'+s.port),{pid:s.pid,port:s.port});
 check(s.name+' executable hash',sha(s.command[0])===s.executable_sha256);
 if(s.source_sha256)check(s.name+' source hash',sha(s.command.at(-1))===s.source_sha256);
 const exe=exec('lsof',['-a','-p',String(s.pid),'-d','txt','-Fn'],{encoding:'utf8'});check(s.name+' loaded executable mapped',exe.split('\n').includes('n'+fs.realpathSync(s.command[0])));
}
const pid=read('postgres-data/postmaster.pid').split('\n')[0];const args=exec('ps',['-p',pid,'-o','args='],{encoding:'utf8'}).trim();check('postgres master exact owned data directory',args.startsWith(fs.realpathSync('/opt/homebrew/opt/postgresql@17/bin/postgres')+' ')&&args.includes(r+'/postgres-data'));
const backend=JSON.parse(sql("select json_build_object('db',current_database(),'dir',current_setting('data_directory'),'port',current_setting('port'),'listen',current_setting('listen_addresses'),'system',system_identifier::text) from pg_control_system()"));
check('postgres backend identity',backend.db==='hfa_native_01a08335'&&backend.dir===r+'/postgres-data'&&backend.port==='55448'&&backend.listen===''&&backend.system===m.postgres.system_identifier,{backend});
const auth=j('auth-runtime.private.json'),rest=j('rest-runtime.private.json');
for(const [label,value,user] of [['auth',auth.GOTRUE_DB_DATABASE_URL,'supabase_auth_admin'],['rest',rest.PGRST_DB_URI,'authenticator']]){const u=new URL(value.replace('@/','@localhost/'));check(label+' configured owned database socket',u.pathname==='/hfa_native_01a08335'&&u.searchParams.get('host')===r&&u.searchParams.get('port')==='55448'&&decodeURIComponent(u.username)===user)}
check('auth/rest JWT verification configuration consistent',auth.GOTRUE_JWT_SECRET===rest.PGRST_JWT_SECRET&&typeof rest.PGRST_JWT_SECRET==='string'&&rest.PGRST_JWT_SECRET.length>20);
check('PostgREST managed pre-request configured',rest.PGRST_DB_PRE_REQUEST==='public.haven_assert_authorized_request'&&rest.PGRST_DB_CONFIG==='false');
const activity=JSON.parse(sql("select coalesce(json_agg(json_build_object('role',usename,'db',datname,'local',client_addr is null)),'[]'::json) from pg_stat_activity where usename in ('authenticator','supabase_auth_admin')"));check('existing Auth/REST connections target owned database (idle Auth pool may be empty)', activity.some(a=>a.role==='authenticator')&&activity.every(a=>a.db==='hfa_native_01a08335'&&a.local),{connections:activity});
for(const f of j('verified-host-auth-functions.json').functions){const actual=sql(`select pg_get_functiondef('auth.${f.name}()'::regprocedure)`);check('auth.'+f.name+' exact recorded hosted helper',actual.trim()===f.definition.trim())}
check('real Auth migrations present',Number(sql('select count(*) from auth.schema_migrations'))>50);
const health=await fetch('http://127.0.0.1:59833/health',{redirect:'error',signal:AbortSignal.timeout(5000)});const h=await health.json();check('live GoTrue health version',health.status===200&&h.version==='v2.188.1-f3425cf',{version:h.version});
for(const d of m.downloads)check('download source archive '+d.file.split('/').at(-1),sha(d.file.startsWith('/')?d.file:r+'/'+d.file)===d.sha256&&(!d.expected_sha256||d.sha256===d.expected_sha256));
}catch(e){error=e.message}
const sources=Object.fromEntries(['native-authenticated-smoke.mjs','audit-http-probe.mjs','native-runtime-identity.mjs','gateway.mjs','standalone-audit-gateway.ts','schema-parity.json','verified-host-auth-functions.json'].map(f=>[f,sha(r+'/'+f)]));
const report={reviewer:'independent-f00-review',created_at:new Date().toISOString(),status:error?'FAIL':'PASS',checks,error,sources};fs.writeFileSync(out+'/identity.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({status:report.status,count:checks.length,error}));process.exit(error?1:0);
