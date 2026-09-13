#!/usr/bin/env python3
"""Reviewed fresh Employee File fixture transport only; no network at import."""
import argparse,base64,datetime,hashlib,json,os,pathlib,urllib.request,urllib.error,urllib.parse
from guarded import Runtime,OUT,REF,NoRedirect,require
PRIVATE=pathlib.Path.home()/'.config/haven-staging/col156-fixture.json'
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['transport','reconcile','deny']);p.add_argument('--ready',required=True);args=p.parse_args()
 r=Runtime(args.ready,stage=True);r.identify();require(PRIVATE.stat().st_mode&0o077==0,'Private fixture required');state=json.loads(PRIVATE.read_text())
 require(state['target']==REF and state['sourceSha']==r.ready['sourceSha'] and state['run'].startswith('col156-') and not state.get('cleaned'),'Fresh exact-source fixture required')
 def save():
  fd=os.open(PRIVATE,os.O_WRONLY|os.O_TRUNC,0o600)
  with os.fdopen(fd,'w') as f:json.dump(state,f,indent=2)
 def checkpoint(key,fn):
  if key in state:return state[key]
  require(state.get('pending')!=key,'Uncertain native operation; inspect exact recorded IDs before retry: '+key)
  state['pending']=key;save();value=fn();state[key]=value;state.pop('pending');save();return value
 def request(url,actor='owner',body=None,method='GET',binary=False,expected=(200,),signed=False):
  r.verify();
  if method not in ['GET','HEAD']:r.identify()
  parsed=urllib.parse.urlparse(url)
  require((parsed.scheme,parsed.netloc) in [('http','127.0.0.1:4356'),('https',REF+'.supabase.co')],'Unexpected credential-bearing target')
  headers={};data=body if binary else json.dumps(body).encode() if body is not None else None
  if not signed:
   session=state['sessions'][actor];require(session['expires_at']>datetime.datetime.now().timestamp(),'Expired fixture session')
   if parsed.netloc=='127.0.0.1:4356':
    raw='base64-'+base64.urlsafe_b64encode(json.dumps(session,separators=(',',':')).encode()).decode().rstrip('=');name='sb-'+REF+'-auth-token'
    headers['Cookie']='; '.join(name+('.'+str(i//3180) if len(raw)>3180 else '')+'='+raw[i:i+3180] for i in range(0,len(raw),3180))
   else:headers.update(apikey=r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],Authorization='Bearer '+session['access_token'])
  if body is not None:headers['Content-Type']='application/pdf' if binary else 'application/json'
  try:
   with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url,data=data,method=method,headers=headers),timeout=90) as response:status=response.status;payload=response.read()
  except urllib.error.HTTPError as e:status=e.code;payload=e.read()
  require(status in expected,'Unexpected HTTP'+str(status)+' at '+parsed.path)
  return (status,payload) if signed else (status,json.loads(payload))
 def api(suffix='',actor='owner',body=None,method='GET',expected=(200,),staff=None):return request(r.app+'/api/admin/staff/'+(staff or state['staff'])+'/employee-file'+suffix,actor,body,method,expected=expected)
 def command(action,payload,actor='owner'):return api(actor=actor,body={'action':action,'payload':payload},method='POST')[1]['result']
 def download(record,actor):
  _,reply=api('/download?'+urllib.parse.urlencode({'record_id':record}),actor)
  url=reply['url'];parsed=urllib.parse.urlparse(url);require(parsed.netloc==REF+'.supabase.co' and parsed.path.startswith('/storage/v1/object/sign/'),'Unexpected signed download target')
  return request(url,signed=True)[1]
 if args.action=='transport':
  evidence=[]
  for category,bucket in [('personnel','employee-personnel'),('medical','employee-medical')]:
   # Synthetic PDF bytes only. No employee/patient content. Correct bytes are retained by Storage as proof.
   payload=(b'%PDF-1.4\n% COL156 synthetic '+category.encode()+b' proof\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n')
   record=checkpoint(category+'_submitted',lambda category=category:command('submit_record',{'id':state['record_ids'][category],'requirement_id':state['requirements'][category],'completed_on':state['completed_on'],'expires_on':state['expires_on'],'notes':'Synthetic transport evidence'},'employee'))
   record_id=record['id'];object_path=record_id+'/synthetic.pdf'
   wrong_bucket='employee-medical' if category=='personnel' else 'employee-personnel'
   denied_path=record_id+'/denied.pdf'
   def object_count(bucket,name):
    return r.sql("SELECT count(*) FROM storage.objects WHERE bucket_id='"+bucket+"' AND name='"+name+"'")
   require(object_count(wrong_bucket,denied_path)=='0','Forbidden test object already exists')
   denied_status,denied_body=request(r.base+'/storage/v1/object/'+wrong_bucket+'/'+denied_path,'employee',payload,'POST',binary=True,expected=(400,401,403))
   require(denied_status in (401,403) or str(denied_body.get('statusCode')) in ('401','403') or 'row-level security' in json.dumps(denied_body).lower(),'Wrong-bucket failure was not authorization denial')
   wrong_bucket_status=denied_status
   no_grant_status=None
   require(object_count(wrong_bucket,denied_path)=='0','Wrong-bucket upload created object')
   if category=='medical':
    require(object_count(bucket,denied_path)=='0','Medical denial object already exists')
    denied_status,denied_body=request(r.base+'/storage/v1/object/'+bucket+'/'+denied_path,'manager',payload,'POST',binary=True,expected=(400,401,403))
    require(denied_status in (401,403) or str(denied_body.get('statusCode')) in ('401','403') or 'row-level security' in json.dumps(denied_body).lower(),'Medical upload failure was not authorization denial')
    no_grant_status=denied_status
    require(object_count(bucket,denied_path)=='0','No-medical-grant upload created object')
   checkpoint(category+'_uploaded',lambda:request(r.base+'/storage/v1/object/'+bucket+'/'+object_path,'employee',payload,'POST',binary=True,expected=(200,201))[0])
   checkpoint(category+'_attached',lambda:command('attach_record',{'id':record_id,'storage_path':object_path},'employee'))
   checkpoint(category+'_employee_signed',lambda:command('sign_record',{'id':record_id,'functional_role':'employee','signature_name':'COL156 Synthetic Employee'},'employee'))
   checkpoint(category+'_administrator_signed',lambda:command('sign_record',{'id':record_id,'functional_role':'administrator','signature_name':'COL156 Synthetic Reviewer'}))
   checkpoint(category+'_reviewed',lambda:command('review_record',{'id':record_id,'status':'verified','review_note':'Synthetic evidence byte transport and signatures verified'}))
   actual=download(record_id,'owner');require(hashlib.sha256(actual).digest()==hashlib.sha256(payload).digest(),'Downloaded bytes differ')
   employee_bytes=download(record_id,'employee');require(employee_bytes==payload,'Employee self download differs')
   evidence.append({'category':category,'bucket':bucket,'record_id':record_id,'sha256':hashlib.sha256(payload).hexdigest(),'size':len(payload),'uploadAttachSignReviewDownload':'PASS','wrongBucketUploadStatus':wrong_bucket_status,'noGrantActorUploadStatus':no_grant_status,'noGrantActorDenialNotExclusiveCauseClaim':True,'wrongBucketUploadDeniedNoObject':True,'noMedicalGrantUploadDeniedNoObject':category=='medical'})
  state['transportPassed']=True;save();(OUT/'transport-proof.json').write_text(json.dumps({'result':'PASS','sourceSha':state['sourceSha'],'target':REF,'evidence':evidence,'signedUrlsPersisted':False},indent=2)+'\n')
 elif args.action=='reconcile':
  require(state.get('transportPassed'),'Transport prerequisite missing')
  def reconcile(key):return request(r.app+'/api/admin/operations/employee-sources/reconcile',body={'task_id':state['task'],'request_key':state['run']+'-'+key},method='POST')[1]
  first=checkpoint('snapshot_initial',lambda:reconcile('initial'))
  again=reconcile('initial');unchanged=reconcile('unchanged')
  require(first['source_version']==again['source_version']==unchanged['source_version'] and len(first['history'])==len(again['history'])==len(unchanged['history']),'Unchanged/retry snapshot duplicated')
  # A newer approved synthetic version replaces only this isolated site's personnel requirement.
  create={'code':'TRN-24','title':'COL156 Synthetic expiry proof','version':2,'category':'training','source_file':'Synthetic only','source_page':1,'source_excerpt':'Isolated expiry test','recurrence_status':'one_time','content':'Synthetic expiry proof','required_signers':[],'applies_to_staff_roles':['resident_aide']}
  requirement=checkpoint('expiry_requirement',lambda:api('/requirements',body={'action':'create','payload':create},method='POST')[1]['result'])
  checkpoint('expiry_requirement_approved',lambda:api('/requirements',body={'action':'approve','payload':{'id':requirement['id'],'review_note':'Synthetic isolated expiry proof'}},method='POST')[1])
  old=str(datetime.date.fromisoformat(state['completed_on'])-datetime.timedelta(days=10));expired=str(datetime.date.fromisoformat(state['completed_on'])-datetime.timedelta(days=1))
  record=checkpoint('expired_record',lambda:command('submit_record',{'requirement_id':requirement['id'],'completed_on':old,'expires_on':expired,'notes':'Synthetic expired evidence'}))
  checkpoint('expired_review',lambda:command('review_record',{'id':record['id'],'status':'verified','review_note':'Synthetic expired record; not current clearance'}))
  changed=checkpoint('snapshot_expired',lambda:reconcile('expired'));repeat=reconcile('expired-repeat')
  field=next(field for field in changed['fields'] if field['source_id']=='AL-E06')
  require(field['state']=='expired' and changed['source_version']!=first['source_version'] and len(changed['history'])==len(first['history'])+1 and len(repeat['history'])==len(changed['history']),'Expiry transition or once-only history failed')
  (OUT/'reconcile-proof.json').write_text(json.dumps({'result':'PASS','initialHistoryCount':len(first['history']),'expiredHistoryCount':len(changed['history']),'expiryState':field['state'],'retryUnchanged':True,'noHfoPerformanceCommand':True},indent=2)+'\n')

 else:
  require(state.get('transportPassed'),'Positive transport prerequisite missing')
  personnel=state['record_ids']['personnel'];medical=state['record_ids']['medical']
  require(bool(download(personnel,'manager')),'Same-site personnel positive control failed')
  _,file=api(actor='manager');require(all(record['id']!=medical for record in file['records']),'Medical metadata exposed')
  status,_=api('/download?record_id='+medical,'manager',expected=(403,404));wrong,_=api('/download?record_id='+personnel,staff=state['other_staff'],expected=(403,404))
  def relogin_owner():
   _,session=request(r.base+'/auth/v1/token?grant_type=password',body={'email':state['run']+'-owner@example.invalid','password':state['passwords']['owner']},method='POST')
   require(session.get('access_token') and session.get('expires_at'),'Fresh owner login failed');state['sessions']['owner']=session;save()
  checkpoint('hfo_medical_scope_revoked',lambda:r.sql("UPDATE public.operation_subject_access SET revoked_at=clock_timestamp() WHERE organization_id='"+state['org']+"' AND user_id='"+state['users']['owner']+"' AND scope='employee_medical' AND revoked_at IS NULL"))
  relogin_owner()
  _,masked=request(r.app+'/api/admin/operations/employee-sources?task_id='+state['task'])
  require(masked['can_medical'] is False and all(field['value'] is None and not field['records'] for field in masked['fields'] if field['source_id'] in ['AL-E04','AL-E05']),'HFO-only medical revoke leaked fields')
  require(bool(download(personnel,'owner')) and bool(download(medical,'owner')),'HFO revoke unexpectedly altered native personnel/medical permissions')
  checkpoint('medical_revoked',lambda:api('/requirements',body={'action':'revoke_medical','payload':{'user_id':state['users']['owner'],'review_note':'Synthetic proof access revoked'}},method='POST')[1])
  relogin_owner()
  revoked,_=api('/download?record_id='+medical,expected=(401,403,404))
  require(bool(download(personnel,'owner')),'Personnel positive failed after native medical revoke')
  checkpoint('site_revoked',lambda:r.sql("UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id='"+state['users']['owner']+"' AND facility_id='"+state['site']+"' AND revoked_at IS NULL"))
  site_denied,_=api('/download?record_id='+personnel,expected=(401,403,404))
  (OUT/'transport-denial-proof.json').write_text(json.dumps({'result':'PASS','managerPersonnelPositive':True,'hfoMedicalScopeOnlyMasked':True,'nativePositiveAfterHfoRevoke':True,'personnelPositiveAfterMedicalRevoke':True,'siteRevokedDownloadDenied':site_denied,'managerMedicalDenied':status,'wrongStaffScopeDenied':wrong,'newDownloadAfterMedicalRevocationDenied':revoked,'priorSignedUrlTTLNotClaimedRevoked':True},indent=2)+'\n')
if __name__=='__main__':main()
