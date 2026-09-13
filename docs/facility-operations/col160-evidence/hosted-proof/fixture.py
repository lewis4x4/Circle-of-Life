#!/usr/bin/env python3
"""Isolated synthetic corporate fixture; network is confined to guarded main."""
import argparse,base64,datetime,json,os,pathlib,secrets,subprocess,urllib.request,uuid
from guarded import Runtime,ROOT,OUT,REF,NoRedirect,require
PRIVATE=pathlib.Path.home()/'.config/haven-staging/col160-fixture.json'
SCRATCH=pathlib.Path.home()/'.hermes/tmp/agent-runs/haven-col160-closeout-01a09c89'
def lit(value):return "'"+str(value).replace("'","''")+"'"
def save(s):
 fd=os.open(PRIVATE,os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:json.dump(s,f,indent=2)
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['setup','serve','cleanup','refresh']);p.add_argument('--ready',required=True);args=p.parse_args();r=Runtime(args.ready,stage=True);r.identify()
 if args.action=='serve':
  check=subprocess.run(['lsof','-nP','-iTCP:4360','-sTCP:LISTEN'],capture_output=True,text=True);require(check.returncode==1 and not check.stdout,'Owned port4360 must be absent')
  require(not (SCRATCH/'listener.json').exists(),'Existing listener provenance must be resolved')
  (SCRATCH/'listener.json').write_text(json.dumps({'pid':os.getpid(),'cwd':str(ROOT),'port':4360,'sourceSha':r.ready['sourceSha']},indent=2)+'\n');(SCRATCH/'listener.json').chmod(0o600)
  os.chdir(ROOT);os.execvpe('npm',['npm','run','dev','--','--hostname','127.0.0.1','--port','4360'],{**os.environ,**r.env})
 if PRIVATE.exists():require(PRIVATE.stat().st_mode&0o077==0,'Private state required')
 s=json.loads(PRIVATE.read_text()) if PRIVATE.exists() else {'run':'col160-'+secrets.token_hex(6),'target':REF,'sourceSha':r.ready['sourceSha'],**{k:str(uuid.uuid4()) for k in ['org','entity','site','other_site','resident','other_resident','subject','other_subject','resident_subject','other_resident_subject','census','other_census','account']},'users':{},'passwords':{},'sessions':{},'activities':{},'tasks':{}}
 require(s['target']==REF and s['sourceSha']==r.ready['sourceSha'] and s['run'].startswith('col160-') and not s.get('cleaned'),'Wrong/retired fixture')
 def checkpoint(key,fn):
  if key in s:return s[key]
  require(not s.get('pending'),'Uncertain previous mutation requires exact readback: '+str(s.get('pending')));s['pending']=key;save(s);value=fn();s[key]=value;s.pop('pending');save(s);return value
 def auth(path,body=None,method='POST',admin=False):
  r.verify();r.identify();key=r.env['SUPABASE_SERVICE_ROLE_KEY'] if admin else r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
  with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(r.base+'/auth/v1/'+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}),timeout=60) as response:return json.load(response)
 def sql_user(query):
  claims=json.loads(base64.urlsafe_b64decode(s['sessions']['owner']['access_token'].split('.')[1]+'=='));require(claims.get('session_id') and claims.get('auth_claim_version') is not None,'Actual hooked session required')
  return json.loads(r.sql('BEGIN; SET LOCAL ROLE authenticated; SELECT set_config(\'request.jwt.claims\','+lit(json.dumps(claims))+',true); '+query+'; COMMIT;').splitlines()[-1])
 save(s)
 if args.action in ['setup','refresh']:
  if args.action=='setup':
   for actor in ['owner','manager','limited']:
    if actor not in s['users']:
     s['passwords'][actor]=secrets.token_urlsafe(30);save(s);user=checkpoint('auth_'+actor,lambda actor=actor:auth('admin/users',{'email':s['run']+'-'+actor+'@example.invalid','password':s['passwords'][actor],'email_confirm':True,'user_metadata':{'full_name':'COL160 Synthetic '+actor}},admin=True));s['users'][actor]=user['id'];save(s)
   if 'period' not in s:
    today=datetime.date.fromisoformat(r.sql("SELECT (now() AT TIME ZONE 'America/New_York')::date"));start=today-datetime.timedelta(days=40);start-=datetime.timedelta(days=start.weekday());s['today']=str(today);s['period']={'period_start':str(start),'period_end':str(start+datetime.timedelta(days=2))};save(s)
   for key in ['hfo-al-m09-01','hfo-al-m09-02','hfo-al-m09-03','hfo-al-q01-01','hfo-al-c08-01']:s['activities'].setdefault(key,str(uuid.uuid4()))
   save(s)
   def rows():
    q=f"BEGIN; INSERT INTO public.organizations(id,name) VALUES({lit(s['org'])},{lit(s['run'])}); INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES({lit(s['entity'])},{lit(s['org'])},{lit(s['run'])},'llc');"
    for site in ['site','other_site']:q+=f"INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds,timezone) VALUES({lit(s[site])},{lit(s['org'])},{lit(s['entity'])},{lit(s['run']+' '+site)},'Synthetic','Test','00000',20,'America/New_York');"
    for actor,role in [('owner','owner'),('manager','manager'),('limited','maintenance_role')]:
     q+=f"INSERT INTO public.user_profiles(id,email,full_name,organization_id,app_role,is_active) VALUES({lit(s['users'][actor])},{lit(s['run']+'-'+actor+'@example.invalid')},{lit('COL160 Synthetic '+actor)},{lit(s['org'])},{lit(role)},true);"
     for site in ['site','other_site']:
      q+=f"INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES({lit(s['users'][actor])},{lit(s[site])},{lit(s['org'])},{lit(s['users']['owner'])});"
      if actor!='limited':
       for scope in ['financial','resident']:q+=f"INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) VALUES({lit(s['org'])},{lit(s[site])},{lit(s['users'][actor])},{lit(scope)},{lit(s['users']['owner'])},'Synthetic COL160 current scope',true);"
    for resident,subject in [('resident','resident_subject'),('other_resident','other_resident_subject')]:q+=f"INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender) VALUES({lit(s[resident])},{lit(s['org'])},{lit(s['site'])},'COL160',{lit(resident)},'1940-01-01','female'); INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) VALUES({lit(s[subject])},{lit(s['org'])},{lit(s['site'])},'resident',{lit(s[resident])});"
    for site,subject,census in [('site','subject','census'),('other_site','other_subject','other_census')]:q+=f"INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind) VALUES({lit(s[subject])},{lit(s['org'])},{lit(s[site])},'facility'); INSERT INTO public.census_daily_log(id,facility_id,organization_id,log_date,total_licensed_beds,occupied_beds,available_beds,hold_beds,maintenance_beds,occupancy_rate) VALUES({lit(s[census])},{lit(s[site])},{lit(s['org'])},{lit(s['period']['period_start'])},20,10,10,0,0,0.5);"
    for key,activity in s['activities'].items():
     if key=='hfo-al-m09-02':continue
     subject='unconfirmed' if key=='hfo-al-m09-02' else 'resident' if key in ['hfo-al-q01-01','hfo-al-c08-01'] else 'facility'
     q+=f"INSERT INTO public.operation_activities(id,organization_id,activity_key,name,activity_kind,subject_kind,origin) VALUES({lit(activity)},{lit(s['org'])},{lit(key)},{lit('COL160 Synthetic '+key)},'linked_domain_action',{lit(subject)},'admin_log');"
    q+=f"INSERT INTO public.resident_trust_accounts(id,organization_id,facility_id,resident_id,balance_cents) VALUES({lit(s['account'])},{lit(s['org'])},{lit(s['site'])},{lit(s['resident'])},0); COMMIT;";return r.sql(q)
   checkpoint('rows',rows)
  for actor in s['users']:s['sessions'][actor]=auth('token?grant_type=password',{'email':s['run']+'-'+actor+'@example.invalid','password':s['passwords'][actor]});save(s)
  if args.action=='refresh':print('Existing synthetic actor sessions refreshed');return
  for key,activity in s['activities'].items():
   if key=='hfo-al-m09-02':continue
   subject='resident' if key in ['hfo-al-q01-01','hfo-al-c08-01'] else 'facility'
   rule=checkpoint('rule_'+key,lambda key=key,activity=activity,subject=subject:sql_user('SELECT public.save_operation_requirement_draft_review('+lit(activity)+','+lit(json.dumps({'title':'COL160 Synthetic '+key,'wording':'Explicit synthetic evidence only; policy remains unknown','allowed_recorder_roles':['owner'],'subject_kind':subject}))+'::jsonb)'))
   checkpoint('published_'+key,lambda rule=rule:sql_user('SELECT public.publish_operation_requirement_review('+lit(rule['id'])+',clock_timestamp())'))
   for site in (['site','other_site'] if subject=='facility' else ['site']):
    draft=checkpoint('site_'+key+site,lambda activity=activity,site=site,rule=rule:sql_user('SELECT public.save_operation_facility_requirement_draft_review('+lit(activity)+','+lit(s[site])+','+lit(json.dumps({'applicability':'applicable','requirement_version_id':rule['id'],'schedule_status':'needs_confirmation'}))+'::jsonb)'))
    checkpoint('site_published_'+key+site,lambda draft=draft:sql_user('SELECT public.publish_operation_facility_requirement_review('+lit(draft['id'])+',clock_timestamp())'))
    subjects=['resident_subject','other_resident_subject'] if subject=='resident' else ['subject' if site=='site' else 'other_subject']
    for sub in subjects:
     name=key+':'+sub;task=checkpoint('task_'+name,lambda name=name,activity=activity,site=site,sub=sub:sql_user('SELECT public.create_operation_manual_occurrence_review('+lit(activity)+','+lit(s[site])+','+lit(s[sub])+','+lit(s['run']+'-'+name)+",'{}'::jsonb)"));s['tasks'][name]=task['id'];save(s)
  s['task']=s['tasks']['hfo-al-m09-01:subject'];s['other_task']=s['tasks']['hfo-al-m09-01:other_subject'];save(s)
  issue=checkpoint('issue',lambda:sql_user('SELECT public.report_operation_issue_review('+lit(s['run']+'-missing-issue')+','+lit(json.dumps({'task_instance_id':s['task'],'kind':'problem','summary':'Synthetic corporate follow-up','severity':'normal'}))+'::jsonb)'))
  assigned=checkpoint('issue_assigned',lambda:sql_user('SELECT public.assign_operation_issue_review('+lit(issue['issue']['id'])+','+lit(s['run']+'-assign')+','+lit(issue['issue']['issue_revision'])+','+lit(json.dumps({'owner_user_id':s['users']['manager'],'note':'Synthetic owner for packet next action'}))+'::jsonb)'));s['issue_id']=assigned['issue']['id'];s['setupPassed']=True;save(s);print('Fresh isolated corporate fixture prepared')
 else:
  for user in s['users'].values():auth('admin/users/'+user,{'ban_duration':'876000h'},method='PUT',admin=True)
  ids=','.join(lit(user) for user in s['users'].values());org=lit(s['org'])
  r.sql('BEGIN; UPDATE public.operation_subject_access SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id='+org+'; UPDATE public.user_facility_access SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id='+org+'; UPDATE public.user_profiles SET is_active=false WHERE id IN('+ids+'); UPDATE public.facilities SET deleted_at=clock_timestamp() WHERE organization_id='+org+'; UPDATE public.entities SET deleted_at=clock_timestamp() WHERE organization_id='+org+'; UPDATE public.organizations SET deleted_at=clock_timestamp() WHERE id='+org+'; COMMIT;')
  for user in s['users'].values():require(datetime.datetime.fromisoformat(auth('admin/users/'+user,method='GET',admin=True)['banned_until'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'Ban not verified')
  facts=json.loads(r.sql("SELECT json_build_object('inactive',(SELECT count(*)=3 AND bool_and(NOT is_active) FROM public.user_profiles WHERE id IN("+ids+")),'site_grants',(SELECT count(*)=0 FROM public.user_facility_access WHERE organization_id="+org+" AND revoked_at IS NULL),'subject_grants',(SELECT count(*)=0 FROM public.operation_subject_access WHERE organization_id="+org+" AND revoked_at IS NULL),'sites_retired',(SELECT count(*)=2 AND bool_and(deleted_at IS NOT NULL) FROM public.facilities WHERE organization_id="+org+"),'entity_retired',(SELECT deleted_at IS NOT NULL FROM public.entities WHERE id="+lit(s['entity'])+"),'org_retired',(SELECT deleted_at IS NOT NULL FROM public.organizations WHERE id="+org+"))"))
  require(all(facts.values()),'Incomplete retirement');s['cleaned']=True;save(s);(OUT/'cleanup.json').write_text(json.dumps({'result':'PASS','sourceSha':r.ready['sourceSha'],'facts':facts,'bansVerified':True,'syntheticSourceAndAuditRetained':True,'ownedListenerClosed':False},indent=2)+'\n')
if __name__=='__main__':main()
