#!/usr/bin/env python3
"""Actual authenticated HTTP corporate workflow; isolated synthetic data only."""
import argparse,base64,datetime,hashlib,json,urllib.request,urllib.error,urllib.parse,uuid
from guarded import Runtime,OUT,REF,NoRedirect,require
from fixture import PRIVATE,save,lit

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['exercise','deny']);p.add_argument('--ready',required=True);args=p.parse_args();r=Runtime(args.ready,stage=True);r.identify();require(PRIVATE.stat().st_mode&0o077==0,'Private fixture required');s=json.loads(PRIVATE.read_text());require(s['target']==REF and s['sourceSha']==r.ready['sourceSha'] and s.get('setupPassed') and not s.get('cleaned'),'Fresh exact fixture required')
 trace=[]
 def checkpoint(key,fn):
  if key in s:return s[key]
  require(not s.get('pending'),'Uncertain mutation requires exact readback: '+str(s.get('pending')));s['pending']=key;save(s);value=fn();s[key]=value;s.pop('pending');save(s);return value
 def request(path,body=None,actor='owner',expected=(200,),rpc=False):
  r.verify()
  if body is not None:r.identify()
  session=s['sessions'][actor];require(session['expires_at']>datetime.datetime.now().timestamp(),'Expired fixture session');headers={'Content-Type':'application/json'}
  if rpc:headers.update(apikey=r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],Authorization='Bearer '+session['access_token']);url=r.base+'/rest/v1/rpc/'+path
  else:
   raw='base64-'+base64.urlsafe_b64encode(json.dumps(session,separators=(',',':')).encode()).decode().rstrip('=');name='sb-'+REF+'-auth-token';headers['Cookie']='; '.join(name+('.'+str(i//3180) if len(raw)>3180 else '')+'='+raw[i:i+3180] for i in range(0,len(raw),3180));url=r.app+path
  try:
   with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url,data=json.dumps(body,separators=(',',':')).encode() if body is not None else None,headers=headers),timeout=90) as response:status=response.status;payload=response.read();cache=response.headers.get('Cache-Control')
  except urllib.error.HTTPError as error:status=error.code;payload=error.read();cache=error.headers.get('Cache-Control')
  trace.append({'path':path,'actor':actor,'method':'POST' if body is not None else 'GET','status':status});require(status in expected,'Unexpected HTTP '+str(status)+' at '+path);value=json.loads(payload)
  if not rpc and status==200:require(cache=='no-store','Successful protected API must be no-store')
  return value
 base='/api/admin/operations/corporate-deliverables'
 def snapshot(task=None,actor='owner'):return request(base+'?'+urllib.parse.urlencode({'task_id':task or s['task'],**s['period']}),actor=actor)
 def detail(value,site=None):return next(row['expectation'] for row in value['sites'] if row['facility_id']==(site or s['site']))
 def post(key,action,payload,task=None,expected=(200,)):
  body={'task_id':task or s['task'],'request_key':s['run']+'-'+key,'action':action,**payload}
  return request(base,body,expected=expected)
 def command(key,action,payload,task=None):
  def perform():
   d=detail(snapshot(task));return post(key,action,{'expectation_id':d['id'],'expected_revision':d['revision'],**payload},task)
  return checkpoint('http_'+key,perform)
 def meeting(key,task=None):
  value=snapshot(task);return post(key,'capture_meeting',{**s['period'],'coverage_revision':value['coverage']['revision'],'presented_at':None,'presented_on':None,'presentation_provenance':None},task)
 def sql_user(query):
  claims=json.loads(base64.urlsafe_b64decode(s['sessions']['owner']['access_token'].split('.')[1]+'=='));return r.sql('BEGIN; SET LOCAL ROLE authenticated; SELECT set_config(\'request.jwt.claims\','+lit(json.dumps(claims))+',true); '+query+'; COMMIT;')
 def native_hash():return r.sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb)::text) FROM public.census_daily_log x WHERE organization_id="+lit(s['org']))
 if args.action=='exercise':
  require(not s.get('httpProofPassed'),'HTTP workflow already completed; do not repeat')
  unresolved=request(base+'/unresolved');require(len(unresolved['components'])==1 and unresolved['components'][0]['component_key']=='hfo-al-m09-02' and not unresolved['components'][0]['can_register'] and not unresolved['components'][0]['can_prepare'],'FPC taskless unknown boundary')
  baseline=native_hash();registration={**s['period'],'period_provenance':'Synthetic reviewed two-site close roster','expected_facility_ids':[s['site'],s['other_site']]}
  initial=checkpoint('http_registered',lambda:post('register','register',registration));require(detail(initial)['current_state']=='expected' and any(row['facility_id']==s['other_site'] and row['status']=='missing' for row in initial['sites']),'Expected missing site absent')
  missing_meeting=checkpoint('http_missing_meeting',lambda:meeting('missing-meeting'));require(any(row['status']=='missing' for row in missing_meeting['meetings'][0]['snapshot']['sites']),'Missing meeting member omitted')
  repeated=post('register','register',registration);require(detail(repeated)['id']==detail(initial)['id'],'Replay duplicated stable identity')
  post('register','register',{**registration,'period_provenance':'Changed key body'},expected=(409,))
  command('missing-followup','link_follow_up',{'problem_state':'missing','issue_id':s['issue_id']});require(detail(snapshot())['follow_up']['owner_current'],'Missing follow-up owner absent')
  second=checkpoint('http_second_register',lambda:post('register-second','register',registration,s['other_task']));require(detail(second,s['other_site'])['id']!=detail(initial)['id'],'Site identities collapsed')
  unknown=command('unknown-config','configure',{'recipient_label':None,'backup_label':None,'due_on':None,'configuration_provenance':'Synthetic no confirmed policy','due_provenance':None});require(detail(unknown)['due_state']=='unknown','Unknown deadline inferred')
  unchanged=detail(snapshot())
  for label,bad in [('blank','   '),('oversize','x'*1001)]:
   denied=request('corporate_deliverable_command',{'p_task':s['task'],'p_request_key':s['run']+'-direct-'+label,'p_action':'configure','p_payload':{'expectation_id':unchanged['id'],'expected_revision':unchanged['revision'],'recipient_label':None,'backup_label':None,'due_on':s['period']['period_end'],'configuration_provenance':'Synthetic direct SQL boundary','due_provenance':bad}},expected=(400,),rpc=True);require(denied.get('code')=='22023','Direct RPC provenance refusal is not deterministic')
  require(detail(snapshot())['revision']==unchanged['revision'],'Rejected direct RPC changed state')
  command('documented-due','configure',{'recipient_label':None,'backup_label':None,'due_on':s['period']['period_end'],'configuration_provenance':'Synthetic explicit prior due rule','due_provenance':'Synthetic controller due date for isolated fixture'})
  late=command('late-followup','link_follow_up',{'problem_state':'late','issue_id':s['issue_id']});follow=detail(late)['follow_up'];require(detail(late)['due_state']=='documented' and follow['id']==s['issue_id'] and follow['owner_current'] and bool(follow['next_action']),'Documented late packet lacks current owner/next action');late_event=next(e for e in reversed(detail(late)['events']) if e['kind']=='follow_up_linked');require(late_event['details']['problem_state']=='late' and late_event['details']['next_action']=='Owner to follow the documented overdue packet','Late event loses captured next action')
  a=command('prepare-a','prepare',{'source_family':'census'});require(detail(a)['current_state']=='prepared','Preparation inferred receipt');first=detail(a)['current_version_id']
  same=command('prepare-same','prepare',{'source_family':'census'});require(detail(same)['current_version_id']==first,'Same source duplicated version');require(native_hash()==baseline,'Capture mutated native census')
  presentation=checkpoint('http_presentation',lambda:post('presentation','capture_meeting',{**s['period'],'coverage_revision':snapshot()['coverage']['revision'],'presented_at':None,'presented_on':s['period']['period_end'],'presentation_provenance':'Synthetic retrospective presentation evidence; exact date only'}));presented=next(m for m in presentation['meetings'] if m['presented_on'] is not None);require(presented['presented_on']==s['period']['period_end'] and presented['presented_at'] is None and presented['captured_at'][:10]!=presented['presented_on'],'Capture and presentation date axes conflated')
  before=checkpoint('http_meeting_before',lambda:meeting('before-correction'));meeting_bytes=json.dumps(before['meetings'],sort_keys=True)
  checkpoint('source_b',lambda:r.sql('UPDATE public.census_daily_log SET occupied_beds=11,available_beds=9,occupancy_rate=0.55 WHERE id='+lit(s['census'])+' AND organization_id='+lit(s['org'])))
  b=command('prepare-b','prepare',{'source_family':'census'});require(detail(b)['current_version_id']!=first,'Source correction ignored')
  checkpoint('source_a_again',lambda:r.sql('UPDATE public.census_daily_log SET occupied_beds=10,available_beds=10,occupancy_rate=0.5 WHERE id='+lit(s['census'])+' AND organization_id='+lit(s['org'])))
  restored=command('prepare-a-again','prepare',{'source_family':'census'});require(detail(restored)['versions'][0]['version']==3 and detail(restored)['current_version_id'] not in [first,detail(b)['current_version_id']],'A B A history collapsed');require(json.dumps(restored['meetings'],sort_keys=True)==meeting_bytes,'Old meeting changed');require(native_hash()==baseline,'Native source restoration mismatch')
  command('confirmed-config','configure',{'recipient_label':'Synthetic recipient','backup_label':'Synthetic backup','due_on':None,'configuration_provenance':'Synthetic explicit reviewer configuration','due_provenance':None})
  for kind in ['sent','received','accepted']:
   current=detail(snapshot());payload={'version_id':current['current_version_id'],'source_evidence':'Synthetic operator record; no transmission',kind+'_on':s['today'],**({'approver_label':'Synthetic approver'} if kind=='accepted' else {'channel':'Synthetic operator register'})};value=command(kind,kind,payload);require(detail(value)['current_state']==kind,'Lifecycle state lost');event=next(e for e in detail(value)['events'] if e['kind']==kind);require(event['details'].get('recording_kind')=='operator_recorded' and event['details'].get(kind+'_on')==s['today'] and not event['details'].get(kind+'_at'),'Operator/date precision lost')
  # A real native immutable Stand Up revision is prepared through its supported RPC.
  def standup():
   exported=request('stand_up_command',{'p_action':'export','p_payload':{'facility_id':s['site'],'week_start':s['period']['period_start']}},rpc=True)
   return request('stand_up_command',{'p_action':'save','p_payload':{'facility_id':s['site'],'week_start':s['period']['period_start'],'expected_version':0,'request_id':str(uuid.uuid4()),'values':{key:1 for key in exported['values']},'status':'ready','as_of':s['period']['period_end']+'T12:00:00-04:00','reason':'Synthetic COL160 captured revision'}},rpc=True)
  checkpoint('native_standup',standup);su=command('prepare-standup','prepare',{'source_family':'stand_up','stand_up_week_start':s['period']['period_start']});require(detail(su)['versions'][0]['source_family']=='stand_up','Native Stand Up capture absent')
  current=detail(su);command('standup-received','received',{'version_id':current['current_version_id'],'channel':'Synthetic register','source_evidence':'Synthetic receipt only','received_on':s['today']});rejected=command('rejected','rejected',{'version_id':current['current_version_id'],'channel':'Synthetic reviewer','source_evidence':'Synthetic rejection only','rejected_on':s['today'],'reason':'Synthetic discrepancy','issue_id':s['issue_id']});require(detail(rejected)['current_state']=='rejected' and detail(rejected)['follow_up']['owner_current'],'Rejected packet lost owner')
  # Exercise all other reachable mappings. Resident identity remains separate.
  registrations={}
  for label in ['hfo-al-m09-03:subject','hfo-al-q01-01:resident_subject','hfo-al-q01-01:other_resident_subject','hfo-al-c08-01:resident_subject']:
   task=s['tasks'][label];reg=checkpoint('http_register_'+label,lambda label=label,task=task:post('register-'+label,'register',{**s['period'],'period_provenance':'Synthetic per-subject expectation','expected_facility_ids':[s['site']]},task));registrations[label]=detail(reg)
   if label=='hfo-al-c08-01:resident_subject':
    contract=detail(reg);require(contract['mapping_state']=='unconfirmed','Contract source unknown lost');post('contract-unavailable','prepare',{'expectation_id':contract['id'],'expected_revision':contract['revision'],'source_family':'resident_document','native_version_id':str(uuid.uuid4())},task,expected=(400,));continue
   command('configure-'+label,'configure',{'recipient_label':'Synthetic confirmed recipient','backup_label':None,'due_on':None,'configuration_provenance':'Synthetic attributable recipient','due_provenance':None},task)
   command('prepare-'+label,'prepare',{'source_family':'trust'},task)
   checkpoint('http_meeting_'+label,lambda label=label,task=task:meeting('meeting-'+label,task))
  resident=s['tasks']['hfo-al-q01-01:resident_subject'];other=s['tasks']['hfo-al-q01-01:other_resident_subject'];one=snapshot(resident);two=snapshot(other);require(one['coverage']['id']!=two['coverage']['id'] and one['meetings'][0]['id']!=two['meetings'][0]['id'],'Resident coverage/history crossed')
  foreign=detail(one);post('wrong-resident','configure',{'expectation_id':foreign['id'],'expected_revision':foreign['revision'],'recipient_label':None,'backup_label':None,'due_on':None,'configuration_provenance':'Cross-resident refusal','due_provenance':None},other,expected=(404,))
  # More than50 actual events, through the actual command route, with independent cursors.
  for index in range(52):command('history-config-'+str(index),'configure',{'recipient_label':'Synthetic history '+str(index),'backup_label':None,'due_on':None,'configuration_provenance':'Synthetic pagination command '+str(index),'due_provenance':None})
  current=detail(snapshot());versions={v['id'] for v in current['versions']};events={e['id'] for e in current['events']};cursor=current['history_cursor'];pages=0
  require(cursor is not None and len(current['events'])==50,'Pagination threshold not reached')
  while cursor:
   page=request(base+'/history?'+urllib.parse.urlencode({'task_id':s['task'],'expectation_id':current['id'],**cursor}));pages+=1;require(not versions.intersection(v['id'] for v in page['versions']) and not events.intersection(e['id'] for e in page['events']),'Pagination duplicate');versions.update(v['id'] for v in page['versions']);events.update(e['id'] for e in page['events']);cursor=None if page['complete'] else {'before_version':page['next_before_version'],'before_sequence':page['next_before_sequence']};require(pages<20,'Pagination failed to exhaust')
  counts=json.loads(r.sql("SELECT json_build_object('versions',(SELECT count(*) FROM haven.corporate_submission_versions WHERE expectation_id="+lit(current['id'])+"),'events',(SELECT count(*) FROM haven.corporate_submission_events WHERE expectation_id="+lit(current['id'])+"))"));require(len(versions)==counts['versions'] and len(events)==counts['events'],'Pagination incomplete')
  s['httpProofPassed']=True;save(s);result={'result':'PASS','sourceSha':r.ready['sourceSha'],'target':REF,'cases':['stable requirement/replay/conflict','missing site and immutable meeting','unknown due and owned missing/late follow-up','direct RPC blank/oversize due provenance refusal','census A-B-A and preserved meeting','distinct operator lifecycle/date precision','actual native Stand Up','owned rejection','facility/resident trust','unconfirmed contract','cross-resident refusal','all history pages'],'pagination':{'pages':pages,**counts},'outboundProviderEmailFrontOfficeCalls':0,'trace':trace};(OUT/'http-proof.json').write_text(json.dumps(result,indent=2)+'\n')
 else:
  require(s.get('httpProofPassed') and s.get('browserProofPassed'),'Workflow/browser before permanent denials')
  limited=snapshot(actor='limited');require(limited['availability']=='unavailable' and all(row['expectation'] is None for row in limited['sites']),'HFO-only actor leaked finance detail')
  positive=snapshot();require(positive['availability']=='available','Positive current-authority control absent')
  checkpoint('financial_revoked',lambda:r.sql('UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE organization_id='+lit(s['org'])+' AND user_id='+lit(s['users']['owner'])+" AND scope='financial' AND revoked_at IS NULL"))
  denied=snapshot();require(denied['availability']=='unavailable' and not denied['coverage_complete'] and not denied['meetings'] and all(row['expectation'] is None for row in denied['sites']),'Current financial revocation leaked history')
  checkpoint('owner_inactive',lambda:r.sql('UPDATE public.user_profiles SET is_active=false WHERE id='+lit(s['users']['owner'])+' AND organization_id='+lit(s['org'])))
  request(base+'?'+urllib.parse.urlencode({'task_id':s['task'],**s['period']}),expected=(401,404))
  (OUT/'denial-proof.json').write_text(json.dumps({'result':'PASS','sourceSha':r.ready['sourceSha'],'cases':['HFO positive/native finance negative','current native revocation hides protected history','current actor inactive denied'],'trace':trace},indent=2)+'\n')
 print('Guarded corporate '+args.action+' PASS')
if __name__=='__main__':main()
