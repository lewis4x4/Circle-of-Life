#!/usr/bin/env python3
"""Reviewed fresh Finance fixture HTTP only; no network at import."""
import argparse,base64,datetime,hashlib,json,os,pathlib,urllib.request,urllib.error,urllib.parse
from guarded import Runtime,OUT,REF,NoRedirect,require
PRIVATE=pathlib.Path.home()/'.config/haven-staging/col157-fixture.json'
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['exercise','deny']);p.add_argument('--ready',required=True);args=p.parse_args()
 r=Runtime(args.ready,stage=True);r.identify();require(PRIVATE.stat().st_mode&0o077==0,'Private fixture required');state=json.loads(PRIVATE.read_text())
 require(state['target']==REF and state['sourceSha']==r.ready['sourceSha'] and state['run'].startswith('col157-') and not state.get('cleaned'),'Fresh exact-source fixture required')
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
  require((parsed.scheme,parsed.netloc) in [('http','127.0.0.1:4357'),('https',REF+'.supabase.co')],'Unexpected credential-bearing target')
  headers={};data=body if binary else json.dumps(body).encode() if body is not None else None
  if not signed:
   session=state['sessions'][actor];require(session['expires_at']>datetime.datetime.now().timestamp(),'Expired fixture session')
   if parsed.netloc=='127.0.0.1:4357':
    raw='base64-'+base64.urlsafe_b64encode(json.dumps(session,separators=(',',':')).encode()).decode().rstrip('=');name='sb-'+REF+'-auth-token'
    headers['Cookie']='; '.join(name+('.'+str(i//3180) if len(raw)>3180 else '')+'='+raw[i:i+3180] for i in range(0,len(raw),3180))
   else:headers.update(apikey=r.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],Authorization='Bearer '+session['access_token'])
  if body is not None:headers['Content-Type']='application/pdf' if binary else 'application/json'
  try:
   with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url,data=data,method=method,headers=headers),timeout=90) as response:status=response.status;payload=response.read()
  except urllib.error.HTTPError as e:status=e.code;payload=e.read()
  require(status in expected,'Unexpected HTTP'+str(status)+' at '+parsed.path)
  return (status,payload) if signed else (status,json.loads(payload))
 def api(body=None,actor='owner',suffix=''):
  query=urllib.parse.urlencode({'task_id':state['task'],**state['period']})
  return request(r.app+'/api/admin/operations/finance-sources'+('/reconcile' if body else '?'+query)+suffix,actor,body,'POST' if body else 'GET')[1]
 def reconcile(key):return api({'task_id':state['task'],**state['period'],'request_key':state['run']+'-'+key})
 def family(reply,name):return next(row for row in reply['families'] if row['family']==name)
 def literal(value):return "'"+str(value).replace("'","''")+"'"
 def native_hashes():
  tables=['payments','payment_allocations','finance_command_receipts','finance_source_events','invoices','census_daily_log','resident_trust_accounts','resident_trust_transactions','trust_account_entries','finance_batches']
  hashes={}
  for table in tables:
   hashes[table]=r.sql('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),\'[]\'::jsonb)::text) FROM public.'+table+' x WHERE organization_id='+literal(state['org']))
  hashes['finance_batch_members']=r.sql('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),\'[]\'::jsonb)::text) FROM public.finance_batch_members x WHERE batch_id='+literal(state['batch']))
  return hashes
 if args.action=='exercise':
  baseline=native_hashes();initial=checkpoint('snapshot_a',lambda:reconcile('a'))
  again=reconcile('a');same=reconcile('same')
  require(initial['source_version']==again['source_version']==same['source_version'] and len(initial['history'])==len(again['history'])==len(same['history'])==1,'Unchanged source duplicated history')
  require(native_hashes()==baseline,'HFO read/reconcile changed native records')
  payment=next(row for row in family(initial,'payments')['records'] if row['id']==state['payment'])
  require(payment['economic_date']==state['period']['start_date'] and payment['service_period_start']==state['service_period']['start_date'] and payment['service_period_end']==state['service_period']['end_date'] and payment['recorded_at'][:10]!=payment['economic_date'],'Late payment date axes conflated')
  require(family(initial,'census')['missing_dates']==[state['period']['end_date']],'Missing census date not explicit')
  trust=family(initial,'trust')['records'];require(any(row['state']=='canonical_trust_account' and row['metrics']['canonical_balance_cents']=='500' for row in trust) and any(row['state']=='legacy_trust_entry_context' and row['metrics']['legacy_balance_cents']=='900' for row in trust),'Canonical/legacy trust separation absent')
  handoff=next(row for row in family(initial,'finance_handoff')['records'] if row['id']==state['batch']);require(handoff['state']=='prepared' and handoff['metrics']['external_acknowledgment']=='unavailable' and handoff['metrics']['dispatch_enabled'] is False,'Prepared local batch finality misrepresented')
  checkpoint('census_b',lambda:r.sql('UPDATE public.census_daily_log SET occupied_beds=11,available_beds=9,occupancy_rate=0.55 WHERE id='+literal(state['census'])+' AND organization_id='+literal(state['org'])))
  changed=checkpoint('snapshot_b',lambda:reconcile('b'));require(len(changed['history'])==2 and changed['source_version']!=initial['source_version'],'Census correction not linked once')
  checkpoint('census_a_again',lambda:r.sql('UPDATE public.census_daily_log SET occupied_beds=10,available_beds=10,occupancy_rate=0.5 WHERE id='+literal(state['census'])+' AND organization_id='+literal(state['org'])))
  restored=checkpoint('snapshot_a_again',lambda:reconcile('a-again'));require(len(restored['history'])==3 and restored['source_version']==initial['source_version'],'A B A source history lost')
  require(len(reconcile('a-again')['history'])==3,'Repeat A transition duplicated')
  require(native_hashes()==baseline,'Native immutable finance identities changed during source correction proof')
  def stop_native_control():
   claims=json.loads(base64.urlsafe_b64decode(state['sessions']['owner']['access_token'].split('.')[1]+'=='))
   return r.sql('BEGIN; SET LOCAL ROLE authenticated; SELECT set_config(\'request.jwt.claims\','+literal(json.dumps(claims))+',true); SELECT public.set_finance_staging_control('+literal(state['stop_control'])+','+literal(state['entity'])+',1,true,NULL,NULL,NULL); COMMIT;')
  checkpoint('local_control_stopped',stop_native_control)
  invalidated=checkpoint('snapshot_invalidated',lambda:reconcile('invalidated'));batch=next(row for row in family(invalidated,'finance_handoff')['records'] if row['id']==state['batch']);require(len(invalidated['history'])==4 and batch['state']=='invalidated' and batch['metrics']['external_acknowledgment']=='unavailable','Stopped local batch misrepresented')
  state['httpProofPassed']=True;save();(OUT/'http-proof.json').write_text(json.dumps({'result':'PASS','sourceSha':state['sourceSha'],'target':REF,'sourceHistoryCounts':[1,2,3,4],'nativeHashComparison':'PASS','latePaymentEconomicDate':payment['economic_date'],'servicePeriod':[payment['service_period_start'],payment['service_period_end']],'recordedAt':payment['recorded_at'],'missingCensusDates':family(initial,'census')['missing_dates'],'canonicalTrustCents':'500','separateLegacyCents':'900','localBatchState':handoff['state'],'laterLocalBatchState':batch['state'],'externalAcknowledgment':'unavailable','nativePerformanceCreatedByHFO':False},indent=2)+'\n')
 else:
  require(state.get('httpProofPassed'),'Positive proof missing')
  _,workspace=request(r.app+'/api/admin/operations/workspace?'+urllib.parse.urlencode({'facility_id':state['site'],'view':'today','mine':'0'}),'limited')
  require(not workspace['partial'] and any(item.get('occurrence',{}).get('id')==state['task'] for group in workspace['groups'].values() if isinstance(group,list) for item in group),'Native-denied actor cannot read positive HFO task')
  limited=api(actor='limited');require(family(limited,'payments')['availability']=='unavailable' and not family(limited,'payments')['records'],'Native finance records leaked')
  wrong_status,_=request(r.app+'/api/admin/operations/workspace?'+urllib.parse.urlencode({'facility_id':state['other_site'],'view':'today'}),expected=(403,404))
  checkpoint('site_revoked',lambda:r.sql('UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id='+literal(state['users']['owner'])+' AND facility_id='+literal(state['site'])+' AND revoked_at IS NULL'))
  revoked,_=request(r.app+'/api/admin/operations/finance-sources?'+urllib.parse.urlencode({'task_id':state['task'],**state['period']}),expected=(401,403,404))
  (OUT/'denial-proof.json').write_text(json.dumps({'result':'PASS','limitedHfoTaskPositive':True,'nativeFinanceUnavailable':True,'wrongSiteStatus':wrong_status,'revokedStatus':revoked},indent=2)+'\n')
if __name__=='__main__':main()
