#!/usr/bin/env python3
"""Synthetic hosted proof. No network until explicit parent-owned READY.json gates pass."""
import argparse, base64, datetime as dt, hashlib, json, os, pathlib, re, secrets, subprocess, sys, struct, zlib, urllib.request, urllib.error, urllib.parse, uuid
from zoneinfo import ZoneInfo
ROOT=pathlib.Path(__file__).resolve().parent
REF='iwcnajanvjvynolltflw'
ORG='00000000-0000-0000-0000-000000000001'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
MD5=hashlib.md5(PNG).hexdigest(); SHA=hashlib.sha256(PNG).hexdigest()
def envfile(p):
    result={}
    for line in pathlib.Path(p).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);result[k.strip()]=v.strip().strip("'\"")
    return result

def redact(x):
    if isinstance(x,dict): return {k:('<REDACTED>' if re.search('token|password|cookie|authorization|apikey|signedurl|^url$|^sb-auth-(session|user)-id$',k,re.I) else redact(v)) for k,v in x.items()}
    if isinstance(x,list): return [redact(y) for y in x]
    if isinstance(x,str): return re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','<REDACTED>',re.sub(r'([?&]token=)[^&\s"\']+',r'\1<REDACTED>',x))
    return x

def lit(x): return "'"+str(x).replace("'","''")+"'"
def now(): return dt.datetime.now(dt.timezone.utc).isoformat()

class Proof:
    def __init__(self):
        ready=json.loads((ROOT/'READY.json').read_text())
        assert ready['stageReady'] is True and ready['evidenceVerified'] is True,'Parent readiness not verified'
        assert ready.get('authHookEnabled') is True,'Parent has not verified Auth hook'
        assert ready['projectRef']==REF and re.fullmatch('[0-9a-f]{40}',ready['integrationSha'])
        sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ready['checkout'],text=True).strip()
        assert sha==ready['integrationSha'],'Checkout moved after verification'
        assert subprocess.run(['git','diff','--quiet','HEAD','--'],cwd=ready['checkout']).returncode==0,'Tracked checkout changes after verified SHA'
        self.ready=ready;self.env=envfile('/Users/brianlewis/.config/haven-staging/col217.env')
        assert self.env['STAGING_PROJECT_REF']==REF
        self.base=self.env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
        assert self.base=='https://'+REF+'.supabase.co'
        assert self.env['PGUSER']=='postgres.'+REF and self.env['PGHOST']=='aws-0-us-west-2.pooler.supabase.com'
        self.app=ready['appUrl'].rstrip('/')
        assert urllib.parse.urlparse(self.app).hostname in ['127.0.0.1','localhost']
        self.private=pathlib.Path('/Users/brianlewis/.config/haven-staging/col143-fixtures.json')
        self.state=json.loads(self.private.read_text()) if self.private.exists() else {'run':'col143-'+secrets.token_hex(5),'users':{},'paths':[],'lanes':{}}
        self.sessions={};self.i=len(list(ROOT.glob('[0-9]*.json')))
        self.save()
    def save(self):
        self.private.write_text(json.dumps(self.state,indent=2));self.private.chmod(0o600)
    def log(self,label,data):
        self.i+=1;(ROOT/f'{self.i:03}-{label}.json').write_text(json.dumps(redact({'at':now(),**data}),indent=2)+'\n')
    def sql(self,label,query):
        env={**os.environ,**self.env,'PGPASSWORD':self.env['SUPABASE_DB_PASSWORD']}
        p=subprocess.run(['psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',query],env=env,capture_output=True,text=True)
        self.log(label,{'sql':query,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
        assert p.returncode==0,f'SQL failed: {label}; redacted evidence retained'
        return p.stdout.strip()
    def sqljson(self,label,query):
        return json.loads(self.sql(label,'SELECT coalesce(json_agg(q),\'[]\'::json) FROM ('+query+') q;'))
    def http(self,label,method,url,body=None,headers=None,expect=(200,),binary=False):
        host=urllib.parse.urlparse(url).hostname
        assert host in [REF+'.supabase.co','127.0.0.1','localhost'],'URL outside staging proof allowlist'
        headers=dict(headers or {})
        if isinstance(body,(dict,list)):
            headers['Content-Type']='application/json';payload=json.dumps(body).encode()
        else: payload=body
        try:
            with urllib.request.urlopen(urllib.request.Request(url,data=payload,method=method,headers=headers),timeout=90) as r: status=r.status;rh=dict(r.headers);raw=r.read()
        except urllib.error.HTTPError as e: status=e.code;rh=dict(e.headers);raw=e.read()
        if binary and status==200:
            result={'length':len(raw),'md5':hashlib.md5(raw).hexdigest(),'sha256':hashlib.sha256(raw).hexdigest()}
            self.last_binary_headers={k.lower():v for k,v in rh.items()}
        else:
            try: result=json.loads(raw)
            except (ValueError,UnicodeError): result=raw.decode(errors='replace')[:5000]
        self.log(label,{'request':{'method':method,'url':url,'headers':headers,'body':{'length':len(body),'sha256':hashlib.sha256(body).hexdigest()} if isinstance(body,bytes) else body},'response':{'status':status,'headers':rh,'body':result},'expected_status':list(expect)})
        assert status in expect,f'{label}: observed HTTP {status}; expected {expect}'
        return result
    def authheaders(self,role=None,service=False):
        key=self.env['SUPABASE_SERVICE_ROLE_KEY'] if service else self.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
        token=self.sessions[role]['access_token'] if role else key
        return {'apikey':key,'Authorization':'Bearer '+token}
    def login(self,role):
        u=self.state['users'][role]
        s=self.http('login-'+role,'POST',self.base+'/auth/v1/token?grant_type=password',{'email':u['email'],'password':u['password']},{'apikey':self.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']})
        self.sessions[role]=s
        claims=json.loads(base64.urlsafe_b64decode(s['access_token'].split('.')[1]+'=='))
        self.log('claims-'+role,{'claim_names':sorted(claims),'auth_claim_version':claims.get('auth_claim_version'),'session_id_present':bool(claims.get('session_id'))})
        assert claims.get('session_id') and claims.get('auth_claim_version') is not None,'Auth hook proof absent'
    def cookie(self,role):
        encoded='base64-'+base64.urlsafe_b64encode(json.dumps(self.sessions[role],separators=(',',':')).encode()).decode().rstrip('=')
        name='sb-'+REF+'-auth-token'
        if len(encoded)<=3180:return name+'='+encoded
        return '; '.join(name+'.'+str(i//3180)+'='+encoded[i:i+3180] for i in range(0,len(encoded),3180))
    def api(self,label,role,method,path,body=None,expect=(200,)):
        return self.http(label,method,self.app+'/api/admin/operations'+path,body,{'Cookie':self.cookie(role)} if role else {},expect)
    def rpc(self,label,role,name,body,expect=(200,),service=False):
        return self.http(label,'POST',self.base+'/rest/v1/rpc/'+name,body,self.authheaders(role,service),expect)
    def key(self,label):return self.state['run']+':'+label+':'+secrets.token_hex(4)
    def checkpoint(self,l,key,call):
        if key in l:return l[key]
        assert l.get('pending_step')!=key, 'Uncertain '+key+' response: inspect retained hosted rows before resuming; no automatic duplicate'
        l['pending_step']=key;self.save()
        result=call();l[key]=result;l.pop('pending_step',None);self.save()
        return result
    def preflight(self):
        self.sqljson('ledger','SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version')
        bucket=self.sqljson('storage-bucket',"SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='operation-evidence'")
        assert len(bucket)==1 and bucket[0]['public'] is False and bucket[0]['file_size_limit']==20971520
        assert set(bucket[0]['allowed_mime_types'])=={'application/pdf','image/jpeg','image/png','image/webp'}
        policies=self.sqljson('storage-policies',"SELECT policyname,permissive,cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'operation_evidence_storage_%'")
        assert len(policies)==6 and sum(p['permissive']=='RESTRICTIVE' for p in policies)==4
        a=self.sqljson('checksum-hook-preflight',"SELECT current_database() as db, current_user as actor, exists(SELECT 1 FROM information_schema.columns WHERE table_name='operation_evidence' AND column_name='declared_md5') as amended, to_regprocedure('public.haven_custom_access_token_hook(jsonb)') IS NOT NULL as hook_exists")
        assert a[0]['amended'] and a[0]['hook_exists']
    def fixtures(self):
        assert not self.state.get('fixtures_created'),'Fixtures already created; resume next phase'
        for role in ['admin','assistant','corp','siteb']:
            if role not in self.state['users']:
                email=self.state['run']+'+'+role+'@example.invalid';pw=secrets.token_urlsafe(30)
                u=self.http('create-'+role,'POST',self.base+'/auth/v1/admin/users',{'email':email,'password':pw,'email_confirm':True,'user_metadata':{'full_name':self.state['run']+' '+role}},self.authheaders(service=True),(200,201))
                self.state['users'][role]={'id':u['id'],'email':email,'password':pw};self.save()
        for k in ['entity','sitea','siteb','subject']:
            self.state[k]=str(uuid.uuid4())
        self.save();s=self.state;us=s['users'];q=['BEGIN;']
        q += [f"INSERT INTO public.entities(id,organization_id,name,entity_type) VALUES ({lit(s['entity'])},{lit(ORG)},{lit(s['run']+' Entity')},'llc');"]
        for site in ['sitea','siteb']:
            q += [f"INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone) VALUES ({lit(s[site])},{lit(s['entity'])},{lit(ORG)},{lit(s['run']+' '+site)},'Synthetic','Test','00000',1,'America/New_York');"]
        q += [f"INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind) VALUES ({lit(s['subject'])},{lit(ORG)},{lit(s['sitea'])},'facility');"]
        for role,app_role in [('admin','facility_admin'),('assistant','admin_assistant'),('corp','owner'),('siteb','facility_admin')]:
            u=us[role];site=s['siteb' if role=='siteb' else 'sitea']
            q += [f"INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) VALUES ({lit(u['id'])},{lit(u['email'])},{lit(s['run']+' '+role)},{lit(app_role)},{lit(ORG)},true);"]
        for role in ['admin','assistant','corp','siteb']:
            u=us[role];site=s['siteb' if role=='siteb' else 'sitea']
            q += [f"INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,granted_by) VALUES ({lit(u['id'])},{lit(site)},{lit(ORG)},{lit(us['corp']['id'])});"]
        q+=['COMMIT;'];self.sql('create-fixture-rows','\n'.join(q));s['fixtures_created']=True;self.save()
    def publish_lane(self,lane,role):
        s=self.state
        if lane not in s['lanes']:
            s['lanes'][lane]={'activity':str(uuid.uuid4()),'role':role,'effective':(dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=2)).isoformat(),'date':dt.datetime.now(ZoneInfo('America/New_York')).date().isoformat()};self.save()
        l=s['lanes'][lane]
        if l.get('receipt'):return l
        activity=l['activity'];today=dt.date.fromisoformat(l['date']);effective=l['effective']
        if not l.get('activity_created'):self.sql('create-activity-'+lane,f"INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin) VALUES ({lit(activity)},{lit(ORG)},NULL,{lit(s['run']+':'+lane)},{lit(s['run']+' '+lane)},'structured_observation','facility','admin_log') ON CONFLICT(id) DO NOTHING;")
        l['activity_created']=True;self.save()
        v=self.checkpoint(l,'draft_response',lambda:self.api('draft-'+lane,'corp','POST','/requirements',{'activity_id':activity,'payload':{'title':s['run']+' '+lane,'wording':'Synthetic panel photo test','allowed_recorder_roles':['facility_admin','admin_assistant'],'required_evidence':[{'kind':'photo','label':'Panel photo','min_count':1,'when':'always'}]}}))['version']['id']
        l['version']=v;self.save()
        self.checkpoint(l,'published_response',lambda:self.api('publish-'+lane,'corp','POST','/requirements/'+v+'/publish',{'effective_from':effective}))
        rule={'rule_version':1,'timezone':'America/New_York','recurrence':{'kind':'weekly','weekday':today.strftime('%A').lower()},'deadline':{'time':'23:00'}}
        c=self.checkpoint(l,'site_draft_response',lambda:self.api('site-draft-'+lane,'admin','POST','/facility-requirements',{'activity_id':activity,'facility_id':s['sitea'],'payload':{'applicability':'applicable','requirement_version_id':v,'schedule_status':'confirmed','schedule_rule':rule}}))['configuration']['id']
        l['configuration']=c;self.save()
        self.checkpoint(l,'site_published_response',lambda:self.api('site-publish-'+lane,'admin','POST','/facility-requirements/'+c+'/publish',{'effective_from':effective}))
        day=today.isoformat();due=dt.datetime.combine(today,dt.time(23),ZoneInfo('America/New_York')).isoformat()
        g=self.checkpoint(l,'generated_response',lambda:self.rpc('generate-'+lane,None,'generate_operation_occurrences_service',{'p_facility':s['sitea'],'p_configuration':c,'p_occurrences':[{'occurrence_date':day,'period':{'start_date':day,'end_date':(today+dt.timedelta(days=6)).isoformat()},'due_at':due,'grace_ends_at':None,'remind_at':None,'timezone':'America/New_York','adjustments':[]}],'p_run':{'run_id':s['run']+'-'+lane,'evaluator_version':'hfo-evaluator/1','date_from':day,'date_to':day,'rule':rule,'occurrence_kind':'scheduled'}},service=True))
        assert g['counts']['created']==1
        occurrence=self.sqljson('occurrence-'+lane,f"SELECT id FROM public.operation_task_instances WHERE activity_id={lit(activity)} AND facility_id={lit(s['sitea'])} AND deleted_at IS NULL")[0]['id']
        l['occurrence']=occurrence;self.save()
        payload={'outcome':'performed','note':s['run']+' '+lane}
        if lane=='late': payload.update(performed_at=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=2)).isoformat(),entry_kind='late',entry_reason='Synthetic earlier performance; evidence supplied later')
        r=self.checkpoint(l,'recorded_response',lambda:self.api('record-'+lane,role,'POST','/occurrences/'+occurrence+'/record',{'request_key':self.key('record-'+lane),'payload':payload}))
        assert r['receipt']['evidence_status_current']=='missing'
        l['receipt']=r['receipt'];self.save()
        return self.state['lanes'][lane]
    def prepare(self,lane,role,rule=True,md5=None,label='prepare'):
        l=self.state['lanes'][lane]
        data=PNG
        if not rule:
            def chunk(kind,body): return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)
            pixel=hashlib.sha256(label.encode()).digest()[:3]+b'\xff'
            data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00'+pixel))+chunk(b'IEND',b'')
        digest=hashlib.md5(data).hexdigest()
        p={'kind':'photo','filename':label+'.png','mime':'image/png','size_bytes':len(data),'md5':md5 or digest,'sha256':hashlib.sha256(data).hexdigest()}
        if rule:p['rule_label']='Panel photo'
        x=self.api(label+'-'+lane,role,'POST','/evidence',{'receipt_id':l['receipt']['id'],'request_key':self.key(label),'payload':p})
        assert x['evidence']['state']=='prepared' and x.get('upload',{}).get('signedUrl')
        e=x['evidence'];self.state['paths'].append(e['object_path']);self.state.setdefault('prepared_evidence',{})[e['id']]={'lane':lane,'role':role,'label':label,'evidence':e};self.save()
        self.http(label+'-storage-put-'+lane,'PUT',x['upload']['signedUrl'],data,{**self.authheaders(role),'Content-Type':'image/png','x-upsert':'false'})
        rows=self.sqljson(label+'-object-'+lane,"SELECT id,owner,owner_id,version,metadata->>'size' AS size,metadata->>'mimetype' AS mime,metadata->>'eTag' AS etag FROM storage.objects WHERE bucket_id='operation-evidence' AND name="+lit(e['object_path']))
        assert len(rows)==1 and rows[0]['owner']==self.state['users'][role]['id'] and rows[0]['owner_id']==self.state['users'][role]['id'],'Storage owner mismatch'
        assert rows[0]['etag'].strip('"').lower()==digest and int(rows[0]['size'])==len(data) and rows[0]['mime']=='image/png'
        return e
    def uploaded(self,lane,role,e,expect=(200,)):
        x=self.api('uploaded-'+lane,role,'POST','/evidence/'+e['id']+'/uploaded',{'request_key':self.key('uploaded')},expect)
        if expect==(200,): assert x['evidence']['state']=='uploaded' and x['evidence']['checksum_verified'] is True
        return x
    def finalize(self,lane,role,e,revision=None,expect=(200,)):
        return self.api('finalize-'+lane,role,'POST','/evidence/'+e['id']+'/finalize',{'request_key':self.key('finalize'),'expected_receipt_revision':revision or self.state['lanes'][lane]['receipt']['revision'],'payload':{'sha256':e.get('declared_sha256') or SHA}},expect)
    def download(self,label,role,e):
        x=self.api(label+'-sign',role,'GET','/evidence/'+e['id']+'/download')
        data=self.http(label+'-bytes','GET',x['download']['signedUrl'],binary=True)
        assert data=={'length':len(PNG),'md5':MD5,'sha256':SHA}
        assert self.last_binary_headers.get('content-type','').split(';')[0]=='image/png'
        assert int(self.last_binary_headers.get('content-length',-1))==len(PNG)
        assert 'attachment' in self.last_binary_headers.get('content-disposition','')
    def verify_completion(self,lane,e):
        l=self.state['lanes'][lane];r=l['receipt']
        rows=self.sqljson('attribution-'+lane,"SELECT id,recorder_id,performed_at,recorded_at,revision,evidence_status,evidence_status_current FROM public.operation_execution_receipts WHERE task_instance_id="+lit(l['occurrence'])+" AND receipt_kind='performance'")
        assert len(rows)==1 and rows[0]['id']==r['id'] and rows[0]['revision']==r['revision'] and rows[0]['recorder_id']==r['recorder_id']
        for field in ['performed_at','recorded_at']: assert dt.datetime.fromisoformat(rows[0][field])==dt.datetime.fromisoformat(r[field])
        assert rows[0]['evidence_status']=='missing' and rows[0]['evidence_status_current']=='complete'
        self.download('corporate-download-'+lane,'corp',e)
        listing=self.api('corporate-list-'+lane,'corp','GET','/evidence?receipt_id='+r['id'])
        assert 'object_path' not in json.dumps(listing)
        self.api('receipts-'+lane,l['role'],'GET','/occurrences/'+l['occurrence']+'/receipts')
    def positive(self,lane,role,negatives=False):
        l=self.publish_lane(lane,role)
        if l.get('passed'):return
        if 'evidence' not in l:
            assert not l.get('pending_evidence'), 'Evidence prepare/upload incomplete; inspect owned rows and use narrow resume before replay'
            l['pending_evidence']=True;self.save()
            e=self.prepare(lane,role);l['evidence']=e;l.pop('pending_evidence');self.save()
        e=l['evidence']
        if not l.get('uploaded_ok'):self.uploaded(lane,role,e);l['uploaded_ok']=True;self.save()
        if negatives and not l.get('inflight_negatives_ok'):self.inflight_negatives(lane,e);l['inflight_negatives_ok']=True;self.save()
        x=self.checkpoint(l,'finalized_response',lambda:self.finalize(lane,role,e))
        assert x['evidence']['state']=='finalized' and x['satisfaction']['receipt_evidence_status']=='complete' and x['satisfaction']['occurrence']['execution_state']=='completed'
        self.verify_completion(lane,e);l['passed']=True;self.save()
    def inflight_negatives(self,lane,e):
        l=self.state['lanes'][lane];r=l['receipt'];eid=e['id'];path=e['object_path'];storage='/storage/v1/object/'
        self.api('neg-siteb-prepare','siteb','POST','/evidence',{'receipt_id':r['id'],'request_key':self.key('neg-siteb'),'payload':{'kind':'photo','filename':'wrong.png','mime':'image/png','size_bytes':len(PNG),'md5':MD5}},(403,404))
        for command in ['uploaded','finalize','fail']:
            b={'request_key':self.key('neg-assistant-'+command)}
            rb={'p_evidence':eid,'p_request_key':self.key('neg-assistant-rpc-'+command)}
            if command=='finalize':b.update(expected_receipt_revision=r['revision'],payload={});rb.update(p_expected_receipt_revision=r['revision'],p_payload={})
            if command=='fail':b['payload']={'reason':'Synthetic negative'};rb['p_payload']=b['payload']
            self.api('neg-other-uploader-'+command,'assistant','POST','/evidence/'+eid+'/'+command,b,(404,))
            name={'uploaded':'mark_operation_evidence_uploaded_review','finalize':'finalize_operation_evidence_review','fail':'fail_operation_evidence_review'}[command]
            self.rpc('neg-other-uploader-rpc-'+command,'assistant',name,rb,(400,403))
        self.api('neg-corp-unfinalized','corp','GET','/evidence/'+eid+'/download',expect=(404,))
        self.http('neg-corp-storage-sign','POST',self.base+storage+'sign/operation-evidence/'+path,{'expiresIn':60},self.authheaders('corp'),(400,403,404))
        self.finalize(lane,'admin',e,'a'*64,(409,))
        self.http('neg-siteb-sign','POST',self.base+storage+'upload/sign/operation-evidence/'+path,{},self.authheaders('siteb'),(400,403,404))
        self.http('neg-siteb-write','POST',self.base+storage+'operation-evidence/'+path,PNG,{**self.authheaders('siteb'),'Content-Type':'image/png'},(400,403,404))
        rows=self.sqljson('negative-state-intact',"SELECT state,(SELECT count(*) FROM public.operation_evidence_events WHERE evidence_id=e.id AND event_kind IN ('finalized','failed')) AS forbidden_events FROM public.operation_evidence e WHERE id="+lit(eid))
        assert rows[0]['state']=='uploaded' and rows[0]['forbidden_events']==0
    def final_negatives(self):
        lane='admin';l=self.state['lanes'][lane];e=l['evidence'];path=e['object_path'];eid=e['id'];r=l['receipt']
        self.http('neg-finalized-resign','POST',self.base+'/storage/v1/object/upload/sign/operation-evidence/'+path,{},self.authheaders('admin'),(400,403,404))
        self.http('neg-finalized-overwrite','PUT',self.base+'/storage/v1/object/operation-evidence/'+path,b'x'*70,{**self.authheaders('admin'),'Content-Type':'image/png','x-upsert':'true'},(400,403,404))
        self.download('unchanged-after-overwrite','corp',e)
        mismatch=self.prepare(lane,'admin',False,hashlib.md5(b'').hexdigest(),'mismatch')
        result=self.uploaded('admin','admin',mismatch,(409,))
        assert result['evidence_outcome']=='checksum_mismatch' and result['evidence']['state']=='failed'
        revoked=self.prepare(lane,'admin',False,label='revoked');self.uploaded(lane,'admin',revoked)
        uid=self.state['users']['admin']['id'];corp=self.state['users']['corp']['id'];site=self.state['sitea']
        try:
            self.sql('revoke-own-grant',f"UPDATE public.user_facility_access SET revoked_at=now(),revoked_by={lit(corp)} WHERE user_id={lit(uid)} AND facility_id={lit(site)} AND revoked_at IS NULL;")
            self.finalize(lane,'admin',revoked,expect=(401,403,404))
            self.api('neg-revoked-download','admin','GET','/evidence/'+eid+'/download',expect=(401,403,404))
            state=self.sqljson('revoked-state',"SELECT state FROM public.operation_evidence WHERE id="+lit(revoked['id']))
            assert state[0]['state']=='uploaded'
        finally:
            self.sql('restore-own-grant',f"UPDATE public.user_facility_access SET revoked_at=NULL,revoked_by=NULL WHERE user_id={lit(uid)} AND facility_id={lit(site)};")
            self.login('admin')
        body={'receipt_id':r['id'],'request_key':self.key('anon'),'payload':{'kind':'photo','filename':'anon.png','mime':'image/png','size_bytes':len(PNG),'md5':MD5}}
        self.api('neg-anon-route',None,'POST','/evidence',body,(401,))
        self.rpc('neg-anon-rpc',None,'prepare_operation_evidence_review',{'p_receipt':r['id'],'p_request_key':self.key('anon-rpc'),'p_payload':body['payload']},(401,))
        anon_denial=self.http('neg-anon-storage-valid-transport','POST',self.base+'/storage/v1/object/sign/operation-evidence/'+path,{'expiresIn':60},self.authheaders(),(400,401,403,404))
        assert isinstance(anon_denial,dict) and anon_denial.get('code')=='AccessDenied','Anonymous Storage refusal was not an authorization denial'
        self.verify_completion(lane,e)
    def cleanup(self):
        s=self.state
        if s['paths']:
            self.http('cleanup-owned-objects','DELETE',self.base+'/storage/v1/object/operation-evidence',{'prefixes':s['paths']},self.authheaders(service=True))
        ids=','.join(lit(u['id']) for u in s['users'].values())
        self.sql('deactivate-owned-fixtures',f"BEGIN; UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id IN ({ids}) AND revoked_at IS NULL; UPDATE public.user_profiles SET is_active=false WHERE id IN ({ids}); UPDATE public.facilities SET deleted_at=now() WHERE id IN ({lit(s['sitea'])},{lit(s['siteb'])}); UPDATE public.entities SET deleted_at=now() WHERE id={lit(s['entity'])}; COMMIT;")
        for role,u in s['users'].items():
            self.http('ban-fixture-'+role,'PUT',self.base+'/auth/v1/admin/users/'+u['id'],{'ban_duration':'876000h'},self.authheaders(service=True))
        rows=self.sqljson('cleanup-verify',f"SELECT (SELECT count(*) FROM storage.objects WHERE bucket_id='operation-evidence' AND name IN ({','.join(lit(x) for x in s['paths']) or "''"})) AS objects,(SELECT count(*) FROM public.user_profiles WHERE id IN ({ids}) AND is_active) AS active_profiles,(SELECT count(*) FROM public.user_facility_access WHERE user_id IN ({ids}) AND revoked_at IS NULL) AS active_grants")
        assert all(v==0 for v in rows[0].values());s['cleaned']=True;self.save()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['preflight','fixtures','proof','cleanup']);args=parser.parse_args()
    try:
        p=Proof()
        if args.phase=='preflight':p.preflight()
        elif args.phase=='fixtures':p.fixtures()
        elif args.phase=='proof':
            for role in p.state['users']:p.login(role)
            p.positive('admin','admin',True);p.positive('assistant','assistant');p.positive('late','admin');p.final_negatives()
        elif args.phase=='cleanup':p.cleanup()
        print(args.phase+': completed; redacted evidence retained')
    except Exception as e:
        print('STOP: '+redact(str(e)),file=sys.stderr);sys.exit(1)
