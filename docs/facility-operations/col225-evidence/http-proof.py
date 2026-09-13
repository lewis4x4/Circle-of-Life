#!/usr/bin/env python3
"""Real stage-backed HTTP proof using only fresh PostgreSQL legacy-shaped IDs."""
import base64,csv,datetime,hashlib,io,json,pathlib,runpy,subprocess,sys,urllib.request,urllib.error,uuid
OUT=pathlib.Path(__file__).resolve().parent;ROOT=OUT.parents[2]
sys.argv=['fixture.py','inspect'];m=runpy.run_path(str(OUT/'fixture.py'));s=m['state'];assert s['run'].startswith('col225-') and not s.get('cleaned')
for key in ['entity','site','siteb','activity','subject']:assert s[key][14]=='0' and s[key][19]=='0'
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();diff=subprocess.check_output(['git','diff','--','src'],cwd=ROOT);diffhash=hashlib.sha256(diff).hexdigest()
report={'creation_evidence':'http-initial-report.json', 'sourceSha':sha,'diffSha256':diffhash,'target':s['target'],'base':'http://127.0.0.1:4325','fixture':{k:s[k] for k in ['run','user','entity','site','siteb','activity','subject']},'requests':[]}
encoded='base64-'+base64.urlsafe_b64encode(json.dumps(s['session'],separators=(',',':')).encode()).decode().rstrip('=');name='sb-'+s['target']+'-auth-token';cookie='; '.join(name+('.'+str(i//3180) if len(encoded)>3180 else '')+'='+encoded[i:i+3180] for i in range(0,len(encoded),3180))
def api(path,body=None,method='POST',expected=(200,),label=None):
 headers={'Cookie':cookie,'Content-Type':'application/json'}
 try:
  with urllib.request.urlopen(urllib.request.Request(report['base']+'/api/admin/operations'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method),timeout=90) as r:status=r.status;raw=r.read();rh=dict(r.headers)
 except urllib.error.HTTPError as e:status=e.code;raw=e.read();rh=dict(e.headers)
 report['requests'].append({'label':label or path,'method':method,'path':path,'status':status});(OUT/'http-report.json').write_text(json.dumps(report,indent=2))
 assert status in expected, (label or path)+' unexpectedHTTP'+str(status)+' '+raw.decode(errors='replace')[:500]
 if {k.lower():v for k,v in rh.items()}.get('content-type','').startswith('text/csv'):return raw.decode()
 return json.loads(raw)
def checkpoint(key,fn):return m['checkpoint'](key,fn)
try:
 v=checkpoint('version',lambda:api('/requirements',{'activity_id':s['activity'],'payload':{'title':'Legacy UUID fixture check','wording':'Synthetic canonical UUID verification only','allowed_recorder_roles':['owner'],'source_authority':{'source':'COL225 synthetic fixture','answer_id':'fixture-only','approver_id':s['user']}}}))['version']['id']
 effective=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=1)).isoformat()
 checkpoint('published',lambda:api('/requirements/'+v+'/publish',{'effective_from':effective}))
 c=checkpoint('configuration',lambda:api('/facility-requirements',{'facility_id':s['site'],'activity_id':s['activity'],'payload':{'requirement_version_id':v,'applicability':'applicable','schedule_status':'needs_confirmation'}}))['configuration']['id']
 checkpoint('configuration_published',lambda:api('/facility-requirements/'+c+'/publish',{'effective_from':effective}))
 occurrence=checkpoint('occurrence',lambda:api('/occurrences/manual',{'facility_id':s['site'],'activity_id':s['activity'],'subject_id':s['subject'],'request_key':s['run']+'-manual','payload':{}}))['occurrence']
 assert occurrence['facility_id']==s['site'] and occurrence['activity_id']==s['activity'] and occurrence['subject_id']==s['subject'] and occurrence['due_at'] is None
 checkpoint('receipt',lambda:api('/occurrences/'+occurrence['id']+'/record',{'request_key':s['run']+'-record','payload':{'outcome':'performed'}}))
 export=checkpoint('export',lambda:api('/activity-history/exports',{'facility_id':s['site'],'activity_id':s['activity'],'request_id':str(uuid.uuid4())}))
 assert export['manifest']['filters']=={'facility_id':s['site'],'activity_id':s['activity']} and export['manifest']['total']==1
 text=api('/activity-history/exports/'+export['export_id']+'/download',method='GET');rows=list(csv.DictReader(io.StringIO(text)))
 assert len(rows)==2 and rows[0]['row_type']=='manifest' and rows[1]['occurrence_id']==occurrence['id']
 (OUT/'legacy-shape-export.csv').write_text(text);report['download']={'rows':1,'bytes':len(text.encode()),'sha256':hashlib.sha256(text.encode()).hexdigest(),'filters_unchanged':True,'entity_ids_unchanged':True}
 for scope,path,body,expected in [
  ('cross-site requirement','/facility-requirements',{'facility_id':s['siteb'],'activity_id':s['activity'],'payload':{}},(404,)),
  ('cross-site manual','/occurrences/manual',{'facility_id':s['siteb'],'activity_id':s['activity'],'subject_id':s['subject'],'request_key':s['run']+'-foreign','payload':{}},(404,)),
  ('cross-site export','/activity-history/exports',{'facility_id':s['siteb'],'activity_id':s['activity'],'request_id':str(uuid.uuid4())},(403,))]:api(path,body,expected=expected,label=scope)
 m['sql']('UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id='+m['lit'](s['user']))
 for scope,path,body in [
  ('revoked requirement','/facility-requirements',{'facility_id':s['site'],'activity_id':s['activity'],'payload':{}}),
  ('revoked manual','/occurrences/manual',{'facility_id':s['site'],'activity_id':s['activity'],'subject_id':s['subject'],'request_key':s['run']+'-revoked','payload':{}}),
  ('revoked export','/activity-history/exports',{'facility_id':s['site'],'activity_id':s['activity'],'request_id':str(uuid.uuid4())})]:api(path,body,expected=(401,403,404),label=scope)
 api('/activity-history/exports/'+export['export_id']+'/download',method='GET',expected=(401,403,404),label='revoked existing export download')
 report['status']='PASS'
except Exception as e:
 report['status']='FAIL';report['failure']=str(e);raise
finally:
 report['sourceUnchanged']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==sha and hashlib.sha256(subprocess.check_output(['git','diff','--','src'],cwd=ROOT)).hexdigest()==diffhash
 (OUT/'http-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'sourceUnchanged':report['sourceUnchanged'],'requests':report['requests']},indent=2))
