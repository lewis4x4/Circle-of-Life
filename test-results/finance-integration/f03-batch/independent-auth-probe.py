import pathlib,subprocess,json,uuid,time,os,hashlib,datetime
root=pathlib.Path('/Users/brianlewis/Circle of Life/Haven Finance Integration');base=pathlib.Path('/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335')
args=['/opt/homebrew/opt/postgresql@17/bin/psql','-h',str(base),'-p','55447','-U','postgres','-d','hfa_340_auth_review','-Atq','-v','ON_ERROR_STOP=1'];env=os.environ.copy();env['PGTZ']='UTC';results=[]
def quote(v):return "'"+str(v).replace("'","''")+"'"
def sql(s):
 p=subprocess.run(args,input=s,capture_output=True,text=True,env=env,timeout=30)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip()
def fixture():
 s=(root/'supabase/tests/review_finance_batch_approval.sql').read_text().split('-- ASSERTIONS_BEGIN')[0].replace('BEGIN;','',1).replace('SET LOCAL ROLE authenticated;','SET ROLE authenticated;').replace('::text,true);','::text,false);')
 s+="""\nRESET ROLE;
SELECT jsonb_build_object('base',(SELECT to_jsonb(f) FROM bf f),'date',to_char(current_date,'YYYY-MM-DD'),
'actors',(SELECT jsonb_object_agg(a.label,jsonb_build_object('id',a.id,'session',a.session_id,'version',p.auth_claim_version)) FROM ba a JOIN user_profiles p ON p.id=a.id),
'ids',(SELECT jsonb_object_agg(label,id) FROM bi),
'events',(SELECT jsonb_object_agg(i.label,jsonb_build_object('id',e.id,'amount',e.control_total_cents::text)) FROM bi i JOIN finance_source_events e ON e.receipt_id=i.id));"""
 return json.loads(sql(s).splitlines()[-1])
def auth(f,label):
 a=f['actors'][label];claims=json.dumps({'role':'authenticated','sub':a['id'],'session_id':a['session'],'auth_claim_version':a['version']})
 return 'SET request.jwt.claims='+quote(claims)+'; SET ROLE authenticated;'
def call(f,label,s):return sql(auth(f,label)+s)
def members(f):
 e=f['events']['p1'];return json.dumps([{'eventId':e['id'],'lines':[{'accountReference':'100','side':'debit','amountCents':e['amount']},{'accountReference':'200','side':'credit','amountCents':e['amount']}]}])
def prep_sql(f,bid):return f"SELECT public.prepare_finance_batch('{bid}','{f['base']['entity']}','{f['base']['a']}',{quote(f['date'])}::date,'{f['ids']['rules']}',{quote(members(f))}::jsonb);"
def prepared(f):
 bid=str(uuid.uuid4());return json.loads(call(f,'preparer',prep_sql(f,bid)))
def approve_sql(batch,did):return f"SELECT public.decide_finance_batch('{did}','{batch['batch_id']}','approve','{batch['binding_sha256']}');"
def hold(s):
 p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env);p.stdin.write('BEGIN; '+s+"; SELECT 'held';\n");p.stdin.flush()
 while p.stdout.readline().strip()!='held':pass
 return p
def release(p):p.stdin.write('COMMIT;\n\\q\n');p.stdin.flush();p.communicate(timeout=10)
def start(f,label,name,s):
 e=env.copy();e['PGAPPNAME']=name;p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=e);p.stdin.write(auth(f,label)+s+'\n');p.stdin.close();p.stdin=None;return p
def wait(name):
 for _ in range(200):
  if int(sql(f"SELECT count(*) FROM pg_stat_activity WHERE datname='hfa_340_auth_review' AND application_name='{name}' AND wait_event_type='Lock'"))>0:return
  time.sleep(.025)
 raise RuntimeError('Missing expected lock wait '+name)
def finish(p):
 out,err=p.communicate(timeout=30);return p.returncode,out.strip(),err.strip()
