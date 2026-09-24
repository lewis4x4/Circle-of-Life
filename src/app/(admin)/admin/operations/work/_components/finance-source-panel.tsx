"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { financeSourceMap } from "@/lib/operations/finance-source-map";
import { financeSourcePeriodSchema, financeSourcesReplySchema, type FinanceSourcesReply } from "@/lib/operations/finance-sources";
import { decimalAmount } from "@/lib/finance-integration/payload";
import { CONTROL } from "./work-inputs";
import { enumLabel } from "@/lib/display/enum-label";
const names = { census: "Daily census snapshots", payments: "Recorded payment context", trust: "Trust source context", finance_handoff: "Local finance handoff" };
const metricNames: Record<string,string> = { total_licensed_beds:"Licensed beds",occupied_beds:"Occupied beds",available_beds:"Available beds",hold_beds:"Hold beds",maintenance_beds:"Maintenance beds",admissions_today:"Recorded admissions count",discharges_today:"Recorded discharges count",allocated_cents:"Allocated amount",unapplied_cents:"Unapplied amount",invoice_id:"Invoice reference",account_id:"Trust account reference",direction:"Movement direction",canonical_balance_cents:"Canonical balance",legacy_balance_cents:"Legacy balance (separate, not added)",legacy_review_required:"Legacy review required",external_reconciliation:"External reconciliation",dispatch_enabled:"Dispatch enabled",accounting_classification:"Accounting classification",external_acknowledgment:"External acknowledgment" };
type Props={taskId:string;activityKey:string|null|undefined;facilityId:string;actorId:string;subjectId:string|null};
export function FinanceSourcePanel(props:Props){
 if(!financeSourceMap.some(row=>row.key===props.activityKey))return null;
 return <PeriodPanel key={`${props.taskId}:${props.activityKey}:${props.facilityId}:${props.actorId}:${props.subjectId}`} {...props}/>;
}
function PeriodPanel(props:Props){
 const [opened,setOpened]=useState(false),[start,setStart]=useState(""),[end,setEnd]=useState(""),[locked,setLocked]=useState(false);
 const valid=financeSourcePeriodSchema.safeParse({task_id:props.taskId,start_date:start,end_date:end}).success;
 return <details onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary className={`${CONTROL} cursor-pointer`}>Finance and census source context</summary>
 {opened?<div role="group" aria-label="Finance and census source context" className="space-y-3 pt-3">
  <p>Source context only. Refresh does not record payments, deposits, census changes, billable days, human review or external acknowledgment.</p>
  <label className="block">Source period start<input className={CONTROL} type="date" value={start} disabled={locked} onChange={event=>setStart(event.target.value)}/></label>
  <label className="block">Source period end<input className={CONTROL} type="date" value={end} disabled={locked} onChange={event=>setEnd(event.target.value)}/></label>
  <p>Choose 1–366 inclusive facility-calendar days. Economic dates, service periods and recording times remain separate.</p>
  <details><summary className={`${CONTROL} cursor-pointer`}>All 22 source items and 27 components</summary><ul>{financeSourceMap.map(row=><li key={row.key}>{row.sourceId} · {row.label} · {enumLabel(row.kind, { case: "lower" })}. {row.gap}</li>)}</ul></details>
  {valid?<Sources key={`${start}:${end}`} {...props} start={start} end={end} onLock={setLocked}/>:<p>Select a valid explicit period to read source context.</p>}
 </div>:null}</details>;
}
function Sources({taskId,activityKey,facilityId,start,end,onLock}:Props&{start:string;end:string;onLock:(value:boolean)=>void}){
 const [data,setData]=useState<FinanceSourcesReply|null>(null),[error,setError]=useState(""),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const active=useRef(true),sending=useRef(false),generation=useRef(0),read=useRef<AbortController|null>(null),command=useRef<AbortController|null>(null);
 useEffect(()=>{active.current=true;return()=>{active.current=false;read.current?.abort();command.current?.abort();onLock(false);};},[onLock]);
 const validate=useCallback((raw:unknown)=>{const reply=financeSourcesReplySchema.parse(raw);const keys=reply.fields.map(row=>row.component_key);if(reply.task_id!==taskId||reply.activity_key!==activityKey||reply.facility_id!==facilityId||reply.start_date!==start||reply.end_date!==end||new Set(keys).size!==27||financeSourceMap.some(row=>!keys.includes(row.key)))throw Error("Wrong scope");for(const family of reply.families)for(const record of family.records){if(record.amount_cents!==null)decimalAmount(record.amount_cents);for(const [key,value] of Object.entries(record.metrics))if(key.endsWith("_cents")&&typeof value==="string")decimalAmount(value);}return reply;},[taskId,activityKey,facilityId,start,end]);
 useEffect(()=>{
  const controller=new AbortController();read.current=controller;const version=++generation.current;
  void fetch(`/api/admin/operations/finance-sources?${new URLSearchParams({task_id:taskId,start_date:start,end_date:end})}`,{credentials:"same-origin",cache:"no-store",signal:controller.signal}).then(async response=>{if(!response.ok)throw Error("Unavailable");const reply=validate(await response.json());if(active.current&&!controller.signal.aborted&&version===generation.current)setData(reply);}).catch(()=>{if(active.current&&!controller.signal.aborted&&version===generation.current){setData(null);setError("Current finance sources unavailable. No zero balance or complete coverage can be inferred.");}});
  return()=>controller.abort();
 },[taskId,activityKey,facilityId,start,end,attempt,validate]);
 async function reconcile(body:string){
  if(sending.current)return;sending.current=true;read.current?.abort();generation.current++;onLock(true);setBusy(true);setPending(body);setData(null);setError("");command.current=new AbortController();
  try{const response=await fetch('/api/admin/operations/finance-sources/reconcile',{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body,signal:command.current.signal});if(!active.current)return;
   if(!response.ok){if(response.status<500&&![408,429].includes(response.status)){setPending(null);onLock(false);setError("Source refresh rejected. Check the current period and access before retrying.");return;}throw Error("Unknown");}
   const reply=validate(await response.json());if(!active.current)return;setPending(null);onLock(false);setData(reply);
  }catch{if(active.current){setData(null);setError("Refresh result unknown. Keep this period and retry the same request.");}}finally{sending.current=false;if(active.current)setBusy(false);}
 }
 return <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">{error?<p role="alert">{error}</p>:null}{busy?<p role="status">Refreshing source context…</p>:null}
 {pending?<button type="button" className={CONTROL} disabled={busy} onClick={()=>void reconcile(pending)}>Retry same finance source refresh</button>:<><button type="button" className={CONTROL} onClick={()=>{setData(null);setError("");setAttempt(n=>n+1);}}>Reload finance sources</button>{data?<button type="button" className={CONTROL} onClick={()=>void reconcile(JSON.stringify({task_id:taskId,start_date:start,end_date:end,request_key:crypto.randomUUID()}))}>Refresh and record finance source changes</button>:null}</>}
 {data?<><p>Period {data.start_date} through {data.end_date} · {data.timezone}. No source state grants approval or payment-in-full status.</p>
 {data.families.map(family=><details key={family.family}><summary className={`${CONTROL} cursor-pointer`}>{names[family.family]}</summary><p>{family.reason}</p>
 {family.availability!=="available"?<p>Unavailable under current native scope. Missing sources are not zero.</p>:<>
 {family.family==="census"?<p>Recorded snapshot counts are not physical presence or billable days. No native final approval or reviewer is asserted.</p>:null}
 {family.family==="payments"?<p>Recorded payment and allocation are internal source facts, not bank-cleared funds, a deposit, full first-month satisfaction or an external receipt.</p>:null}
 {family.family==="trust"?<p>Canonical and legacy amounts are separate. No historical opening balance or bank reconciliation is established.</p>:null}
 {family.family==="finance_handoff"?<p>Prepared or locally approved is not submitted or externally acknowledged.</p>:null}
 <p>{family.missing_dates.length?`Missing source dates: ${family.missing_dates.join(", ")}`:"No missing dates reported for this source family; this is not overall checklist coverage."}</p>
 {family.records.length===0?<p>No eligible source records returned for this explicit period.</p>:<ul className="space-y-3">{family.records.map(record=><li key={`${record.id}:${record.version}`}>
 <p>Native state: {enumLabel(record.state, { case: "lower" })} · Version {record.version.slice(0,12)}</p>{record.native_version?<p>Native source version: {record.native_version}</p>:null}<p>Economic / source date: {record.economic_date??"Unknown"}</p><p>Service period: {record.service_period_start??"Unknown"} to {record.service_period_end??"Unknown"}</p><p>Recorded at: {record.recorded_at??"Unknown"}</p>
 {record.amount_cents!==null?<p>Native amount: ${decimalAmount(record.amount_cents)}</p>:null}
 <ul>{Object.entries(record.metrics).map(([key,value])=><li key={key}>{metricNames[key]}: {value===null?"Unknown":key.endsWith("_cents")&&typeof value==="string"?`$${decimalAmount(value)}`:enumLabel(String(value), { case: "lower" })}</li>)}</ul>
 </li>)}</ul>}
 </>}</details>)}
 <details><summary className={`${CONTROL} cursor-pointer`}>Finance source change history</summary><p>{data.history_complete?"Complete available source history.":"Latest 100 source changes only; earlier history is not included."}</p><ul>{data.history.map(row=><li key={row.id}>{row.observed_at} · Version {row.source_version.slice(0,12)}</li>)}</ul></details>
 </>:null}</div>;
}
