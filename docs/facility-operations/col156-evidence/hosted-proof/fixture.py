#!/usr/bin/env python3
"""Fresh isolated COL156 fixture preparation/retirement. Never touches existing HR drafts."""
import argparse,base64,datetime,json,os,pathlib,secrets,urllib.request,urllib.error,uuid
from guarded import Runtime,ROOT,OUT,REF,NoRedirect,require
PRIVATE=pathlib.Path.home()/'.config/haven-staging/col156-fixture.json'
def lit(value):return "'"+str(value).replace("'","''")+"'"
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['setup','serve','cleanup']);p.add_argument('--ready',required=True);args=p.parse_args();r=Runtime(args.ready,stage=True);r.identify()
 if args.action=='serve':os.chdir(ROOT);os.execvpe('npm',['npm','run','dev','--','--hostname','127.0.0.1','--port','4356'],{**os.environ,**r.env})
 if PRIVATE.exists():require(PRIVATE.stat().st_mode&0o077==0,'Private state required')
 s=json.loads(PRIVATE.read_text()) if PRIVATE.exists() else {'run':'col156-'+secrets.token_hex(6),'target':REF,'sourceSha':r.ready['sourceSha'],**{key:str(uuid.uuid4()) for key in ['org','entity','site','other_site','staff','other_staff','activity','subject']},'users':{},'passwords':{},'sessions':{},'requirements':{},'record_ids':{key:str(uuid.uuid4()) for key in ['personnel','medical']}}
 require(s['target']==REF and s['sourceSha']==r.ready['sourceSha'] and s['run'].startswith('col156-') and not s.get('cleaned'),'Wrong/retired fixture')
 def save():
  fd=os.open(PRIVATE,os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600)
  with os.fdopen(fd,'w') as f:json.dump(s,f,indent=2)
 def checkpoint(key,fn):
  if key in s:return s[key]
  require(s.get('pending')!=key,'Uncertain previous fixture mutation: '+key);s['pending']=key;save();value=fn();s[key]=value;s.pop('pending');save();return value
 def auth(path,body=None,method='POST',admin=False):
  r.verify();r.identify();key=r.env['SUPABASE_SERVICE_ROLE_KEY'] if admin else r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}
  with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(r.base+'/auth/v1/'+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers=headers),timeout=60) as response:return json.load(response)
 def sql_user(query):
  session=s['sessions']['owner'];claims=json.loads(base64.urlsafe_b64decode(session['access_token'].split('.')[1]+'=='));require(claims.get('session_id') and claims.get('auth_claim_version') is not None,'Actual hooked session required')
  return json.loads(r.sql('BEGIN; SET LOCAL ROLE authenticated; SELECT set_config(\'request.jwt.claims\','+lit(json.dumps(claims))+',true); '+query+'; COMMIT;').splitlines()[-1])
 save()
 if args.action=='setup':
  for actor in ['owner','employee','manager']:
   if actor not in s['users']:
    s['passwords'][actor]=secrets.token_urlsafe(30);save();user=checkpoint('auth_'+actor,lambda actor=actor:auth('admin/users',{'email':s['run']+'-'+actor+'@example.invalid','password':s['passwords'][actor],'email_confirm':True,'user_metadata':{'full_name':'COL156 Synthetic '+actor}},admin=True));s['users'][actor]=user['id'];save()
  def rows():
   query=f"BEGIN; INSERT INTO public.organizations(id,name) VALUES({lit(s['org'])},{lit(s['run'])}); INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES({lit(s['entity'])},{lit(s['org'])},{lit(s['run'])},'llc');"
   for site in ['site','other_site']:query+=f"INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) VALUES({lit(s[site])},{lit(s['org'])},{lit(s['entity'])},{lit(s['run']+' '+site)},'Synthetic','Test','00000',1,'America/New_York');"
   for actor,role in [('owner','owner'),('employee','caregiver'),('manager','manager')]:query+=f"INSERT INTO public.user_profiles(id,email,full_name,organization_id,app_role,is_active) VALUES({lit(s['users'][actor])},{lit(s['run']+'-'+actor+'@example.invalid')},{lit('COL156 Synthetic '+actor)},{lit(s['org'])},{lit(role)},true); INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES({lit(s['users'][actor])},{lit(s['site'])},{lit(s['org'])},{lit(s['users']['owner'])});"
   query+=f"INSERT INTO public.staff(id,organization_id,facility_id,user_id,first_name,last_name,staff_role,hire_date) VALUES({lit(s['staff'])},{lit(s['org'])},{lit(s['site'])},{lit(s['users']['employee'])},'COL156','Synthetic','resident_aide',(now() AT TIME ZONE 'America/New_York')::date-100); INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date) VALUES({lit(s['other_staff'])},{lit(s['org'])},{lit(s['other_site'])},'COL156','Other','resident_aide',(now() AT TIME ZONE 'America/New_York')::date-100); INSERT INTO public.operation_activities(id,organization_id,activity_key,name,activity_kind,subject_kind,origin) VALUES({lit(s['activity'])},{lit(s['org'])},'hfo-al-w06-01','COL156 Synthetic employee file context','record_review','employee','admin_log'); INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,employee_id) VALUES({lit(s['subject'])},{lit(s['org'])},{lit(s['site'])},'employee',{lit(s['staff'])});"
   for scope in ['employee_personnel','employee_medical']:query+=f"INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) VALUES({lit(s['org'])},{lit(s['site'])},{lit(s['users']['owner'])},{lit(scope)},{lit(s['users']['owner'])},'Synthetic isolated proof',true);"
   return r.sql(query+'COMMIT;')
  checkpoint('rows',rows)
  for actor in s['users']:s['sessions'][actor]=auth('token?grant_type=password',{'email':s['run']+'-'+actor+'@example.invalid','password':s['passwords'][actor]});save()
  for category,code in [('personnel','TRN-24'),('medical','DOC-039')]:
   payload={'code':code,'title':'COL156 Synthetic '+category,'category':'medical' if category=='medical' else 'training','source_file':'Synthetic only','source_page':1,'source_excerpt':'Isolated transport proof','recurrence_status':'one_time','content':'Synthetic evidence transport','required_signers':['employee','administrator'],'applies_to_staff_roles':['resident_aide']}
   requirement=checkpoint('requirement_'+category,lambda payload=payload:sql_user('SELECT public.haven_employee_requirement_command('+lit(s['site'])+",'create',"+lit(json.dumps(payload))+'::jsonb)'));s['requirements'][category]=requirement['id'];save()
   checkpoint('approved_'+category,lambda requirement=requirement:sql_user('SELECT public.haven_employee_requirement_command('+lit(s['site'])+",'approve',"+lit(json.dumps({'id':requirement['id'],'review_note':'Synthetic isolated transport rule; not operating policy'}))+'::jsonb)'))
  checkpoint('medical_grant',lambda:sql_user('SELECT public.haven_employee_requirement_command('+lit(s['site'])+",'grant_medical',"+lit(json.dumps({'user_id':s['users']['owner'],'review_note':'Synthetic isolated evidence reviewer'}))+'::jsonb)'))
  rule=checkpoint('hfo_rule',lambda:sql_user('SELECT public.save_operation_requirement_draft_review('+lit(s['activity'])+','+lit(json.dumps({'title':'COL156 Synthetic employee file context','wording':'Source projection only','allowed_recorder_roles':['owner'],'subject_kind':'employee'}))+'::jsonb)'))
  checkpoint('hfo_published',lambda:sql_user('SELECT public.publish_operation_requirement_review('+lit(rule['id'])+',clock_timestamp())'))
  site=checkpoint('hfo_site',lambda:sql_user('SELECT public.save_operation_facility_requirement_draft_review('+lit(s['activity'])+','+lit(s['site'])+','+lit(json.dumps({'applicability':'applicable','requirement_version_id':rule['id'],'schedule_status':'needs_confirmation'}))+'::jsonb)'))
  checkpoint('hfo_site_published',lambda:sql_user('SELECT public.publish_operation_facility_requirement_review('+lit(site['id'])+',clock_timestamp())'))
  task=checkpoint('hfo_task',lambda:sql_user('SELECT public.create_operation_manual_occurrence_review('+lit(s['activity'])+','+lit(s['site'])+','+lit(s['subject'])+','+lit(s['run']+'-manual')+",'{}'::jsonb)"));s['task']=task['id']
  today=datetime.date.fromisoformat(r.sql("SELECT (now() AT TIME ZONE 'America/New_York')::date"));s['completed_on']=str(today);s['expires_on']=str(today+datetime.timedelta(days=30));s['setupPassed']=True;save();print('Fresh isolated fixture prepared')
 else:
  for actor,user in s['users'].items():auth('admin/users/'+user,{'ban_duration':'876000h'},method='PUT',admin=True)
  ids=','.join(lit(user) for user in s['users'].values());org=lit(s['org']);site=lit(s['site'])
  r.sql('BEGIN; UPDATE public.employee_medical_access SET revoked_at=coalesce(revoked_at,clock_timestamp()),revocation_reason=\'Synthetic proof completed\' WHERE organization_id='+org+'; UPDATE public.operation_subject_access SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id='+org+'; UPDATE public.user_facility_access SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id='+org+'; UPDATE public.user_profiles SET is_active=false WHERE id IN('+ids+'); UPDATE public.staff SET deleted_at=clock_timestamp() WHERE organization_id='+org+'; UPDATE public.facilities SET deleted_at=clock_timestamp() WHERE organization_id='+org+'; UPDATE public.entities SET deleted_at=clock_timestamp() WHERE organization_id='+org+'; UPDATE public.organizations SET deleted_at=clock_timestamp() WHERE id='+org+'; COMMIT;')
  for user in s['users'].values():require(datetime.datetime.fromisoformat(auth('admin/users/'+user,method='GET',admin=True)['banned_until'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'Ban not verified')
  facts=json.loads(r.sql('SELECT json_build_object(\'inactive\',(SELECT count(*)=3 AND bool_and(NOT is_active) FROM public.user_profiles WHERE id IN('+ids+')),\'site_grants\',(SELECT count(*)=0 FROM public.user_facility_access WHERE organization_id='+org+' AND revoked_at IS NULL),\'medical_grants\',(SELECT count(*)=0 FROM public.employee_medical_access WHERE organization_id='+org+' AND revoked_at IS NULL),\'subject_grants\',(SELECT count(*)=0 FROM public.operation_subject_access WHERE organization_id='+org+' AND revoked_at IS NULL),\'sites_retired\',(SELECT count(*)=2 AND bool_and(deleted_at IS NOT NULL) FROM public.facilities WHERE organization_id='+org+'),\'org_retired\',(SELECT deleted_at IS NOT NULL FROM public.organizations WHERE id='+org+'))'))
  require(all(facts.values()),'Incomplete cleanup');s['cleaned']=True;save();(OUT/'cleanup.json').write_text(json.dumps({'result':'PASS','facts':facts,'bansVerified':True,'storageEvidenceAndAuditRetained':True,'ownedListenerClosed':False},indent=2)+'\n')
if __name__=='__main__':main()