def check(ok,label,detail=None):
 if not ok:raise AssertionError(label+': '+str(detail))
 results.append({'case':label,'status':'PASS','detail':detail});print(label,'PASS',flush=True)
def period_key(f):return sql(f"SELECT hashtextextended('finance-period:{f['base']['entity']}:'||to_char({quote(f['date'])}::date,'YYYY-MM'),0)")
def revoke(f,label):sql(f"DELETE FROM auth.sessions WHERE id='{f['actors'][label]['session']}'")
def raw_status(b):return sql(f"SELECT status FROM finance_batches WHERE id='{b}'")
def approvals(b):return int(sql(f"SELECT count(*) FROM finance_batch_decisions WHERE batch_id='{b}' AND action='approve'"))

# Preparation checks authorization after every explicit request/period/control/event wait.
for point in ['request','period','control','event']:
 f=fixture();bid=str(uuid.uuid4());name='batch-prep-'+point
 barrier={'request':f"SELECT pg_advisory_xact_lock(hashtextextended('finance-batch:{bid}',0))",'period':f"SELECT pg_advisory_xact_lock({period_key(f)})",'control':f"SELECT entity_id FROM finance_staging_controls WHERE entity_id='{f['base']['entity']}' FOR UPDATE",'event':f"SELECT id FROM finance_source_events WHERE id='{f['events']['p1']['id']}' FOR UPDATE"}[point]
 h=hold(barrier);p=start(f,'preparer',name,prep_sql(f,bid));wait(name);revoke(f,'preparer');release(h);r=finish(p)
 check(r[0]==3 and 'Current batch authority required' in r[2] and sql(f"SELECT count(*) FROM finance_batches WHERE id='{bid}'")=='0',f'prepare-revoked-at-{point}-wait',{'expectedExit':r[0],'batchRows':0})

# Approval rechecks the actual acting user after request, period, control and batch waits.
for point in ['request','period','control','batch']:
 f=fixture();batch=prepared(f);bid=batch['batch_id'];did=str(uuid.uuid4());name='batch-approve-'+point
 barrier={'request':f"SELECT pg_advisory_xact_lock(hashtextextended('finance-batch-decision:{did}',0))",'period':f"SELECT pg_advisory_xact_lock({period_key(f)})",'control':f"SELECT entity_id FROM finance_staging_controls WHERE entity_id='{f['base']['entity']}' FOR UPDATE",'batch':f"SELECT id FROM finance_batches WHERE id='{bid}' FOR UPDATE"}[point]
 h=hold(barrier);p=start(f,'approver',name,approve_sql(batch,did));wait(name);revoke(f,'approver');release(h);r=finish(p)
 check(r[0]==3 and 'Current batch authority required' in r[2] and approvals(bid)==0 and raw_status(bid)=='prepared',f'approval-revoked-at-{point}-wait',{'expectedExit':r[0],'approvalRows':0})

# Foreign-key persistence wait happens after the initial binding/preparer checks.
for point in ['revoke','expiry']:
 f=fixture();batch=prepared(f);bid=batch['batch_id'];did=str(uuid.uuid4());name='approval-final-'+point
 if point=='expiry':sql(f"UPDATE auth.sessions SET not_after=clock_timestamp()+interval '800 milliseconds' WHERE id='{f['actors']['preparer']['session']}'")
 h=hold(f"SELECT id FROM user_profiles WHERE id='{f['actors']['approver']['id']}' FOR UPDATE");p=start(f,'approver',name,approve_sql(batch,did));wait(name)
 if point=='revoke':revoke(f,'preparer')
 else:time.sleep(1)
 release(h);r=finish(p)
 check(r[0]==3 and 'Batch authority or binding changed during approval' in r[2] and approvals(bid)==0 and raw_status(bid)=='prepared','historical-preparer-'+point+'-at-decision-persistence',{'expectedExit':r[0],'approvalRows':0})

