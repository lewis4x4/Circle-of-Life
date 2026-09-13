#!/usr/bin/env python3
"""Exact COL224 synthetic staging fixture; no production or real resident data."""
import base64,datetime,hashlib,json,os,pathlib,secrets,subprocess,sys,urllib.request,urllib.error,uuid
from guard import verify
require_ready=verify(sys.argv[sys.argv.index('--ready')+1])
ROOT=pathlib.Path(__file__).resolve().parents[3]; OUT=pathlib.Path(__file__).resolve().parent
REF='iwcnajanvjvynolltflw'; ORG='00000000-0000-0000-0000-000000000001'
PRIVATE=pathlib.Path.home()/'.config/haven-staging/col224-fixture.json'
def envfile(p):
 assert p.stat().st_mode & 0o777 == 0o600, 'Staging credentials must be mode0600'
 return {k.strip():v.strip().strip("'\"") for line in p.read_text().splitlines() if '=' in line and not line.lstrip().startswith('#') for k,v in [line.split('=',1)]}
env=envfile(pathlib.Path.home()/'.config/haven-staging/col217.env')
assert env['STAGING_PROJECT_REF']==REF and env['NEXT_PUBLIC_SUPABASE_URL']=='https://'+REF+'.supabase.co'
assert env['PGUSER']=='postgres.'+REF and env['PGHOST']=='aws-0-us-west-2.pooler.supabase.com'
assert (pathlib.Path.home()/'.config/haven-staging/control/supabase/.temp/project-ref').read_text().strip()==REF
BASE=env['NEXT_PUBLIC_SUPABASE_URL']; state=json.loads(PRIVATE.read_text()) if PRIVATE.exists() else {'run':'col224-'+secrets.token_hex(6),'target':REF,'entity':str(uuid.uuid4()),'site':str(uuid.uuid4()),'subject':str(uuid.uuid4()),'activity':str(uuid.uuid4())}
assert state['target']==REF and state['run'].startswith('col224-')
def save():
 PRIVATE.write_text(json.dumps(state,indent=2));PRIVATE.chmod(0o600)
def lit(x):return "'"+str(x).replace("'","''")+"'"
def sql(query):
 verify(sys.argv[sys.argv.index('--ready')+1])
 e={k:v for k,v in os.environ.items() if not k.startswith('PG')};e.update(env);e['PGPASSWORD']=env['SUPABASE_DB_PASSWORD']
 p=subprocess.run(['/opt/homebrew/opt/postgresql@17/bin/psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-c',query],env=e,capture_output=True,text=True)
 if p.returncode: raise RuntimeError('Staging SQL failed: '+p.stderr[:1500])
 return p.stdout.strip()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):raise RuntimeError('Unexpected redirect refused')
def identify_stage():
 token=subprocess.run(['security','find-generic-password','-s','Supabase CLI','-a','access-token','-w'],capture_output=True,text=True,check=True).stdout.strip()
 if token.startswith('go-keyring-base64:'):token=base64.b64decode(token.split(':',1)[1]).decode()
 request=urllib.request.Request('https://api.supabase.com/v1/projects',headers={'Authorization':'Bearer '+token})
 with urllib.request.build_opener(NoRedirect()).open(request,timeout=60) as response:projects=json.load(response)
 project=next(p for p in projects if p['id']==REF)
 assert project['name']=='Haven HFO Staging' and project['organization_id']=='macizkpxodsegtptaytu' and project['status']=='ACTIVE_HEALTHY','Staging identity changed'
 (OUT/'management-target.json').write_text(json.dumps({k:project[k] for k in ['id','name','organization_id','status']},indent=2))
def http(path,body=None,method='POST',admin=False,session=None):
 verify(sys.argv[sys.argv.index('--ready')+1])
 key=env['SUPABASE_SERVICE_ROLE_KEY'] if admin else env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
 h={'apikey':key,'Authorization':'Bearer '+(session['access_token'] if session else key),'Content-Type':'application/json'}
 try:
  with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method),timeout=90) as r:return json.load(r)
 except urllib.error.HTTPError as error:raise RuntimeError('HTTP '+str(error.code)+' '+path+' '+error.read().decode()[:800])
def rpc(name,body,session):return http('/rest/v1/rpc/'+name,body,session=session)
def checkpoint(key,fn):
 if key in state:return state[key]
 assert state.get('pending')!=key,'Uncertain prior '+key+' inspect exact fixture first'
 state['pending']=key;save();value=fn();state[key]=value;state.pop('pending');save();return value
