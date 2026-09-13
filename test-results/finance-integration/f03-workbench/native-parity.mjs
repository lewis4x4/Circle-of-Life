import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import reader from '/Users/brianlewis/Circle of Life/Haven Finance Integration/src/lib/finance-integration/review-queue.ts';
const root='/Users/brianlewis/Circle of Life/Haven Finance Integration';
const folder='/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/workbench-341';
const socket='/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sourceHash=hash(folder+'/migration.sql');
const setup=fs.readFileSync(root+'/supabase/tests/review_finance_batch_approval.sql','utf8').split('-- ASSERTIONS_BEGIN')[0];
const sql=setup+`
SELECT public.prepare_finance_batch((SELECT id FROM bi WHERE label='main'),entity,a,current_date,(SELECT id FROM bi WHERE label='rules'),pg_temp.batch_members(ARRAY['p1','p2'])) FROM bf;
INSERT INTO bd SELECT 'queue_first',public.finance_review_queue(entity,a,'events',NULL,NULL,1) FROM bf;
SELECT 'NATIVE_QUEUE:'||jsonb_build_object('scope',jsonb_build_object('organizationId',org,'entityId',entity,'facilityId',a),'batchId',(SELECT id FROM bi WHERE label='main'),
 'events',(SELECT document FROM bd WHERE label='queue_first'),
 'eventContinuation',public.finance_review_queue(entity,a,'events',(SELECT document#>>'{next_cursor,created_at}' FROM bd WHERE label='queue_first')::timestamptz,(SELECT document#>>'{next_cursor,id}' FROM bd WHERE label='queue_first')::uuid,1),
 'batches',public.finance_review_queue(entity,a,'batches',NULL,NULL,100),
 'rules',public.finance_review_queue(entity,a,'rules',NULL,NULL,100),
 'detail',public.finance_batch_snapshot((SELECT id FROM bi WHERE label='main')))::text FROM bf;
ROLLBACK;
`;
const result=spawnSync('psql',['-h',socket,'-p','55447','-U','postgres','-d','hfa_queue_341_review_01a08335','-X','-A','-t','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
const raw=JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('NATIVE_QUEUE:')).slice('NATIVE_QUEUE:'.length));
const cases=[];
for(const kind of ['events','batches','rules']){
 const parsed=reader.parseReviewPage(raw[kind],{...raw.scope,kind,cursor:null,limit:kind==='events'?1:100});
 cases.push({name:'native-'+kind+'-page-parity',status:parsed.items.length>0?'PASS':'FAIL',rows:parsed.items.length});
}
const next=reader.parseReviewPage(raw.eventContinuation,{...raw.scope,kind:'events',cursor:raw.events.next_cursor,limit:1});
cases.push({name:'native-keyset-continuation-parity',status:next.items.length===1&&next.items[0].id!==raw.events.items[0].id?'PASS':'FAIL'});
const detail=reader.parseReviewDetail(raw.detail,raw.scope,raw.batchId);
cases.push({name:'native-detail-parity-and-session-redaction',status:detail.members.length===2&&detail.batch.payload.lines[0].amountCents==='4000000000'&&!('preparer_session_id' in detail.batch)&&detail.decision_history.every(row=>!('actor_session_id' in row))?'PASS':'FAIL',members:detail.members.length});
const report={schema_version:1,status:cases.every(row=>row.status==='PASS')?'PASS':'FAIL',cases,migration_sha256:sourceHash,reader_sha256:hash(root+'/src/lib/finance-integration/review-queue.ts'),driver_sha256:hash(new URL(import.meta.url)),timestamp:new Date().toISOString(),limits:['Actual nativeSQL RPC results with synthetic Auth stubs; no GoTrue/PostgREST/browser/provider proof.']};
fs.writeFileSync(folder+'/native-parity.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,cases:cases.length,artifact:folder+'/native-parity.json'}));
process.exitCode=report.status==='PASS'?0:1;
