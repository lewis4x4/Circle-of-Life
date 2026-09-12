#!/usr/bin/env python3
"""Owned native metadata concurrency. Never provisions Vault or real credentials."""
import concurrent.futures, datetime, hashlib, json, pathlib, subprocess, time, uuid
import psycopg
R=pathlib.Path('/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/credentials-342')
SOCKET=str(R.parent); DB='hfa_credentials_342_races'; BIN='/opt/homebrew/opt/postgresql@17/bin/'
manifest=json.loads((R/'manifest.private.json').read_text()); manifest['race_database']=DB
for name in ['concurrency.py','concurrency.json']:
 if str(R/name) not in manifest['paths']: manifest['paths'].append(str(R/name))
(R/'manifest.private.json').write_text(json.dumps(manifest,indent=2))
subprocess.run([BIN+'createdb','-h',SOCKET,'-p','55447','-U','postgres','-T','hfa_credentials_342_dev',DB],check=True)
def connection(): return psycopg.connect(host=SOCKET,port=55447,user='postgres',dbname=DB,autocommit=True)
u=lambda:str(uuid.uuid4())
org,entity,owner,session,worker,lineage,connection_id,candidate,secret,observation=[u() for _ in range(10)]
setup=connection()
setup.execute('INSERT INTO public.organizations(id,name) VALUES(%s,%s)',(org,'Synthetic342 race organization'))
setup.execute('INSERT INTO public.entities(id,organization_id,name) VALUES(%s,%s,%s)',(entity,org,'Synthetic342 race entity'))
setup.execute('INSERT INTO auth.users(id,email) VALUES(%s,%s)',(owner,owner+'@synthetic.invalid'))
setup.execute("INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active) VALUES(%s,%s,%s,'Synthetic race owner','owner',true)",(owner,org,owner+'@synthetic.invalid'))
setup.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,owner))
version=setup.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s',(owner,)).fetchone()[0]
human={'role':'authenticated','sub':owner,'session_id':session,'auth_claim_version':version}
setup.execute('SELECT set_config(\'request.jwt.claims\',%s,false)',(json.dumps(human),)); setup.execute('SET ROLE authenticated')
data={'provider':'qbo','environment':'sandbox','company_reference':'123','client_identity_sha256':'a'*64,'app_config_sha256':'b'*64,'expected_connection_id':None}
result=setup.execute('SELECT public.finance_credential_control(%s,%s,\'bind\',%s::jsonb)',(connection_id,entity,json.dumps(data))).fetchone()[0]; lineage=result['lineage_id']
setup.execute('SELECT public.finance_credential_control(%s,%s,\'worker\',%s::jsonb)',(u(),entity,json.dumps({'lineage_id':lineage,'worker_id':worker,'expected_epoch':0,'active':True})))
setup.execute('RESET ROLE')
# No Vault stub or secret body is present. Metadata preconditions only; these
# rows are synthetic and do not prove provider identity or encryption.
setup.execute("UPDATE public.finance_credential_lineages SET stopped=false,state='ready' WHERE id=%s",(lineage,))
setup.execute("UPDATE public.finance_staging_controls SET stopped=false WHERE entity_id=%s",(entity,))
epoch,fence=setup.execute('SELECT connection_epoch,fence_epoch FROM public.finance_credential_lineages WHERE id=%s',(lineage,)).fetchone()
context=setup.execute('SELECT haven.finance_credential_context(%s)',(lineage,)).fetchone()[0]
setup.execute("INSERT INTO public.finance_credential_candidates(id,lineage_id,vault_secret_id,connection_epoch,fence_epoch,input_revision,context_sha256,origin) VALUES(%s,%s,%s,%s,%s,0,%s,'sandbox_seed')",(candidate,lineage,secret,epoch,fence,context))
setup.execute("INSERT INTO public.finance_credential_revisions(lineage_id,revision,candidate_id,connection_epoch,access_expires_at,refresh_expires_at) VALUES(%s,1,%s,%s,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",(lineage,candidate,epoch))
setup.execute("INSERT INTO public.finance_credential_identity_observations(id,candidate_id,worker_id,worker_epoch,company_reference,client_identity_sha256,accounting_host,response_evidence_sha256) VALUES(%s,%s,%s,1,'123',%s,'https://sandbox-quickbooks.api.intuit.com',%s)",(observation,candidate,worker,'a'*64,'c'*64))
setup.execute('UPDATE public.finance_credential_lineages SET current_candidate_id=%s,credential_revision=1 WHERE id=%s',(candidate,lineage))
def claims(exp=None):
 now=int(time.time()); return {'role':'haven_finance_worker','sub':worker,'hfa_org':org,'iss':'urn:haven:finance-worker:v1','aud':'haven-finance-credentials','purpose':'finance_refresh','worker_epoch':1,'iat':now,'exp':exp or now+240}