# A control/period trigger can itself wait on batches while invalidating them.
for kind in ['control','period']:
 f=fixture();batch=prepared(f);bid=batch['batch_id'];name='invalidation-nested-'+kind
 sql(f"UPDATE auth.sessions SET not_after=clock_timestamp()+interval '800 milliseconds' WHERE id='{f['actors']['owner']['session']}'")
 h=hold(f"SELECT id FROM finance_batches WHERE id='{bid}' FOR UPDATE")
 if kind=='control':change=f"SELECT public.set_finance_staging_control('{uuid.uuid4()}','{f['base']['entity']}',1,true,NULL,NULL,NULL);"
 else:change=f"INSERT INTO gl_period_closes(organization_id,entity_id,period_year,period_month,status) VALUES('{f['base']['org']}','{f['base']['entity']}',extract(year FROM {quote(f['date'])}::date)::int,extract(month FROM {quote(f['date'])}::date)::int,'closed');"
 p=start(f,'owner',name,change);wait(name);time.sleep(1);release(h);r=finish(p)
 untouched=sql(f"SELECT staging_generation=1 AND NOT stopped FROM finance_staging_controls WHERE entity_id='{f['base']['entity']}'")=='t' if kind=='control' else sql(f"SELECT count(*) FROM gl_period_closes WHERE entity_id='{f['base']['entity']}'")=='0'
 check(r[0]==3 and 'Current batch authority required' in r[2] and raw_status(bid)=='prepared' and untouched,kind+'-invalidation-nested-wait-expiry-rolls-back',{'expectedExit':r[0],'batchStatus':'prepared'})

# Both orderings serialize: an earlier decision is retained, but never remains
# effectively current after a committed stop, rule replacement or period close.
for kind in ['stop','rules','period']:
 for first in ['change','approve']:
  f=fixture();batch=prepared(f);bid=batch['batch_id'];name='batch-race-'+kind+'-'+first
  if kind=='stop':change=f"SELECT public.set_finance_staging_control('{uuid.uuid4()}','{f['base']['entity']}',1,true,NULL,NULL,NULL);"
  elif kind=='rules':change=f"SELECT public.register_finance_batch_rules('{uuid.uuid4()}','{f['base']['entity']}',{quote(json.dumps({'companyReference':'456','accountReferences':['100','200'],'accountingBasis':'accrual','effectiveFrom':'2000-01-01','effectiveTo':'2199-12-31'}))}::jsonb,repeat('c',64),1);"
  else:change=f"INSERT INTO gl_period_closes(organization_id,entity_id,period_year,period_month,status) VALUES('{f['base']['org']}','{f['base']['entity']}',extract(year FROM {quote(f['date'])}::date)::int,extract(month FROM {quote(f['date'])}::date)::int,'closed');"
  barrier=f"SELECT pg_advisory_xact_lock({period_key(f)})" if kind=='period' else f"SELECT entity_id FROM finance_staging_controls WHERE entity_id='{f['base']['entity']}' FOR UPDATE"
  h=hold(barrier);order=[('owner',change),('approver',approve_sql(batch,str(uuid.uuid4())))]
  if first=='approve':order.reverse()
  p=start(f,*[order[0][0],name+'-1',order[0][1]]);wait(name+'-1');q=start(f,*[order[1][0],name+'-2',order[1][1]]);wait(name+'-2');release(h);r,s=finish(p),finish(q)
  snapshot=json.loads(call(f,'owner',f"SELECT public.finance_batch_snapshot('{bid}');"));expected=0 if first=='change' else 1
  check(r[0]==s[0]==0 and raw_status(bid)=='invalidated' and snapshot['batch']['status']=='invalidated' and not snapshot['dispatch_enabled'] and approvals(bid)==expected,kind+'-versus-approval-'+first+'-first',{'approvalRows':expected,'finalStatus':'invalidated'})

source=base/'f03-340-auth-source.sql';report={'review':'340 authorization/concurrency/period/control invalidation','candidateSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'target':'run-owned Unix socket55447/hfa_340_auth_review','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'result':'PASS','cases':results,'skips':0};(base/'f03-340-auth-concurrency.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'result':'PASS','cases':len(results),'candidateSHA256':report['candidateSHA256']}))
