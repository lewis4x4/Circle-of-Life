#!/usr/bin/env python3
"""Real scoped Storage upload/finalization for the exact fresh COL223 fixture."""
import base64,hashlib,json,pathlib,runpy,sys,urllib.request,urllib.error,urllib.parse
sys.argv=['fixture.py','inspect'];m=runpy.run_path(str(pathlib.Path(__file__).with_name('fixture.py')))
s=m['state'];assert not s.get('cleaned') and s['run'].startswith('col223-')
out=pathlib.Path(__file__).resolve().parent
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
encoded='base64-'+base64.urlsafe_b64encode(json.dumps(s['session'],separators=(',',':')).encode()).decode().rstrip('=')
name='sb-'+s['target']+'-auth-token';cookie='; '.join(name+('.'+str(i//3180) if len(encoded)>3180 else '')+'='+encoded[i:i+3180] for i in range(0,len(encoded),3180))
def api(path,body):
 request=urllib.request.Request('http://127.0.0.1:4323/api/admin/operations'+path,data=json.dumps(body).encode(),headers={'Cookie':cookie,'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=90) as response:return json.load(response)
 except urllib.error.HTTPError as error:raise RuntimeError('Local API '+path+' HTTP'+str(error.code)+' '+error.read().decode()[:500])
def receipt():return json.loads(m['sql']('SELECT row_to_json(r) FROM public.operation_execution_receipts r WHERE id='+m['lit'](s['receipt']['receipt']['id'])))
def immutable(r):return {k:v for k,v in r.items() if k not in ['evidence_status_current','evidence_satisfied_at']}
def digest(r):return hashlib.sha256(json.dumps(r,sort_keys=True).encode()).hexdigest()
before=receipt();assert before['completion_state']=='performed_missing_evidence' and before['evidence_status_current']=='missing'
s['before_receipt']=before;m['save']()
prepared=m['checkpoint']('prepared_evidence',lambda:api('/evidence',{'receipt_id':before['id'],'request_key':s['run']+'-prepare','payload':{'kind':'photo','rule_label':'Panel photo','filename':'synthetic.png','mime':'image/png','size_bytes':len(PNG),'md5':hashlib.md5(PNG).hexdigest(),'sha256':hashlib.sha256(PNG).hexdigest()}}))
url=prepared['upload']['signedUrl'];parts=urllib.parse.urlparse(url);assert parts.scheme=='https' and parts.hostname==s['target']+'.supabase.co'
if not s.get('bytes_uploaded'):
 request=urllib.request.Request(url,data=PNG,headers={'Authorization':'Bearer '+s['session']['access_token'],'apikey':m['env']['NEXT_PUBLIC_SUPABASE_ANON_KEY'],'Content-Type':'image/png','x-upsert':'false'},method='PUT')
 with urllib.request.urlopen(request,timeout=90) as response:assert response.status==200
 s['bytes_uploaded']=True;m['save']()
eid=prepared['evidence']['id']
m['checkpoint']('uploaded_evidence',lambda:api('/evidence/'+eid+'/uploaded',{'request_key':s['run']+'-uploaded'}))
final=m['checkpoint']('finalized_evidence',lambda:api('/evidence/'+eid+'/finalize',{'request_key':s['run']+'-finalize','expected_receipt_revision':before['revision'],'payload':{'sha256':hashlib.sha256(PNG).hexdigest()}}))
after=receipt();assert immutable(before)==immutable(after)
assert after['evidence_status_current']=='complete' and after['evidence_status']=='missing' and after['completion_state']=='performed_missing_evidence'
occurrence=json.loads(m['sql']('SELECT json_build_object(\'status\',status,\'execution_state\',execution_state) FROM public.operation_task_instances WHERE id='+m['lit'](s['occurrence_completed']['id'])))
assert occurrence['status']=='completed' and occurrence['execution_state']=='completed'
fields=['id','recorder_id','recorded_at','performed_at','revision','completion_state','evidence_status','evidence_status_current','evidence_satisfied_at']
report={'target':s['target'],'status':'PASS','transport':'Real session-authorized Storage PUT and application uploaded/finalize endpoints','upload_bytes':len(PNG),'upload_sha256':hashlib.sha256(PNG).hexdigest(),'evidence_id':eid,'checksum_verified':final['evidence']['checksum_verified'],'before':{k:before.get(k) for k in fields},'after':{k:after.get(k) for k in fields},'immutable_before_sha256':digest(immutable(before)),'immutable_after_sha256':digest(immutable(after)),'occurrence':occurrence}
(out/'evidence-finalization.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'PASS','immutable_unchanged':True,'current_evidence':'complete','original_state':after['completion_state'],'occurrence':occurrence}))
