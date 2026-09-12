import { createHash, createHmac } from 'node:crypto';
import { validateQboWebhook } from '/Users/brianlewis/Circle of Life/Haven Finance Integration/supabase/functions/_shared/qbo-webhook.ts';
const key='independent-synthetic-verifier';
const enc=new TextEncoder();
let seed=0x342342;
function random(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;}
function value(depth=0){
  const kind=depth>5?random(4):random(6);
  if(kind===0)return null;
  if(kind===1)return random(2)===1;
  if(kind===2)return (random(100000)-50000)/100;
  if(kind===3)return ['quoted " \\ string','café 🧾 患者','\n\t','', 'escaped \u0000 text'][random(5)];
  if(kind===4)return Array.from({length:random(5)},()=>value(depth+1));
  const o=Object.create(null);for(let i=0;i<random(6);i++)o['key-'+i+'-'+random(100)]=value(depth+1);return o;
}
const event=(id,data)=>({specversion:'1.0',id,source:'opaque/source',type:'qbo.invoice.updated.v1',intuitentityid:'1',intuitaccountid:'123',time:'2026-09-09T04:00:00.123456789Z',data});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function check(raw){const body=enc.encode(raw);return {body,result:await validateQboWebhook({body,verifierToken:key,headers:[['content-type','application/json'],['intuit-signature',createHmac('sha256',key).update(body).digest('base64')]]})};}
const cases=[];
for(let i=0;i<300;i++){
 const raw=JSON.stringify([event('generated-'+i,{nested:value()})],null,i%3);
 const {body,result}=await check(raw);
 if(!result.ok)throw Error('Generated valid JSON rejected at case '+i+': '+result.code);
 const range=result.privateMetadata.eventByteRanges[0];
 if(result.evidence.body_sha256!==hash(body)||result.privateMetadata.events[0].event_bytes_sha256!==hash(body.slice(range.start,range.end)))throw Error('Independent byte digest mismatch at case '+i);
 cases.push({name:'generated-json-'+i,status:'PASS'});
}
for(const token of ['01','--1','+.1','.1','1.','1e','1e+','truefalse','NaN','Infinity','undefined','{x:1}','{"a":1,}','[1,]']){
 const raw=JSON.stringify([event('invalid',{x:null})]).replace('"x":null','"x":'+token);
 let nodeRejected=false;try{JSON.parse(raw)}catch{nodeRejected=true}
 if(!nodeRejected)throw Error('Invalid fixture is not invalid');
 const {result}=await check(raw);
 if(result.ok||!result.authenticated||result.code!=='invalid_json')throw Error('Malformed JSON classification mismatch');
 cases.push({name:'invalid-json-token-'+token,status:'PASS'});
}
const report={schema_version:1,status:'PASS',seed:'0x342342',cases,counts:{passed:cases.length,failed:0,skipped:0},limits:['Independent synthetic HMAC/JSON/byte-range corpus; no provider, receiver or durable-inbox proof']};
await Deno.writeTextFile('/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/webhook-independent/result.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,counts:report.counts}));
