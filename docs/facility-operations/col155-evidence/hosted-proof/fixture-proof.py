#!/usr/bin/env python3
"""COL155 preparation: exact fresh fixtures; publish synthetic rules only inside a fresh isolated organization."""
import argparse,base64,datetime,json,os,pathlib,secrets,urllib.request,urllib.error,urllib.parse,uuid
from guarded import Runtime,ROOT,OUT,REF,require,NoRedirect
PRIVATE=pathlib.Path.home()/'.config/haven-staging/col155-review-fixture.json'
def lit(value):return "'"+str(value).replace("'","''")+"'"
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['setup','serve','exercise','deny','cleanup']);p.add_argument('--ready',required=True);args=p.parse_args()
 r=Runtime(args.ready,stage=True);r.identify()
 if args.action=='serve':os.chdir(ROOT);os.execvpe('npm',['npm','run','dev','--','--hostname','127.0.0.1','--port','4355'],{**os.environ,**r.env})
 state=json.loads(PRIVATE.read_text()) if PRIVATE.exists() else {'run':'col155-'+secrets.token_hex(6),'sourceSha':r.ready['sourceSha'],'target':REF,**{key:str(uuid.uuid4()) for key in ['org','activity','entity','site','siteb','resident','subject','contact']}}
 ORG=state['org']
 require(state['target']==REF and state['sourceSha']==r.ready['sourceSha'] and state['run'].startswith('col155-'),'Wrong fixture provenance')
 require(not state.get('cleaned'),'Never reactivate retired fixtures')
 if PRIVATE.exists():require(PRIVATE.stat().st_mode&0o077==0,'Fixture state must be private')
 def save():
  fd=os.open(PRIVATE,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
  with os.fdopen(fd,'w') as file:json.dump(state,file,indent=2)
 def checkpoint(key,fn):
  if key in state:return state[key]
  require(state.get('pending')!=key,'Uncertain prior mutation; inspect exact owned state before retry: '+key)
  state['pending']=key;save();result=fn();state[key]=result;state.pop('pending');save();return result
 def cookie(session):
  require(session['expires_at']*1000>datetime.datetime.now().timestamp()*1000,'Expired fixture session')
  encoded='base64-'+base64.urlsafe_b64encode(json.dumps(session,separators=(',',':')).encode()).decode().rstrip('=');name='sb-'+REF+'-auth-token'
  return '; '.join(name+('.'+str(i//3180) if len(encoded)>3180 else '')+'='+encoded[i:i+3180] for i in range(0,len(encoded),3180))
 def http(url,body=None,method='POST',expected=(200,),admin=False,session=None):
  r.verify();parsed=urllib.parse.urlparse(url);require((parsed.scheme,parsed.netloc) in [('https',REF+'.supabase.co'),('http','127.0.0.1:4355')],'Unexpected HTTP target')
  headers={'Content-Type':'application/json'}
  if parsed.netloc=='127.0.0.1:4355':headers['Cookie']=cookie(session or state['session'])
  else:
   key=r.env['SUPABASE_SERVICE_ROLE_KEY'] if admin else r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];headers.update(apikey=key,Authorization='Bearer '+key)
  try:
   with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,method=method,headers=headers),timeout=90) as response:status=response.status;raw=response.read()
  except urllib.error.HTTPError as error:status=error.code;raw=error.read()
  require(status in expected,'Unexpected HTTP '+str(status)+' at '+parsed.path)
  return json.loads(raw)
 def api(path,body=None,method='POST',expected=(200,),session=None):return http(r.app+'/api/admin/operations'+path,body,method,expected,session=session)
 def authenticated_sql(query):
  claims=json.loads(base64.urlsafe_b64decode(state['session']['access_token'].split('.')[1]+'=='))
  require(claims.get('session_id') and claims.get('auth_claim_version') is not None,'Actual hooked auth session required')
  return r.sql('BEGIN; SET LOCAL ROLE authenticated; SELECT set_config(\'request.jwt.claims\','+lit(json.dumps(claims))+',true); '+query+'; COMMIT;').splitlines()[-1]
 def native_snapshot():
  # Hash every public native table with resident_id, scoped to this one synthetic resident.
  tables=json.loads(r.sql("SELECT json_agg(c.table_name ORDER BY c.table_name) FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='public' AND c.column_name='resident_id' AND c.table_name NOT LIKE 'operation_%' AND t.table_type='BASE TABLE'"))
  result={}
  for table in tables:
   require(table.replace('_','').isalnum(),'Unexpected native table identifier')
   result[table]=r.sql('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),\'[]\'::jsonb)::text) FROM public."'+table+'" x WHERE resident_id='+lit(state['resident']))
  result['residents']=r.sql('SELECT md5(to_jsonb(x)::text) FROM public.residents x WHERE id='+lit(state['resident']))
  return result
 save()
 if args.action=='setup':
  state['taskLabel']='COL155 Synthetic contact review';save()
  for role,key in [('owner','user'),('maintenance_role','limited_user')]:
   if key not in state:
    state[key+'_email']=state['run']+'-'+key+'@example.invalid';state[key+'_password']=secrets.token_urlsafe(30);save()
    result=checkpoint(key,lambda:http(r.base+'/auth/v1/admin/users',{'email':state[key+'_email'],'password':state[key+'_password'],'email_confirm':True,'user_metadata':{'full_name':'COL155 Synthetic '+key}},admin=True,expected=(200,201)))
    state[key]=result['id'];save()
  def rows():
   return r.sql(f"BEGIN; INSERT INTO public.organizations(id,name) VALUES({lit(ORG)},{lit(state['run']+' Organization')}); INSERT INTO public.operation_activities(id,organization_id,activity_key,name,activity_kind,subject_kind,origin) VALUES({lit(state['activity'])},{lit(ORG)},'hfo-al-w07-01',{lit(state['taskLabel'])},'record_review','resident','admin_log'); INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES({lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Entity')},'llc'); INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone) VALUES({lit(state['site'])},{lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Site')},'Synthetic','Test','00000',1,'America/New_York'),({lit(state['siteb'])},{lit(state['entity'])},{lit(ORG)},{lit(state['run']+' Other Site')},'Synthetic','Test','00000',1,'America/New_York'); INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) VALUES({lit(state['user'])},{lit(state['user_email'])},'COL155 Synthetic Owner','owner',{lit(ORG)},true),({lit(state['limited_user'])},{lit(state['limited_user_email'])},'COL155 Synthetic Limited','maintenance_role',{lit(ORG)},true); INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES({lit(state['user'])},{lit(state['site'])},{lit(ORG)},{lit(state['user'])}),({lit(state['limited_user'])},{lit(state['site'])},{lit(ORG)},{lit(state['user'])}); INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) VALUES({lit(ORG)},{lit(state['site'])},{lit(state['user'])},'resident',{lit(state['user'])},'Synthetic source review',true),({lit(ORG)},{lit(state['site'])},{lit(state['limited_user'])},'resident',{lit(state['user'])},'Synthetic HFO-only scope',true); INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) VALUES({lit(state['resident'])},{lit(ORG)},{lit(state['site'])},'COL155','Synthetic','1940-01-01','female','active'); INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) VALUES({lit(state['subject'])},{lit(ORG)},{lit(state['site'])},'resident',{lit(state['resident'])}); INSERT INTO public.resident_contacts(id,resident_id,facility_id,organization_id,contact_type,name,created_by,updated_by) VALUES({lit(state['contact'])},{lit(state['resident'])},{lit(state['site'])},{lit(ORG)},'family','COL155 Synthetic Contact',{lit(state['user'])},{lit(state['user'])}); COMMIT;")
  checkpoint('rows',rows)
  for key,target in [('user','session'),('limited_user','limited_session')]:state[target]=http(r.base+'/auth/v1/token?grant_type=password',{'email':state[key+'_email'],'password':state[key+'_password']});save()
  central=checkpoint('central_draft',lambda:json.loads(authenticated_sql('SELECT public.save_operation_requirement_draft_review('+lit(state['activity'])+','+lit(json.dumps({'title':state['taskLabel'],'wording':'Synthetic source reference review only','allowed_recorder_roles':['owner'],'subject_kind':'resident','review_required':True,'allowed_reviewer_roles':['owner']}))+'::jsonb)')))
  checkpoint('central_published',lambda:authenticated_sql('SELECT public.publish_operation_requirement_review('+lit(central['id'])+',clock_timestamp())'))
  state['rule']=central['id'];save()
  fr=checkpoint('facility_draft',lambda:json.loads(authenticated_sql('SELECT public.save_operation_facility_requirement_draft_review('+lit(state['activity'])+','+lit(state['site'])+','+lit(json.dumps({'applicability':'applicable','requirement_version_id':state['rule'],'schedule_status':'needs_confirmation'}))+'::jsonb)')))
  checkpoint('facility_published',lambda:authenticated_sql('SELECT public.publish_operation_facility_requirement_review('+lit(fr['id'])+',clock_timestamp())'))
  occurrence=checkpoint('occurrence',lambda:json.loads(authenticated_sql('SELECT public.create_operation_manual_occurrence_review('+lit(state['activity'])+','+lit(state['site'])+','+lit(state['subject'])+','+lit(state['run']+'-manual')+",'{}'::jsonb)")))
  for width in [1440,375]:
   checkpoint('browser_task_'+str(width),lambda width=width:json.loads(authenticated_sql('SELECT public.create_operation_manual_occurrence_review('+lit(state['activity'])+','+lit(state['site'])+','+lit(state['subject'])+','+lit(state['run']+'-browser-'+str(width))+",'{}'::jsonb)")))
  state['task']=occurrence['id'];today=datetime.date.fromisoformat(r.sql("SELECT (clock_timestamp() AT TIME ZONE 'America/New_York')::date"));state['period']={'start_date':str(today-datetime.timedelta(days=7)),'end_date':str(today-datetime.timedelta(days=1))};save();print('Fresh scoped fixture prepared; rules isolated to fresh synthetic organization')
 elif args.action=='exercise':
  require(not state.get('httpProofPassed'),'Exercise already completed; do not silently replay after source correction')
  query=urllib.parse.urlencode({'task_id':state['task'],'family':'resident_contact',**state['period']})
  candidates=api('/resident-review-sources?'+query,method='GET');require(candidates['task_id']==state['task'] and candidates['eligible'],'Wrong source scope')
  source=next(row for row in candidates['items'] if row['source_id']==state['contact'])
  require('Synthetic Contact' not in json.dumps(candidates),'Native contact contents exposed')
  if 'before_native' not in state:state['before_native']=native_snapshot();save()
  if 'review_body' not in state:
   revision=r.sql('SELECT occurrence_revision FROM public.operation_task_instances WHERE id='+lit(state['task']))
   state['review_body']={'request_key':state['run']+'-review','expected_occurrence_revision':revision,'period':state['period'],'references':[{'family':'resident_contact','source_id':source['source_id'],'source_version':source['source_version']}],'payload':{'outcome':'performed','note':'Synthetic explicit current human review'}};save()
  result=checkpoint('review_result',lambda:api('/occurrences/'+state['task']+'/source-review',state['review_body']))
  state['receipt']=result['receipt']['id'];save();require(result['receipt']['recorder_id']==state['user'],'Wrong review actor')
  require(native_snapshot()==state['before_native'],'Review command changed native records')
  retry=api('/occurrences/'+state['task']+'/source-review',state['review_body']);require(retry['receipt']['id']==state['receipt'],'Retry duplicated receipt')
  checkpoint('source_changed',lambda:r.sql('UPDATE public.resident_contacts SET relationship=\'Synthetic changed relationship\' WHERE id='+lit(state['contact'])+' AND resident_id='+lit(state['resident'])))
  history=api('/occurrences/'+state['task']+'/source-reviews',method='GET');ref=next(ref for row in history['reviews'] if row['receipt_id']==state['receipt'] for ref in row['references']);require(ref['current_state']=='changed' and ref['requires_review'],'Changed source not detected')
  checked=api('/occurrences/'+state['task']+'/source-reviews/recheck',{'request_key':state['run']+'-recheck','reference_id':ref['reference_id']});require(any(ref['checks'] for row in checked['reviews'] for ref in row['references']),'Recheck history absent')
  state['httpProofPassed']=True;save();(OUT/'http-proof.json').write_text(json.dumps({'result':'PASS','sourceSha':state['sourceSha'],'target':REF,'task':state['task'],'receipt':state['receipt'],'nativeRowsUnchangedByReview':True,'changedState':ref['current_state'],'retrySameReceipt':True},indent=2)+'\n')
 elif args.action=='deny':
  api('/workspace?'+urllib.parse.urlencode({'facility_id':state['siteb'],'view':'today'}),method='GET',expected=(403,404))
  query=urllib.parse.urlencode({'task_id':state['task'],'family':'resident_contact',**state['period']})
  workspace=api('/workspace?'+urllib.parse.urlencode({'facility_id':state['site'],'view':'today','mine':'0'}),method='GET',session=state['limited_session'])
  require(not workspace.get('partial'),'Limited actor HFO workspace incomplete')
  groups=workspace.get('groups',{});items=[item for group in groups.values() if isinstance(group,list) for item in group]
  require(any(item.get('occurrence',{}).get('id')==state['task'] for item in items),'Limited actor must successfully read exact HFO task before native denial')
  limited=api('/resident-review-sources?'+query,method='GET',expected=(200,403,404),session=state['limited_session'])
  require(state['contact'] not in json.dumps(limited) and not limited.get('items'),'Native source exposed to HFO-only actor')
  checkpoint('scope_revoked',lambda:r.sql('UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id='+lit(state['user'])+' AND facility_id='+lit(state['site'])))
  api('/resident-review-sources?'+query,method='GET',expected=(401,403,404))
  (OUT/'denial-proof.json').write_text(json.dumps({'result':'PASS','target':REF,'crossSiteWorkspaceDenied':True,'limitedHfoTaskRead200':True,'limitedNativeDetailsDenied':True,'revokedSiteDenied':True})+'\n')
 elif args.action=='cleanup':
  for key in ['user','limited_user']:
   if state.get(key):http(r.base+'/auth/v1/admin/users/'+state[key],{'ban_duration':'876000h'},method='PUT',admin=True)
  users=','.join(lit(state[key]) for key in ['user','limited_user'] if state.get(key));require(users,'No exact actors recorded')
  r.sql('BEGIN; UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE user_id IN('+users+') AND facility_id='+lit(state['site'])+'; UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id IN('+users+'); UPDATE public.user_profiles SET is_active=false WHERE id IN('+users+'); UPDATE public.facilities SET deleted_at=clock_timestamp() WHERE id IN('+lit(state['site'])+','+lit(state['siteb'])+'); UPDATE public.entities SET deleted_at=clock_timestamp() WHERE id='+lit(state['entity'])+'; UPDATE public.organizations SET deleted_at=clock_timestamp() WHERE id='+lit(ORG)+'; COMMIT;')
  facts=json.loads(r.sql('SELECT json_build_object(\'org_retired\',(SELECT deleted_at IS NOT NULL FROM public.organizations WHERE id='+lit(ORG)+'),\'inactive\',(SELECT bool_and(NOT is_active) FROM public.user_profiles WHERE id IN('+users+')),\'subject_grants_revoked\',(SELECT count(*)=2 AND bool_and(revoked_at IS NOT NULL) FROM public.operation_subject_access WHERE user_id IN('+users+') AND facility_id='+lit(state['site'])+'),\'site_grants_retained\',(SELECT count(*)=2 FROM public.user_facility_access WHERE user_id IN('+users+')),\'zero_grants\',(SELECT count(*)=0 FROM public.user_facility_access WHERE user_id IN('+users+') AND revoked_at IS NULL),\'sites_retired\',(SELECT count(*)=2 AND bool_and(deleted_at IS NOT NULL) FROM public.facilities WHERE id IN('+lit(state['site'])+','+lit(state['siteb'])+')),\'entity_retired\',(SELECT deleted_at IS NOT NULL FROM public.entities WHERE id='+lit(state['entity'])+'))'))
  for key in ['user','limited_user']:
   user=http(r.base+'/auth/v1/admin/users/'+state[key],method='GET',admin=True);require(datetime.datetime.fromisoformat(user['banned_until'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'Ban readback failed')
  require(all(facts.values()),'Fixture retirement incomplete');state['cleaned']=True;save();(OUT/'cleanup.json').write_text(json.dumps({'result':'PASS','target':REF,'facts':facts,'bansVerified':True,'historyRetained':True,'ownedListenerClosed':False},indent=2)+'\n');print('Exact fixtures retired; owned listener still requires verified stop')
if __name__=='__main__':main()
