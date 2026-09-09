import datetime,hashlib,json,pathlib,subprocess,time
R=pathlib.Path('/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/credentials-342'); ROOT=pathlib.Path('/Users/brianlewis/Circle of Life/Haven Finance Integration'); DB='hfa_credentials_342_full'; B='/opt/homebrew/opt/postgresql@17/bin/'
args=['-h',str(R.parent),'-p','55447','-U','postgres']; manifest=json.loads((R/'manifest.private.json').read_text());manifest['full_replay_database']=DB
for f in ['full-replay.py','full-replay.json','full-replay.log']:
 if str(R/f) not in manifest['paths']:manifest['paths'].append(str(R/f))
(R/'manifest.private.json').write_text(json.dumps(manifest,indent=2))
subprocess.run([B+'createdb',*args,'--template=template0','--encoding=UTF8',DB],check=True)
migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))+[R/'migration.sql']; probes=[p for p in sorted((ROOT/'supabase/tests').glob('*.sql')) if p.name.startswith('review_') or p.name in ['rpc_grant_posture.sql','family_portal_messages_one_way.sql','team_space_rls_no_recursion.sql']]+[R/'review.sql']; inputs=[ROOT/'scripts/pg-verify-stub.sql',*migrations,*probes]; results=[];start=time.time()
with (R/'full-replay.log').open('w') as log:
 for p in inputs:
  result=subprocess.run([B+'psql',*args,'-d',DB,'-X','-v','ON_ERROR_STOP=1','-f',str(p)],capture_output=True,text=True,timeout=120)
  log.write(str(p)+'\n'+result.stdout+result.stderr);log.flush()
  results.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'exit_code':result.returncode})
  if result.returncode: break
report={'status':'PASS' if all(x['exit_code']==0 for x in results) and len(results)==len(inputs) else 'FAIL','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'database':DB,'scope':'Fresh native PostgreSQL; Supabase and rollback-only Vault API stubs, no encryption or hosted proof','migrations':len(migrations),'probes':len(probes),'duration_seconds':round(time.time()-start,2),'results':results}
(R/'full-replay.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='results'}));raise SystemExit(0 if report['status']=='PASS' else 1)
