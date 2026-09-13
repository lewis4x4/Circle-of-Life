#!/usr/bin/env python3
"""Reviewed fresh Finance fixture HTTP only; no network at import."""
import argparse,base64,datetime,hashlib,json,os,pathlib,urllib.request,urllib.error,urllib.parse
from guarded import Runtime,OUT,REF,NoRedirect,require
PRIVATE=pathlib.Path.home()/'.config/haven-staging/col158-fixture.json'
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['exercise','deny']);p.add_argument('--ready',required=True);args=p.parse_args()
 r=Runtime(args.ready,stage=True);r.identify();require(PRIVATE.stat().st_mode&0o077==0,'Private fixture required');state=json.loads(PRIVATE.read_text())
 require(state['target']==REF and state['sourceSha']==r.ready['sourceSha'] and state['run'].startswith('col158-') and not state.get('cleaned'),'Fresh exact-source fixture required')
 def save():
  fd=os.open(PRIVATE,os.O_WRONLY|os.O_TRUNC,0o600)
  with os.fdopen(fd,'w') as f:json.dump(state,f,indent=2)
 def checkpoint(key,fn):
  if key in state:return state[key]
  require(state.get('pending')!=key,'Uncertain native operation; inspect exact recorded IDs before retry: '+key)
  state['pending']=key;save();value=fn();state[key]=value;state.pop('pending');save();return value
 def request(url,actor='owner',body=None,method='GET',binary=False,expected=(200,),signed=False,raw_response=False):
  r.verify();
  if method not in ['GET','HEAD']:r.identify()
  parsed=urllib.parse.urlparse(url)
  require((parsed.scheme,parsed.netloc) in [('http','127.0.0.1:4358'),('https',REF+'.supabase.co')],'Unexpected credential-bearing target')
  headers={};data=body if binary else json.dumps(body).encode() if body is not None else None
  if not signed:
   session=state['sessions'][actor];require(session['expires_at']>datetime.datetime.now().timestamp(),'Expired fixture session')
   if parsed.netloc=='127.0.0.1:4358':
    raw='base64-'+base64.urlsafe_b64encode(json.dumps(session,separators=(',',':')).encode()).decode().rstrip('=');name='sb-'+REF+'-auth-token'
    headers['Cookie']='; '.join(name+('.'+str(i//3180) if len(raw)>3180 else '')+'='+raw[i:i+3180] for i in range(0,len(raw),3180))
   else:headers.update(apikey=r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],Authorization='Bearer '+session['access_token'])
  if body is not None:headers['Content-Type']='application/pdf' if binary else 'application/json'
  try:
   with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url,data=data,method=method,headers=headers),timeout=90) as response:status=response.status;payload=response.read()
  except urllib.error.HTTPError as e:status=e.code;payload=e.read()
  require(status in expected,'Unexpected HTTP'+str(status)+' at '+parsed.path)
  return (status,payload) if signed or raw_response else (status,json.loads(payload))
 def api(path='',body=None,method='GET',actor='owner',expected=(200,)):
  return request(r.app+'/api/admin/operations/provider-reports'+path,actor,body,method,expected=expected)[1]
 def snapshot(task=None):return api('?task_id='+(task or state['task']))
 def current(task=None):return next(e for e in snapshot(task)['expectations'] if e['id']==state['expectation'])
 def command(label,action,payload,task=None):
  target=task or state['task'];e=current(target)
  body={'action':action,'task_id':target,'request_key':state['run']+'-'+label,'expectation_id':e['id'],'expected_revision':e['revision'],**payload}
  return checkpoint(label,lambda:api(body=body,method='POST'))
 def lit(v):return "'"+str(v).replace("'","''")+"'"
 def native_hashes():
  return {table:r.sql('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),\'[]\'::jsonb)::text) FROM public.'+table+' x WHERE resident_id='+lit(state['resident'])) for table in ['resident_documents','resident_document_versions','resident_contacts']}
 if args.action=='exercise':
  require(state.get('browserIntakePassed'),'Real browser contact/upload prerequisite missing')
  version=state['browser_version'];contact=state['browser_contact']
  before=native_hashes()
  expectation=checkpoint('expectation_created',lambda:api(body={'action':'create','task_id':state['task'],'request_key':state['run']+'-expectation','contact_id':contact,'document_type':'support_plan','expected_version':'Synthetic plan One','service_on':state['service_on'],'service_provenance':'Operator-observed synthetic service; no provider confirmation'},method='POST'))
  state['expectation']=expectation['expectations'][0]['id'];save();e=current();require(e['current_version_id'] is None and not e['overdue'] and e['due_state']=='unknown' and e['service_at'] is None,'Service falsely completed report or dateprecision')
  command('receipt_one','attach_receipt',{'version_id':version,'received_on':state['today'],'receipt_provenance':'Native synthetic PDF received and transport verified'})
  for role,label in [('caseworker','Synthetic Caseworker Example'),('resident','Synthetic Resident Example'),('administrator','Synthetic Administrator Example')]:command('signature_'+role,'signature_observation',{'version_id':version,'signer_role':role,'signer_label':label,'page':2,'source_provenance':'Synthetic example mark on readable PDF page2; signed date not provided'})
  command('due','set_due',{'source_version_id':version,'due_on':state['due_on'],'approved_on':state['today'],'effective_date':state['effective_date'],'approval_reference':'Synthetic documented due approval on native PDF page1','approver_label':'Synthetic Owner'})
  e=current();require(e['due_state']=='documented_approval_pending_effective' and not e['overdue'],'Future-effective due rule appears active')
  command('review_one','review',{'version_id':version,'result':'reviewed','findings':'Synthetic operator administrative review; no clinical approval'})
  second=snapshot(state['second_task']);e=next(x for x in second['expectations'] if x['id']==state['expectation']);require(e['current_version_id']==version and e['review_state']=='not_reviewed' and e['last_review']['task_id']==state['task'],'Monthly reuse lost or inherited review')
  command('review_second','review',{'version_id':version,'result':'reviewed','findings':'Separate current task review of existing native version'},state['second_task'])
  require(native_hashes()==before,'Report events/monthly review mutated native documents or contacts')
  payload=pathlib.Path(state['pdf_Two']).read_bytes();sha=hashlib.sha256(payload).hexdigest();require(sha==state['pdf_hashes']['Two'],'Generated PDF changed')
  prepared=checkpoint('prepare_two',lambda:api('/documents',{'task_id':state['task'],'request_key':state['run']+'-prepare-two','document_type':'support_plan','title':'Synthetic report Two','declared_mime':'application/pdf','declared_size_bytes':len(payload),'declared_sha256':sha,'supersedes_version_id':version},'POST'))['version']
  require(prepared['object_path']==state['site']+'/'+prepared['document_id']+'/'+prepared['id']+'/source','Unbound native path')
  checkpoint('upload_two',lambda:request(r.base+'/storage/v1/object/resident-documents/'+prepared['object_path'],'owner',payload,'POST',binary=True,expected=(200,201))[0])
  finalized=checkpoint('finalize_two',lambda:api('/documents/'+prepared['id']+'/finalize',{'task_id':state['task'],'request_key':state['run']+'-finalize-two','expected_revision':prepared['revision']},'POST'))['version'];require(finalized['checksum_verified'],'Unverified nativeversion')
  state['version_two']=finalized['id'];save()
  command('receipt_two','attach_receipt',{'version_id':finalized['id'],'received_on':state['today'],'receipt_provenance':'Replacement synthetic native PDF'})
  e=current();observations=[x for x in e['events'] if x['kind']=='signature_observation'];require(e['review_state']=='not_reviewed' and len(observations)==3 and all(x['details']['version_id']==version for x in observations),'Supersession inherited review or signatures')
  _,downloaded=request(r.app+'/api/admin/operations/provider-reports/documents/'+finalized['id']+'/download?task_id='+state['second_task'],raw_response=True)
  require(hashlib.sha256(downloaded).hexdigest()==sha,'Streamed native document bytes differ')
  state['httpProofPassed']=True;save();(OUT/'http-proof.json').write_text(json.dumps({'result':'PASS','sourceSha':state['sourceSha'],'serviceWithoutReportOutstanding':True,'dateOnlyNoClock':True,'signatureRolesSeparatelyObserved':3,'signatureDates':'unknown','futureEffectiveDueNotOverdue':True,'monthlyReuseOneNativeFile':True,'supersessionNoInheritedReviewOrSignatures':True,'nativeHashesUnchangedByReportEvents':True},indent=2)+'\n')
 else:
  require(state.get('httpProofPassed'),'Positive report proof missing')
  _,workspace=request(r.app+'/api/admin/operations/workspace?'+urllib.parse.urlencode({'facility_id':state['site'],'view':'today','mine':'0'}),'limited')
  require(not workspace['partial'] and any(item.get('occurrence',{}).get('id')==state['task'] for group in workspace['groups'].values() if isinstance(group,list) for item in group),'HFO-only positive task read missing')
  status,_=request(r.app+'/api/admin/operations/provider-reports?task_id='+state['task'],'limited',expected=(403,404));cross,_=request(r.app+'/api/admin/operations/provider-reports/documents/'+state['version_two']+'/download?task_id='+state['other_task'],expected=(403,404))
  manager=api('?task_id='+state['task'],actor='manager');require(not manager['can_intake'],'Readonly manager gained native intake')
  denied,_=request(r.app+'/api/admin/operations/provider-reports/contacts','manager',{'task_id':state['task'],'request_key':state['run']+'-denied-contact','name':'Forbidden synthetic','contact_type':'other'},'POST',expected=(403,404))
  # Finalized bytes are immutable even for their original uploader.
  v=next(v for v in snapshot()['versions'] if v['id']==state['version_two']);tamper=pathlib.Path(state['pdf_One']).read_bytes()
  tamper_status,tamper_body=request(r.base+'/storage/v1/object/resident-documents/'+v['object_path'],'owner',tamper,'PUT',binary=True,expected=(400,401,403))
  require(tamper_status in (401,403) or str(tamper_body.get('statusCode')) in ('401','403') or 'row-level security' in json.dumps(tamper_body).lower(),'Overwrite failure was not authorization denial')
  _,unchanged=request(r.app+'/api/admin/operations/provider-reports/documents/'+v['id']+'/download?task_id='+state['task'],raw_response=True)
  require(hashlib.sha256(unchanged).hexdigest()==state['pdf_hashes']['Two'],'Denied overwrite changed native bytes')
  def relogin(actor):
   _,session=request(r.base+'/auth/v1/token?grant_type=password',actor,{'email':state['run']+'-'+actor+'@example.invalid','password':state['passwords'][actor]},'POST');state['sessions'][actor]=session;save()
  checkpoint('manager_hfo_revoked',lambda:r.sql('UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE user_id='+lit(state['users']['manager'])+' AND facility_id='+lit(state['site'])+' AND scope=\'resident\' AND revoked_at IS NULL'))
  relogin('manager')
  _,native_rows=request(r.base+'/rest/v1/resident_documents?'+urllib.parse.urlencode({'select':'id','id':'eq.'+v['native_document_id']}),'manager')
  require(any(row['id']==v['native_document_id'] for row in native_rows),'Native-only positive control missing')
  native_only_status,_=request(r.app+'/api/admin/operations/provider-reports?task_id='+state['task'],'manager',expected=(403,404))
  checkpoint('owner_native_revoked',lambda:r.sql('UPDATE public.user_profiles SET app_role=\'maintenance_role\' WHERE id='+lit(state['users']['owner'])+' AND organization_id='+lit(state['org'])))
  relogin('owner')
  _,hfo_after=request(r.app+'/api/admin/operations/workspace?'+urllib.parse.urlencode({'facility_id':state['site'],'view':'today','mine':'0'}))
  require(any(item.get('occurrence',{}).get('id')==state['task'] for group in hfo_after['groups'].values() if isinstance(group,list) for item in group),'HFO positive after native revocation missing')
  native_revoked,_=request(r.app+'/api/admin/operations/provider-reports/documents/'+state['version_two']+'/download?task_id='+state['task'],expected=(403,404))
  checkpoint('scope_revoked',lambda:r.sql('UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE user_id='+lit(state['users']['owner'])+' AND facility_id='+lit(state['site'])+' AND scope=\'resident\' AND revoked_at IS NULL'))
  revoked,_=request(r.app+'/api/admin/operations/provider-reports/documents/'+state['version_two']+'/download?task_id='+state['task'],expected=(401,403,404))
  (OUT/'denial-proof.json').write_text(json.dumps({'result':'PASS','hfoOnlyTaskPositive':True,'nativeDeniedStatus':status,'crossPatientDownloadDenied':cross,'readonlyManagerIntakeDenied':denied,'revokedHfoDownloadDenied':revoked,'finalizedOverwriteDeniedStatus':tamper_status,'bytesUnchangedAfterDeniedOverwrite':True,'nativeOnlyPositiveThenHfoDenied':native_only_status,'hfoPositiveAfterNativeRevocation':True,'nativeRevokedDownloadDenied':native_revoked},indent=2)+'\n')
if __name__=='__main__':main()
