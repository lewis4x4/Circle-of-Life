import json, os, pathlib, subprocess, time, uuid, hashlib
ROOT=pathlib.Path('/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335')
RUN=ROOT/'f03-batch-340'; REPO=pathlib.Path('/Users/brianlewis/Circle of Life/Haven Finance Integration')
m=json.loads((RUN/'manifest.json').read_text()); assert m['database']=='hfa_batch_340_20260909' and m['owner']=='f00_independent_review'
BASE=['psql','-X','-q','-A','-t','-h',str(ROOT),'-p','55447','-U','postgres','-d',m['database'],'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
PREFIX=(REPO/'supabase/tests/review_finance_batch_approval.sql').read_text().split('-- ASSERTIONS_BEGIN')[0]
RESULTS=[]
def quote(x):return "'"+str(x).replace("'","''")+"'"
def run(s):
 p=subprocess.run(BASE,input=s,text=True,capture_output=True,timeout=15)
 if p.returncode: raise RuntimeError(p.stderr[-2500:])
 return p.stdout.strip()
def lastjson(text):return json.loads([x for x in text.splitlines() if x.startswith('{')][-1])
def setup():
 return lastjson(run(PREFIX+"\nRESET ROLE; SELECT jsonb_build_object('fixture',row_to_json(f),'actors',(SELECT jsonb_object_agg(a.label,jsonb_build_object('id',a.id,'session',a.session_id,'version',p.auth_claim_version)) FROM ba a JOIN public.user_profiles p ON p.id=a.id),'ids',(SELECT jsonb_object_agg(label,id) FROM bi),'events',(SELECT jsonb_object_agg(i.label,e.id) FROM bi i JOIN public.finance_source_events e ON e.receipt_id=i.id)) FROM bf f; COMMIT;"))
def auth(f,who):
 a=f['actors'][who];claims={'role':'authenticated','sub':a['id'],'session_id':a['session'],'auth_claim_version':a['version']}
 return 'BEGIN; SELECT set_config(\'request.jwt.claims\','+quote(json.dumps(claims))+',true); SET LOCAL ROLE authenticated; '
def members(f,label='p1'):
 n='2000000000' if label in ['p1','p2'] else '100'
 return json.dumps([{'eventId':f['events'][label],'lines':[{'accountReference':'100','side':'debit','amountCents':n},{'accountReference':'200','side':'credit','amountCents':n}]}])
def prepare(f,batch=None,who='owner',label='p1'):
 x=f['fixture'];batch=batch or f['ids']['main']
 return auth(f,who)+f"SELECT public.prepare_finance_batch({quote(batch)},{quote(x['entity'])},{quote(x['a'])},current_date,{quote(f['ids']['rules'])},{quote(members(f,label))}::jsonb); COMMIT;"
def blocker(s):
 p=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 p.stdin.write('BEGIN; '+s+"; SELECT 'LOCKED';\n");p.stdin.flush()
 while p.stdout.readline().strip()!='LOCKED':
  if p.poll() is not None:raise RuntimeError('Lock blocker failed')
 return p
def release(p):p.stdin.write('ROLLBACK;\n');p.stdin.close();p.wait(timeout=5)
def worker(s,label):
 env=os.environ.copy();env['PGAPPNAME']=label
 p=subprocess.Popen(BASE,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 p.stdin.write(s);p.stdin.close();return p
def waits(labels):
 until=time.monotonic()+5
 while time.monotonic()<until:
  count=int(run('SELECT count(*) FROM pg_stat_activity WHERE application_name IN('+','.join(quote(x) for x in labels)+") AND wait_event_type='Lock';"))
  if count==len(labels):return True
  time.sleep(.03)
 raise RuntimeError('Required lock wait was not observed')
def finish(p):p.wait(timeout=10);return p.returncode,p.stdout.read(),p.stderr.read()
def check(name,ok,details):
 RESULTS.append({'name':name,'status':'PASS' if ok else 'FAIL','details':details})
 if not ok:raise AssertionError(name+': '+str(details))
def count(f,table,predicate='true'):return int(run(f"SELECT count(*) FROM public.{table} WHERE {predicate};"))
# Two true overlapping submissions; both wait before the shared control lock.
for same in [False,True]:
 f=setup();b=blocker(f"SELECT 1 FROM public.finance_staging_controls WHERE entity_id={quote(f['fixture']['entity'])} FOR UPDATE")
 ids=[f['ids']['main'],f['ids']['main'] if same else f['ids']['successor']];labels=['hfa340-overlap-'+uuid.uuid4().hex[:8] for _ in ids]
 ps=[worker(prepare(f,i),label) for i,label in zip(ids,labels)];waits(labels);release(b);out=[finish(p) for p in ps]
 outcomes=sorted(x[0] for x in out)
 check('same-id-concurrent-idempotency' if same else 'overlapping-event-single-active-claim',outcomes==([0,0] if same else [0,3]) and count(f,'finance_batch_event_claims',f"event_id={quote(f['events']['p1'])}")==1 and count(f,'finance_batches',f"entity_id={quote(f['fixture']['entity'])}")==1,{'exit_codes':outcomes,'waits_observed':2,'claims':1})
 if not same:check('overlap-error-is-claim-uniqueness',any('23505' in x[2] and 'finance_batch_event_claims_pkey' in x[2] for x in out),{'sqlstate':'23505'})
# Prepare must recheck after control and event waits, including natural expiry.
for lock_kind in ['control','event','expiry']:
 f=setup();x=f['fixture'];target=f['events']['p1']
 lock=f"SELECT 1 FROM public.finance_source_events WHERE id={quote(target)} FOR UPDATE" if lock_kind=='event' else f"SELECT 1 FROM public.finance_staging_controls WHERE entity_id={quote(x['entity'])} FOR UPDATE"
 b=blocker(lock);label='hfa340-prepare-'+uuid.uuid4().hex[:8];p=worker(prepare(f,who='preparer'),label);waits([label])
 if lock_kind=='expiry':run(f"UPDATE auth.sessions SET not_after=clock_timestamp()+interval '100 milliseconds' WHERE id={quote(f['actors']['preparer']['session'])};");time.sleep(.2)
 else:run(f"UPDATE public.user_profiles SET is_active=false WHERE id={quote(f['actors']['preparer']['id'])};")
 release(b);out=finish(p);check('prepare-rechecks-after-'+lock_kind,out[0]==3 and '42501' in out[2] and 'Current batch authority required' in out[2] and count(f,'finance_batches',f"id={quote(f['ids']['main'])}")==0,{'wait_observed':True,'sqlstate':'42501','batch_rows':0})
# Approval cannot outlive a revoked current session while waiting for period.
f=setup();run(prepare(f));binding=run(f"SELECT binding_sha256 FROM public.finance_batches WHERE id={quote(f['ids']['main'])};")
b=blocker(f"SELECT haven.lock_finance_period({quote(f['fixture']['entity'])},current_date)");label='hfa340-approve-'+uuid.uuid4().hex[:8];decision=str(uuid.uuid4());p=worker(auth(f,'approver')+f"SELECT public.decide_finance_batch({quote(decision)},{quote(f['ids']['main'])},'approve',{quote(binding)});COMMIT;",label);waits([label]);run(f"DELETE FROM auth.sessions WHERE id={quote(f['actors']['approver']['session'])};");release(b);out=finish(p)
check('approval-period-wait-revocation',out[0]==3 and '42501' in out[2] and count(f,'finance_batch_decisions',f"id={quote(decision)}")==0,{'wait_observed':True,'approval_rows':0})
# Nested invalidation locks must also recheck expiry, not only the outer locks.
for kind in ['control','period']:
 f=setup();run(prepare(f));x=f['fixture'];b=blocker(f"SELECT 1 FROM public.finance_batches WHERE id={quote(f['ids']['main'])} FOR UPDATE");label='hfa340-nested-'+uuid.uuid4().hex[:8]
 stmt=f"SELECT public.set_finance_staging_control('{uuid.uuid4()}',{quote(x['entity'])},1,true,NULL,NULL,NULL)" if kind=='control' else f"INSERT INTO public.gl_period_closes(organization_id,entity_id,period_year,period_month,status) VALUES({quote(x['org'])},{quote(x['entity'])},extract(year FROM current_date)::int,extract(month FROM current_date)::int,'closed')"
 p=worker(auth(f,'owner')+stmt+';COMMIT;',label);waits([label]);run(f"UPDATE auth.sessions SET not_after=clock_timestamp()+interval '100 milliseconds' WHERE id={quote(f['actors']['owner']['session'])};");time.sleep(.2);release(b);out=finish(p)
 unchanged=run(f"SELECT status FROM public.finance_batches WHERE id={quote(f['ids']['main'])};")=='prepared'
 check('nested-'+kind+'-invalidation-wait-expiry',out[0]==3 and '42501' in out[2] and unchanged,{'wait_observed':True,'batch_status':'prepared','sqlstate':'42501'})
output={'status':'PASS','layer':'native PostgreSQL with Auth stubs','tests':RESULTS,'passed':len(RESULTS),'failed':0,'skipped':0,'migration_sha256':hashlib.sha256((REPO/'supabase/migrations/340_finance_batch_approval.sql').read_bytes()).hexdigest(),'harness_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
(RUN/'concurrency.json').write_text(json.dumps(output,indent=2));print(json.dumps(output))