mode=sys.argv[1]
if mode in ['setup','cleanup']:identify_stage()
if mode=='serve':
 e={**os.environ,**env}; assert e['NEXT_PUBLIC_SUPABASE_URL']==BASE
 os.chdir(ROOT);os.execvpe('npm',['npm','run','dev','--','--hostname','127.0.0.1','--port','4342'],e)
elif mode=='setup':
 assert not state.get('cleaned'),'Never reactivate retired test actors'
 save()
 ledger=sql("SELECT json_build_object('schema366',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='366'),'hook',to_regprocedure('public.haven_custom_access_token_hook(jsonb)') IS NOT NULL)")
 assert all(json.loads(ledger).values()),'Required staging schema absent'
 stage=json.loads(sql("SELECT json_agg(x) FROM (SELECT version,name FROM supabase_migrations.schema_migrations) x"));local={p.name.split('_',1)[0] for p in (ROOT/'supabase/migrations').glob('*.sql')};assert {x['version'] for x in stage}==local and next(x for x in stage if x['version']=='366')['name']=='hfo_profile_draft_preparation','Unexpected staging ledger';(OUT/'stage-ledger.json').write_text(json.dumps({'local_max_numeric':'366','ledger_matches_local_source':True,'ledger':stage},indent=2))
 if 'user' not in state:
  state['email']=state['run']+'@example.invalid';state['password']=secrets.token_urlsafe(30);save()
  state['user']=checkpoint('auth_user',lambda:http('/auth/v1/admin/users',{'email':state['email'],'password':state['password'],'email_confirm':True,'user_metadata':{'full_name':'COL224 Synthetic Operator'}},admin=True))['id'];state.pop('auth_user',None);save()
 if 'rows_created' not in state:
  q=f"""BEGIN;
INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES({lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Entity')},'llc');
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone) VALUES({lit(state['site'])},{lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Site')},'Synthetic','Test','00000',1,'America/New_York');
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) VALUES({lit(state['user'])},{lit(state['email'])},'COL224 Synthetic Operator','owner',{lit(ORG)},true);
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES({lit(state['user'])},{lit(state['site'])},{lit(ORG)},{lit(state['user'])});
COMMIT;"""
  checkpoint('rows_created',lambda:sql(q))
 session=http('/auth/v1/token?grant_type=password',{'email':state['email'],'password':state['password']})
 claims=json.loads(base64.urlsafe_b64decode(session['access_token'].split('.')[1]+'=='));assert claims.get('session_id') and claims.get('auth_claim_version') is not None
 state['session']=session;save()
 (OUT/'fixture-summary.json').write_text(json.dumps({'run':state['run'],'target':REF,'site':state['site'],'actor':state['user'],'preflight':json.loads(ledger),'auth_hook_claims_verified':True},indent=2))
 print('Fixture setup checkpoint complete; credentials private')
elif mode=='cleanup':
 assert state.get('user') and state['email'].startswith(state['run'])
 sql(f"BEGIN; UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id={lit(state['user'])}; UPDATE public.user_profiles SET is_active=false WHERE id={lit(state['user'])}; UPDATE public.facilities SET deleted_at=clock_timestamp() WHERE id={lit(state['site'])}; UPDATE public.entities SET deleted_at=clock_timestamp() WHERE id={lit(state['entity'])}; COMMIT;")
 http('/auth/v1/admin/users/'+state['user'],{'ban_duration':'876000h'},method='PUT',admin=True)
 check=sql(f"SELECT json_build_object('active',p.is_active,'banned',u.banned_until>clock_timestamp(),'live_grants',(SELECT count(*) FROM public.user_facility_access WHERE user_id=p.id AND revoked_at IS NULL),'site_retired',(SELECT deleted_at IS NOT NULL FROM public.facilities WHERE id={lit(state['site'])}),'entity_retired',(SELECT deleted_at IS NOT NULL FROM public.entities WHERE id={lit(state['entity'])})) FROM public.user_profiles p JOIN auth.users u ON u.id=p.id WHERE p.id={lit(state['user'])}")
 confirmed=json.loads(check);assert confirmed['banned'] and not confirmed['active'] and confirmed['live_grants']==0 and confirmed['site_retired'] and confirmed['entity_retired'],'Fixture retirement not verified'
 state['cleaned']=True;state.pop('session',None);save();(OUT/'cleanup.json').write_text(check+'\n');print(check)
