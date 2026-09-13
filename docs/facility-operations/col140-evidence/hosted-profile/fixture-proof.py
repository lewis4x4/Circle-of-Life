#!/usr/bin/env python3
"""Explicit guarded stages; fresh scoped fixtures only; no source rule publication."""
import argparse,base64,datetime,hashlib,json,os,pathlib,secrets,subprocess,urllib.request,urllib.error,urllib.parse,uuid
from guarded import Runtime,ROOT,OUT,REF,require,digest,NoRedirect
ORG='00000000-0000-0000-0000-000000000001';PRIVATE=pathlib.Path.home()/'.config/haven-staging/col140-profile-fixture.json'
def lit(v):return "'"+str(v).replace("'","''")+"'"
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['setup','serve','exercise','deny-cleanup']);parser.add_argument('--ready',required=True);args=parser.parse_args()
 r=Runtime(args.ready,stage=True);r.identify();require(r.sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='366'")=='1','Staging366 absent')
 if args.action=='serve':os.chdir(ROOT);os.execvpe('npm',['npm','run','dev','--','--hostname','127.0.0.1','--port','4340'],{**os.environ,**r.env})
 state=json.loads(PRIVATE.read_text()) if PRIVATE.exists() else {'run':'col140-'+secrets.token_hex(6),'target':REF,'sourceSha':r.ready['sourceSha'],'entity':str(uuid.uuid4()),'site':str(uuid.uuid4()),'siteb':str(uuid.uuid4())}
 require(state['target']==REF and state['run'].startswith('col140-') and state['sourceSha']==r.ready['sourceSha'],'Wrong fixture/source provenance');require(not state.get('cleaned'),'Never reactivate retired fixture')
 def save():PRIVATE.write_text(json.dumps(state,indent=2));PRIVATE.chmod(0o600)
 def http(url,body=None,method='POST',expected=(200,),admin=False,local=False):
  r.verify();host=urllib.parse.urlparse(url).hostname;require(host in [REF+'.supabase.co','127.0.0.1'],'Unexpected transport target')
  headers={'Content-Type':'application/json'}
  if local:headers['Cookie']=cookie()
  else:
   key=r.env['SUPABASE_SERVICE_ROLE_KEY'] if admin else r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];headers.update(apikey=key,Authorization='Bearer '+key)
  try:
   with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,method=method,headers=headers),timeout=120) as response:status=response.status;raw=response.read()
  except urllib.error.HTTPError as e:status=e.code;raw=e.read()
  require(status in expected,'Unexpected HTTP'+str(status)+' at '+urllib.parse.urlparse(url).path)
  return json.loads(raw)
 def cookie():
  encoded='base64-'+base64.urlsafe_b64encode(json.dumps(state['session'],separators=(',',':')).encode()).decode().rstrip('=');name='sb-'+REF+'-auth-token'
  return '; '.join(name+('.'+str(i//3180) if len(encoded)>3180 else '')+'='+encoded[i:i+3180] for i in range(0,len(encoded),3180))
 def api(path,body=None,method='POST',expected=(200,)):return http(r.app+'/api/admin/operations'+path,body,method,expected,local=True)
 def checkpoint(key,fn):
  if key in state:return state[key]
  require(state.get('pending')!=key,'Uncertain previous step; inspect exact own rows before retry: '+key)
  state['pending']=key;save();value=fn();state[key]=value;state.pop('pending');save();return value
 def hashes():
  return json.loads(r.sql("SELECT coalesce(json_object_agg(key,hash),'{}'::json) FROM (SELECT 'central:'||id key,md5(to_jsonb(r)::text) hash FROM public.operation_requirement_versions r WHERE organization_id="+lit(ORG)+" UNION ALL SELECT 'site:'||id,md5(to_jsonb(f)::text) FROM public.operation_facility_requirements f WHERE organization_id="+lit(ORG)+") x"))
 save()
 if args.action=='setup':
  if 'user' not in state:
   state['email']=state['run']+'@example.invalid';state['password']=secrets.token_urlsafe(30);save()
   state['user']=checkpoint('auth_user',lambda:http(r.base+'/auth/v1/admin/users',{'email':state['email'],'password':state['password'],'email_confirm':True,'user_metadata':{'full_name':'COL140 Synthetic Owner'}},admin=True,expected=(200,201)))['id'];state.pop('auth_user');save()
  if 'rows' not in state:
   checkpoint('rows',lambda:r.sql(f"BEGIN; INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES({lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Entity')},'llc'); INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone) VALUES({lit(state['site'])},{lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Site A')},'Synthetic','Test','00000',1,'America/New_York'),({lit(state['siteb'])},{lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Site B')},'Synthetic','Test','00000',1,'America/New_York'); INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) VALUES({lit(state['user'])},{lit(state['email'])},'COL140 Synthetic Owner','owner',{lit(ORG)},true); INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES({lit(state['user'])},{lit(state['site'])},{lit(ORG)},{lit(state['user'])}); COMMIT;"))
  state['session']=http(r.base+'/auth/v1/token?grant_type=password',{'email':state['email'],'password':state['password']});save()
  claims=json.loads(base64.urlsafe_b64decode(state['session']['access_token'].split('.')[1]+'=='));require(claims.get('session_id') and claims.get('auth_claim_version') is not None,'Auth hook not active')
  if 'baseline' not in state:state['baseline']=hashes();save()
  if 'operator_draft' not in state:
   target=r.sql("SELECT a.id FROM public.operation_activities a JOIN public.operation_activity_source_mappings m ON m.activity_id=a.id JOIN public.operation_activity_source_items s ON s.id=m.source_item_id WHERE a.organization_id="+lit(ORG)+" AND s.source_payload->>'disposition'='mapped' AND a.subject_kind IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.operation_requirement_versions v WHERE v.activity_id=a.id) ORDER BY a.id LIMIT 1")
   require(bool(target),'No untouched catalog component remains for synthetic operator draft; do not overwrite existing drafts')
   state['operator_activity']=target;save()
   # Lock before absence check; never overwrite a concurrent operator's draft.
   # Replay real issued session claims under authenticated role for this fixture RPC.
   payload={'wording':'Synthetic operator draft in progress; not approved','allowed_recorder_roles':[],'source_authority':{'source':state['run'],'approval':'unapproved'}}
   query="BEGIN; DO $$ BEGIN PERFORM 1 FROM public.operation_activities WHERE id="+lit(target)+" FOR UPDATE; IF EXISTS(SELECT 1 FROM public.operation_requirement_versions WHERE activity_id="+lit(target)+") THEN RAISE EXCEPTION 'Catalog component gained a draft; inspect instead of overwriting'; END IF; END $$; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',"+lit(json.dumps(claims))+",true); SELECT public.save_operation_requirement_draft_review("+lit(target)+","+lit(json.dumps(payload))+"::jsonb); COMMIT;"
   checkpoint('operator_draft',lambda:r.sql(query))
  state['before_prepare']=hashes();save();print('Fresh fixture and synthetic operator draft prepared; nothing published')
 elif args.action=='exercise':
  before=api('/facility-profile?facility_id='+state['site'],method='GET');require(before['coverage']['source_count']==91 and before['coverage']['component_count']==110 and before['complete'],'Incomplete profile')
  expected=json.loads(r.sql("SELECT json_object_agg(source_item_id,source_payload->>'sourceText') FROM public.operation_activity_source_items WHERE organization_id="+lit(ORG)+" AND intake_version='haven-admin-20260909'"));require({e['source_id']:e['source_text'] for e in before['entries']}==expected,'Profile did not reflect persisted source payloads')
  prepared=checkpoint('prepared',lambda:api('/facility-profile/drafts',{'facility_id':state['site']}));retry=api('/facility-profile/drafts',{'facility_id':state['site']});require(retry['prepared']==0,'Retry made drafts')
  current=hashes();require(all(current.get(k)==v for k,v in state['before_prepare'].items()),'An existing draft/published version changed')
  after=api('/facility-profile?facility_id='+state['site'],method='GET');require(after['complete'] and after['coverage']==before['coverage'],'Profile coverage changed')
  unsafe=r.sql("SELECT count(*) FROM public.operation_facility_requirements WHERE facility_id="+lit(state['site'])+" AND (status<>'draft' OR schedule_rule IS NOT NULL OR schedule_status<>'needs_confirmation' OR effective_from IS NOT NULL)");require(unsafe=='0','Fixture preparation activated a rule')
  result={'result':'PASS','target':REF,'sourceSha':r.ready['sourceSha'],'prepared':prepared,'retry':retry,'existing_rows_preserved':len(state['before_prepare']),'coverage':after['coverage'],'no_active_rules':True,'profile':after};(OUT/'http-proof.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'result':'PASS','coverage':after['coverage'],'retry_prepared':0,'existing_rows_preserved':len(state['before_prepare'])}))
 else:
  api('/facility-profile?facility_id='+state['siteb'],method='GET',expected=(404,));api('/facility-profile/drafts',{'facility_id':state['siteb']},expected=(404,))
  r.sql('UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id='+lit(state['user']))
  api('/facility-profile?facility_id='+state['site'],method='GET',expected=(401,403,404));api('/facility-profile/drafts',{'facility_id':state['site']},expected=(401,403,404))
  r.sql(f"BEGIN; UPDATE public.user_profiles SET is_active=false WHERE id={lit(state['user'])}; UPDATE public.facilities SET deleted_at=clock_timestamp() WHERE id IN({lit(state['site'])},{lit(state['siteb'])}); UPDATE public.entities SET deleted_at=clock_timestamp() WHERE id={lit(state['entity'])}; COMMIT;")
  http(r.base+'/auth/v1/admin/users/'+state['user'],{'ban_duration':'876000h'},method='PUT',admin=True)
  check=json.loads(r.sql("SELECT json_build_object('banned',u.banned_until>clock_timestamp(),'inactive',NOT p.is_active,'live_grants',(SELECT count(*) FROM public.user_facility_access WHERE user_id=u.id AND revoked_at IS NULL)) FROM auth.users u JOIN public.user_profiles p ON p.id=u.id WHERE u.id="+lit(state['user'])))
  require(check['banned'] and check['inactive'] and check['live_grants']==0,'Cleanup not confirmed');state['cleaned']=True;state.pop('session',None);save();(OUT/'cleanup.json').write_text(json.dumps({'result':'PASS','cross_site_denied':True,'revoked_denied':True,**check},indent=2)+'\n');print('Exact fixtures retired; draft/audit history retained')
if __name__=='__main__':main()
