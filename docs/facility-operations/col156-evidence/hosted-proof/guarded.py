#!/usr/bin/env python3
"""COL156 source/readiness guard. 'manifest' is local-only; no network on import."""
import argparse,base64,hashlib,json,os,pathlib,subprocess,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[4]; OUT=pathlib.Path(__file__).resolve().parent
REF='iwcnajanvjvynolltflw'; MIGRATION='368_hfo_employee_source_snapshots.sql'
def require(ok,message):
 if not ok: raise RuntimeError(message)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def source_manifest():
 names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
 root_config_patterns=('*.config.*','next.config.*','tsconfig*.json','vitest.config.*','eslint.config.*','postcss.config.*','tailwind.config.*','playwright.config.*','netlify.toml','.npmrc','.nvmrc','.node-version')
 root_configs={path.name for pattern in root_config_patterns for path in ROOT.glob(pattern) if path.is_file()}
 chosen={name for name in names if name.startswith(('src/','supabase/','scripts/','.github/','public/')) or name in root_configs or name in ['package.json','package-lock.json','next.config.ts','tsconfig.json','tsconfig.typecheck.json','docs/employee-lifecycle/requirements.json'] or (name.startswith(str(OUT.relative_to(ROOT))+'/') and name.endswith(('.py','.mjs')))}
 chosen.update(root_configs)
 return {'sourceSha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'files':{name:digest((ROOT/name).read_bytes()) for name in sorted(chosen) if (ROOT/name).is_file()}}
def envfile(path):
 require(path.stat().st_mode&0o077==0,'Private staging config required')
 return {k.strip():v.strip().strip("'\"") for line in path.read_text().splitlines() if '=' in line and not line.lstrip().startswith('#') for k,v in [line.split('=',1)]}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):raise RuntimeError('Unexpected redirect refused')
class Runtime:
 def __init__(self,ready_path,stage=False):
  self.ready_path=pathlib.Path(ready_path);self.verify()
  self.env=envfile(pathlib.Path.home()/'.config/haven-staging/col217.env')
  require(self.env['STAGING_PROJECT_REF']==REF and self.env['NEXT_PUBLIC_SUPABASE_URL']=='https://'+REF+'.supabase.co','Wrong API target')
  require(self.env['PGUSER']=='postgres.'+REF and self.env['PGHOST']=='aws-0-us-west-2.pooler.supabase.com','Wrong database target')
  require((pathlib.Path.home()/'.config/haven-staging/control/supabase/.temp/project-ref').read_text().strip()==REF,'Wrong dedicated CLI target')
  self.base=self.env['NEXT_PUBLIC_SUPABASE_URL'];self.app='http://127.0.0.1:4356'
  if stage:
   stamp=json.loads((OUT/'staging-readiness.json').read_text());require(stamp['result']=='PASS' and stamp['target']==REF and stamp['sourceSha']==self.ready['sourceSha'] and stamp['migration_sha256']==digest((ROOT/'supabase/migrations'/MIGRATION).read_bytes()),'Reviewed staging368 readback required')
 def verify(self):
  r=json.loads(self.ready_path.read_text());self.ready=r
  require(r['target']==REF and r['appUrl']=='http://127.0.0.1:4356','Wrong readiness target/origin')
  require(pathlib.Path(r['checkout']).resolve()==ROOT,'Wrong readiness checkout')
  current=source_manifest();require(r['sourceSha']==current['sourceSha'],'Checkout moved')
  manifest_ref=r['source_manifest'];raw=pathlib.Path(manifest_ref['path']).read_bytes();require(digest(raw)==manifest_ref['sha256'],'Source manifest changed')
  require(json.loads(raw)==current,'Runtime/runner source changed, including new files')
  changed=set(subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT,text=True).splitlines())
  untracked=set(subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines())
  require(not (changed|untracked).intersection(current['files']),'Runtime/runner source must be committed and unchanged')
  for key in ['gate','review']:
   artifact=r[key];raw=pathlib.Path(artifact['path']).read_bytes();require(digest(raw)==artifact['sha256'],'Readiness artifact changed')
   value=json.loads(raw)
   if key=='gate': require(artifact['sourceSha']==r['sourceSha'] and value['verdict']=='PASS' and any(c.get('id')=='qa.migrations-apply-postgres' and c.get('required') is True and c.get('status')=='passed' for c in value['checks']) and all(c['status']=='passed' for c in value['checks'] if c.get('required')),'Required exact-source gates must pass')
   else: require(value['sourceSha']==r['sourceSha'] and value['independent'] is True and value['result']=='[PROOF PASS — CLEAN]','Independent exact-source review required')
 def sql(self,query):
  self.verify();self.identify();env={k:v for k,v in os.environ.items() if not k.startswith('PG')};env.update(self.env);env['PGPASSWORD']=self.env['SUPABASE_DB_PASSWORD']
  result=subprocess.run(['/opt/homebrew/opt/postgresql@17/bin/psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-c',query],env=env,capture_output=True,text=True,timeout=180)
  require(result.returncode==0,'Staging SQL failed; inspect exact target state privately before retry')
  return result.stdout.strip()
 def identify(self):
  self.verify();token=subprocess.run(['security','find-generic-password','-s','Supabase CLI','-a','access-token','-w'],capture_output=True,text=True,check=True).stdout.strip()
  if token.startswith('go-keyring-base64:'):token=base64.b64decode(token.split(':',1)[1]).decode()
  request=urllib.request.Request('https://api.supabase.com/v1/projects',headers={'Authorization':'Bearer '+token})
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=60) as response: projects=json.load(response)
  p=next(p for p in projects if p['id']==REF)
  require(p['name']=='Haven HFO Staging' and p['organization_id']=='macizkpxodsegtptaytu' and p['status']=='ACTIVE_HEALTHY','Staging identity/status changed')
  return {k:p[k] for k in ['id','name','organization_id','status']}
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['manifest','verify']);parser.add_argument('--ready');parser.add_argument('--output');args=parser.parse_args()
 if args.action=='manifest':
  require(args.output is not None,'Explicit private scratch manifest output required')
  path=pathlib.Path(args.output).resolve();scratch=pathlib.Path.home()/'.hermes/tmp/agent-runs/haven-overnight-20260912-01a09869'
  require(path.is_relative_to(scratch) and path.parent.exists(),'Manifest must be in current run private scratch')
  data=source_manifest();fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'w') as file:json.dump(data,file,indent=2)
  print(json.dumps({'sourceSha':data['sourceSha'],'file_count':len(data['files']),'path':str(path),'sha256':digest(path.read_bytes())}))
 else:require(args.ready is not None,'Explicit readiness path required');Runtime(args.ready);print('Readiness verified; no network or mutations performed')
