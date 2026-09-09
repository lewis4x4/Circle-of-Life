import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const nativeRoot='/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/native-services';
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const psql='/opt/homebrew/opt/postgresql@17/bin/psql';
export function verifyNativeRuntime(config,includeStandalone=false){
 if(config.projectId!=='hfa-native-01a08335'||config.transport!=='native-services'||config.apiUrl!=='http://127.0.0.1:59831'||config.database?.socket!==nativeRoot||config.database?.port!==55448||config.database?.name!=='hfa_native_01a08335'||config.database?.user!=='postgres')throw Error('Verified native target required');
 const manifest=JSON.parse(fs.readFileSync(nativeRoot+'/manifest.private.json','utf8'));
 if(manifest.created_by!=='codex'||manifest.run_id!=='hfa-20260908-01a08335'||manifest.postgres.socket!==nativeRoot||manifest.postgres.port!==55448||manifest.postgres.database!=='hfa_native_01a08335')throw Error('Native ownership declaration mismatch');
 const expected={auth:{port:59833,command:[nativeRoot+'/auth','serve']},rest:{port:59832,command:[nativeRoot+'/postgrest/postgrest']},gateway:{port:59831,command:['/opt/homebrew/bin/node',nativeRoot+'/gateway.mjs'],source:nativeRoot+'/gateway.mjs'}};
 if(includeStandalone)expected['standalone-audit']={port:59835,command:['/opt/homebrew/bin/deno','run','--allow-net=127.0.0.1:59831,127.0.0.1:59835','--allow-env=HFA_LOCAL_API_URL,HFA_LOCAL_ANON_KEY,CORS_ALLOWED_ORIGINS',nativeRoot+'/standalone-audit-gateway.ts'],source:nativeRoot+'/standalone-audit-gateway.ts'};
 const entries=[...manifest.services,...(includeStandalone?manifest.auxiliary_services.filter(s=>s.name==='standalone-audit'):[])];
 if(entries.length!==Object.keys(expected).length||new Set(entries.map(s=>s.name)).size!==entries.length)throw Error('Native service inventory mismatch');
 const services=[];
 for(const service of entries){
  const wanted=expected[service.name];
  if(!wanted||service.port!==wanted.port||service.bind!=='127.0.0.1'||JSON.stringify(service.command)!==JSON.stringify(wanted.command))throw Error('Native service binding mismatch');
  const actual=execFileSync('ps',['-p',String(service.pid),'-o','args='],{encoding:'utf8',timeout:5000}).trim();
  const listener=execFileSync('lsof',['-nP','-a','-p',String(service.pid),`-iTCP:${wanted.port}`,'-sTCP:LISTEN','-Fn'],{encoding:'utf8',timeout:5000});
  if(actual!==wanted.command.join(' ')||!listener.split('\n').includes(`n127.0.0.1:${wanted.port}`)||digest(wanted.command[0])!==service.executable_sha256)throw Error('Native executable/listener identity mismatch');
  if(wanted.source&&digest(wanted.source)!==service.source_sha256)throw Error('Native gateway source differs from recorded source');
  services.push({service:service.name,pid:service.pid,port:service.port,executable_sha256:service.executable_sha256,...(wanted.source?{source_sha256:service.source_sha256}:{})});
 }
 const sql="SELECT json_build_object('database',current_database(),'data_directory',current_setting('data_directory'),'port',current_setting('port'),'listen_addresses',current_setting('listen_addresses'),'system_identifier',system_identifier::text) FROM pg_control_system();";
 const backend=JSON.parse(execFileSync(psql,['-X','-qAt','-h',nativeRoot,'-p','55448','-U','postgres','-d','hfa_native_01a08335','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:10000,env:{...process.env,PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=5000'}}));
 if(backend.database!=='hfa_native_01a08335'||fs.realpathSync(backend.data_directory)!==path.join(nativeRoot,'postgres-data')||backend.port!=='55448'||backend.listen_addresses!==''||backend.system_identifier!==manifest.postgres.system_identifier)throw Error('Native database identity mismatch');
 return {services,backend};
}