def call(identity, name, token=None):
 c=connection(); c.execute('SET application_name TO '+"'"+name+"'"); c.execute('SELECT set_config(\'request.jwt.claims\',%s,false)',(json.dumps(token or claims()),)); c.execute('SET ROLE haven_finance_worker')
 try: return {'result':c.execute('SELECT public.claim_finance_refresh(%s,%s)',(identity,lineage)).fetchone()[0]}
 except psycopg.Error as e: return {'sqlstate':e.sqlstate,'message':e.diag.message_primary}
 finally:c.close()
def clear_claim():
 setup.execute("UPDATE public.finance_credential_lineages SET active_attempt_id=NULL,state='ready',stopped=false WHERE id=%s",(lineage,))
def blocked(names):
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  n=setup.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND application_name=ANY(%s) AND wait_event='advisory'",(DB,names)).fetchone()[0]
  if n==len(names):return True
  time.sleep(.025)
 raise AssertionError('Did not observe all advisory lock waits')
results=[]
locker=connection()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 def lock():locker.execute('BEGIN'); locker.execute("SELECT pg_advisory_xact_lock(hashtextextended('finance-credential-org:'||%s,0))",(org,))
 def unlock():locker.execute('COMMIT')
 lock(); identity=u(); fs=[pool.submit(call,identity,'same_'+str(i)) for i in range(2)]; blocked(['same_0','same_1']); unlock(); values=[f.result() for f in fs]
 assert all(v.get('result',{}).get('status')=='claimed' for v in values),values
 assert setup.execute('SELECT count(*) FROM public.finance_refresh_attempts WHERE id=%s',(identity,)).fetchone()[0]==1
 results.append({'case':'simultaneous-identical-claims-one-attempt','pass':True,'observed_waiters':2})
 clear_claim(); lock(); ids=[u(),u()]; fs=[pool.submit(call,ids[i],'distinct_'+str(i)) for i in range(2)]; blocked(['distinct_0','distinct_1']); unlock(); values=[f.result() for f in fs]
 assert sorted(v['result']['status'] for v in values)==['blocked_existing_attempt','claimed'],values
 results.append({'case':'simultaneous-distinct-claims-one-lineage-authority','pass':True,'observed_waiters':2})
 clear_claim(); lock(); f=pool.submit(call,u(),'revoked'); blocked(['revoked']); setup.execute('UPDATE public.finance_credential_workers SET active=false WHERE id=%s',(worker,)); unlock(); value=f.result(); assert value.get('sqlstate')=='42501',value
 results.append({'case':'revoke-worker-while-org-lock-waiting','pass':True,'sqlstate':value['sqlstate']}); setup.execute('UPDATE public.finance_credential_workers SET active=true WHERE id=%s',(worker,))
 clear_claim(); lock(); token=claims(int(time.time())+1); f=pool.submit(call,u(),'expired',token); blocked(['expired']); time.sleep(1.1); unlock(); value=f.result(); assert value.get('sqlstate')=='42501',value
 results.append({'case':'expire-worker-jwt-during-org-lock-wait','pass':True,'sqlstate':value['sqlstate']})
 clear_claim(); setup.execute('BEGIN'); setup.execute('SELECT 1 FROM public.finance_staging_controls WHERE entity_id=%s FOR UPDATE',(entity,)); f=pool.submit(call,u(),'stopped')
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  wait=locker.execute("SELECT wait_event_type FROM pg_stat_activity WHERE datname=%s AND application_name='stopped'",(DB,)).fetchone()
  if wait and wait[0]=='Lock':break
  time.sleep(.025)
 else:raise AssertionError('No control lock wait observed')
 setup.execute('UPDATE public.finance_staging_controls SET stopped=true WHERE entity_id=%s',(entity,)); setup.execute('COMMIT'); value=f.result(); assert value.get('sqlstate')=='42501',value
 results.append({'case':'stop-control-wins-before-claim','pass':True,'sqlstate':value['sqlstate']})
 # Global physical-grant ownership uses the unique-index wait across org locks.
 org2,entity2,owner2,session2,entity1b=[u() for _ in range(5)]
 setup.execute('INSERT INTO public.organizations(id,name) VALUES(%s,%s)',(org2,'Synthetic second grant owner'))
 setup.execute('INSERT INTO public.entities(id,organization_id,name) VALUES(%s,%s,%s),(%s,%s,%s)',(entity2,org2,'Synthetic second-org entity',entity1b,org,'Synthetic first-org shared key entity'))
 setup.execute('INSERT INTO auth.users(id,email) VALUES(%s,%s)',(owner2,owner2+'@synthetic.invalid'))
 setup.execute("INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active) VALUES(%s,%s,%s,'Synthetic other owner','owner',true)",(owner2,org2,owner2+'@synthetic.invalid'))
 setup.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session2,owner2))
 v2=setup.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s',(owner2,)).fetchone()[0]
 human2={'role':'authenticated','sub':owner2,'session_id':session2,'auth_claim_version':v2}
 def bind(target,token,name,company):
  c=connection();c.execute('SET application_name TO '+"'"+name+"'");c.execute("SELECT set_config('request.jwt.claims',%s,false)",(json.dumps(token),));c.execute('SET ROLE authenticated')
  doc={'provider':'qbo','environment':'sandbox','company_reference':company,'client_identity_sha256':'d'*64,'app_config_sha256':'e'*64,'expected_connection_id':None}
  try:return {'result':c.execute("SELECT public.finance_credential_control(%s,%s,'bind',%s::jsonb)",(u(),target,json.dumps(doc))).fetchone()[0]}
  except psycopg.Error as e:return {'sqlstate':e.sqlstate,'message':e.diag.message_primary}
  finally:c.close()
 def wait_index(names):
  deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   count=setup.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND application_name=ANY(%s) AND wait_event='transactionid'",(DB,names)).fetchone()[0]
   if count==len(names):return
   time.sleep(.025)
  raise AssertionError('No unique-index transaction wait observed')
 locker.execute('BEGIN');locker.execute("INSERT INTO public.finance_credential_lineages(organization_id,provider,environment,company_reference,client_identity_sha256,app_config_sha256) VALUES(%s,'qbo','sandbox','789',%s,%s)",(org,'d'*64,'e'*64))
 fs=[pool.submit(bind,entity1b,human,'physical_owner_1','789'),pool.submit(bind,entity2,human2,'physical_owner_2','789')]
 wait_index(['physical_owner_1','physical_owner_2']);locker.execute('COMMIT');values=[f.result() for f in fs]
 assert values[0].get('result',{}).get('lineage_id') and values[1]=={'sqlstate':'42501','message':'Credential grant unavailable'},values
 assert setup.execute("SELECT count(*) FROM public.finance_credential_lineages WHERE company_reference='789' AND client_identity_sha256=%s",('d'*64,)).fetchone()[0]==1
 results.append({'case':'two-org-global-physical-grant-owner-index-wait','pass':True,'observed_waiters':2,'second_owner_sqlstate':'42501'})
 entity1c=u();setup.execute('INSERT INTO public.entities(id,organization_id,name) VALUES(%s,%s,%s)',(entity1c,org,'Synthetic revoked-owner entity'))
 locker.execute('BEGIN');locker.execute("INSERT INTO public.finance_credential_lineages(organization_id,provider,environment,company_reference,client_identity_sha256,app_config_sha256) VALUES(%s,'qbo','sandbox','790',%s,%s)",(org,'d'*64,'e'*64))
 f=pool.submit(bind,entity1c,human,'revoked_after_unique_wait','790');wait_index(['revoked_after_unique_wait']);setup.execute('DELETE FROM auth.sessions WHERE id=%s',(session,));locker.execute('COMMIT');value=f.result();assert value.get('sqlstate')=='42501',value
 assert setup.execute('SELECT count(*) FROM public.finance_connection_bindings WHERE entity_id=%s',(entity1c,)).fetchone()[0]==0
 results.append({'case':'human-session-revoke-during-global-unique-wait','pass':True,'observed_waiters':1,'sqlstate':'42501'})
# source hashes and bounded evidence; never serialize tokens or raw bodies.
report={'status':'PASS','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'database':DB,'scope':'Native PostgreSQL metadata concurrency; no Vault schema/API, no secret values, no gateway/provider proof','cases':results,'migration_sha256':hashlib.sha256((R/'migration.sql').read_bytes()).hexdigest(),'driver_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
(R/'concurrency.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps({'status':'PASS','cases':len(results)}))
locker.close();setup.close()
