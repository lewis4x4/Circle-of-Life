from pathlib import Path
import subprocess,json,hashlib,re,os
ROOT=Path('/Users/brianlewis/Circle of Life/Haven HFO Staging Integration');O=Path(__file__).parent;B='/opt/homebrew/opt/postgresql@17/bin/';C=['-h',str(O.parent),'-p','55463','-U','postgres'];dbs=['haven_verify_217_20260912_1','haven_verify_217_20260912_2'];result={'databases':dbs,'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'failures':[]}
def run(tool,args):return subprocess.run([B+tool,*C,*args],text=True,capture_output=True)
def sql(db,args):return run('psql',['-d',db,'-v','ON_ERROR_STOP=1',*args])
try:
 for db in dbs:
  r=run('createdb',[db]);assert r.returncode==0,r.stderr
  r=sql(db,['-f',str(ROOT/'scripts/pg-verify-stub.sql')]);assert r.returncode==0,r.stderr
 for db,base,tx in [(dbs[0],ROOT/'supabase/migrations',[]),(dbs[1],O/'migrations',['--single-transaction'])]:
  for p in sorted(base.glob('*.sql')):
   r=sql(db,[*tx,'-f',str(p)])
   if r.returncode:
    result['failures'].append({'database':db,'file':p.name,'stderr':r.stderr});raise Exception(db+' '+p.name+' failed; see verification.json')
  r=run('pg_dump',['-d',db,'--schema-only','--no-owner','--no-comments']);assert r.returncode==0,r.stderr
  normalized='\n'.join(x for x in r.stdout.splitlines() if not x.startswith('\\restrict ') and not x.startswith('\\unrestrict '))
  (O/(db+'.schema.sql')).write_text(normalized);result[db+'_schema_sha256']=hashlib.sha256(normalized.encode()).hexdigest()
 result['schema_equal']=result[dbs[0]+'_schema_sha256']==result[dbs[1]+'_schema_sha256'];assert result['schema_equal'],'Schema dumps differ'
 probes=sorted(p for p in (ROOT/'supabase/tests').glob('*.sql') if p.name.startswith('review_') or p.name in ['rpc_grant_posture.sql','family_portal_messages_one_way.sql','team_space_rls_no_recursion.sql'])
 for p in probes:
  r=sql(dbs[1],['-f',str(p)])
  if r.returncode:result['failures'].append({'database':dbs[1],'file':p.name,'stderr':r.stderr});raise Exception(p.name+' failed; see verification.json')
 result['sql_probes_passed']=len(probes);result['status']='PASS';print(json.dumps({k:v for k,v in result.items() if k!='failures'}))
finally:
 (O/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
 for db in dbs:
  r=run('dropdb',['--if-exists',db]);assert r.returncode==0,r.stderr
