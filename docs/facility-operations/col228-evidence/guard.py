#!/usr/bin/env python3
"""Local manifests and explicit parent-reviewed readiness; no network on import."""
import argparse,hashlib,json,pathlib,subprocess,os
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent;REF='iwcnajanvjvynolltflw'
def require(ok,message):
 if not ok:raise RuntimeError(message)
def snapshot():
 names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
 paths=sorted(set(n for n in names if n.startswith(('src/','supabase/','scripts/','.github/')) or n in ['package.json','package-lock.json','next.config.ts','tsconfig.json'] or (n.startswith(str(OUT.relative_to(ROOT))+'/') and n.endswith(('.py','.mjs')))))
 return {'sourceSha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'files':{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in paths if (ROOT/n).is_file()}}
def verify(ready_path):
 r=json.loads(pathlib.Path(ready_path).read_text());require(r['target']==REF and r['appUrl']=='http://127.0.0.1:4343' and pathlib.Path(r['checkout']).resolve()==ROOT,'Wrong proof target/origin')
 require(r['approved_by_parent'] is True and r['scope']=='COL-228 read-only shared-fixture browser proof' and r['phase'] in ['before','after'],'Explicit parent readiness required')
 data=pathlib.Path(r['source_manifest']['path']).read_bytes();require(hashlib.sha256(data).hexdigest()==r['source_manifest']['sha256'],'Manifest changed')
 require(json.loads(data)==snapshot(),'Source/runner drift; bind before and after separately')
 require(r['shared_fixture']['path']=='/Users/brianlewis/.config/haven-staging/col227-fixture.json' and r['shared_fixture']['owner_task']=='COL-227','Explicit shared fixture provenance required')
 return r
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['manifest','verify','serve']);p.add_argument('--ready');p.add_argument('--phase',choices=['before','after']);args=p.parse_args()
 if args.action=='manifest':
  require(args.phase is not None,'Choose phase');s=snapshot();dest=OUT/(args.phase+'-source-manifest.json');dest.write_text(json.dumps(s,indent=2)+'\n');print(json.dumps({'path':str(dest),'files':len(s['files']),'sourceSha':s['sourceSha'],'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}))
 else:
  require(args.ready is not None,'Ready path required');ready=verify(args.ready)
  if args.action=='serve':
   fixture=json.loads(pathlib.Path(ready['shared_fixture']['path']).read_text());require(not fixture.get('cleaned') and fixture['target']==REF and fixture['run'].startswith('col227-'),'Active shared fixture required')
   config=pathlib.Path.home()/'.config/haven-staging/col217.env';require(config.stat().st_mode&0o777==0o600,'Private staging config required')
   env={k.strip():v.strip().strip("'\"") for line in config.read_text().splitlines() if '=' in line and not line.lstrip().startswith('#') for k,v in [line.split('=',1)]}
   require(env['STAGING_PROJECT_REF']==REF and env['NEXT_PUBLIC_SUPABASE_URL']=='https://'+REF+'.supabase.co','Wrong app environment')
   os.chdir(ROOT);os.execvpe('npm',['npm','run','dev','--','--hostname','127.0.0.1','--port','4343'],{**os.environ,**env})
  print('Source/readiness verified; no network')
