"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { providerDocumentPrepareSchema, providerDocumentVersionSchema, type ProviderDocumentVersion, type ProviderReportsReply } from "@/lib/operations/provider-reports";
import { CONTROL } from "./work-inputs";
type Attempt = { file: File; body: string; version?: ProviderDocumentVersion; finalizeKey: string; uploaded?: boolean };
export function ProviderDocumentIntake({ taskId, facilityId, residentId, versions, disabled, onLock, onSaved }: { taskId:string;facilityId:string;residentId:string;versions:ProviderReportsReply["versions"];disabled:boolean;onLock:(value:boolean)=>void;onSaved:()=>void }) {
 const [file,setFile]=useState<File|null>(null),[title,setTitle]=useState(""),[type,setType]=useState("community_support_plan"),[supersedes,setSupersedes]=useState(""),[pending,setPending]=useState<Attempt|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const active=useRef(true),sending=useRef(false),abort=useRef<AbortController|null>(null);
 useEffect(()=>{active.current=true;return()=>{active.current=false;abort.current?.abort();onLock(false);};},[onLock]);
 const endpoint='/api/admin/operations/provider-reports/documents';
 function validate(raw:unknown,attempt:Attempt){const version=providerDocumentVersionSchema.parse(raw);const body=JSON.parse(attempt.body);if(version.task_id!==taskId||version.facility_id!==facilityId||version.resident_id!==residentId||version.document_type!==body.document_type||version.supersedes_version_id!==(body.supersedes_version_id??null)||(attempt.version!==undefined&&(version.id!==attempt.version.id||version.document_id!==attempt.version.document_id))||version.declared_sha256!==body.declared_sha256||version.declared_size_bytes!==body.declared_size_bytes||version.declared_mime!==body.declared_mime||version.object_path!==`${facilityId}/${version.document_id}/${version.id}/source`)throw Error('Native version binding failed');return version;}
 async function run(attempt:Attempt){if(sending.current||disabled)return;sending.current=true;setBusy(true);onLock(true);setPending(attempt);setMessage("");abort.current=new AbortController();
  try{
   if(!attempt.version){const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:attempt.body,signal:abort.current.signal});if(!response.ok)throw Error('Prepare unavailable');attempt.version=validate((await response.json()).version,attempt);}
   if(!active.current)return;
   const version=attempt.version;
   if(version.state!=='finalized'){
    if(!attempt.uploaded){
    const upload=await createClient().storage.from(version.bucket).upload(version.object_path,attempt.file,{upsert:false,contentType:version.declared_mime});
    if(upload.error && !['409','Duplicate'].includes(String((upload.error as {statusCode?:string;error?:string}).statusCode??(upload.error as {error?:string}).error)))throw Error('Upload unavailable');
    attempt.uploaded=true;
    }
    if(!active.current)return;
    const response=await fetch(`${endpoint}/${version.id}/finalize`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({task_id:taskId,request_key:attempt.finalizeKey,expected_revision:version.revision}),signal:abort.current.signal});if(!response.ok)throw Error('Finalize unavailable');attempt.version=validate((await response.json()).version,attempt);
   }
   if(!active.current)return;if(attempt.version.state!=='finalized'||!attempt.version.checksum_verified)throw Error('Unverified finalization');
   setPending(null);setFile(null);onLock(false);setMessage('Native document version finalized. Receipt, review and signature observations remain separate.');onSaved();
  }catch{if(active.current)setMessage('Document intake is unfinished or its result is unknown. Retry the same file and request; no receipt is claimed.');}
  finally{sending.current=false;if(active.current)setBusy(false);}
 }
 async function start(){
  if(!file||sending.current||pending||disabled)return;
  try{
   const metadata=providerDocumentPrepareSchema.omit({declared_sha256:true}).parse({task_id:taskId,request_key:crypto.randomUUID(),document_type:type,title,declared_mime:file.type,declared_size_bytes:file.size,...(supersedes?{supersedes_version_id:supersedes}:{})});
   setBusy(true);sending.current=true;onLock(true);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
   if(!active.current)return;
   const body=providerDocumentPrepareSchema.parse({...metadata,declared_sha256:hash});
   sending.current=false;await run({file,body:JSON.stringify(body),finalizeKey:crypto.randomUUID()});
  }catch{if(active.current){setMessage('Choose a PDF, JPEG or PNG up to 20 MB and a document title.');setBusy(false);onLock(false);}sending.current=false;}
 }
 return <details><summary className={`${CONTROL} cursor-pointer`}>Native report document intake</summary><p>Files stay in the native resident document store. Upload does not confirm service, receipt, review or signatures.</p>{message?<p role="status">{message}</p>:null}{pending?<button type="button" className={CONTROL} disabled={busy||disabled} onClick={()=>void run(pending)}>Retry same document intake</button>:null}
 <fieldset disabled={disabled||busy||pending!==null} className="space-y-3"><legend>Prepare native document version</legend>
 <label className="block">Document title<input className={CONTROL} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label className="block">Document type<select className={CONTROL} value={type} onChange={e=>setType(e.target.value)}>{['form_1823','hospice_plan','community_support_plan','support_plan','provider_report','other'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
 <label className="block">Supersedes native version<select className={CONTROL} value={supersedes} onChange={e=>setSupersedes(e.target.value)}><option value="">New document</option>{versions.filter(v=>v.state==='finalized'&&v.native_current).map(v=><option key={v.id} value={v.id}>{v.title} · {v.id}</option>)}</select></label>
 <label className="block">Native report file<input className={CONTROL} type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button type="button" className={CONTROL} disabled={!file} onClick={()=>void start()}>Upload and finalize native version</button>
 </fieldset></details>;
}
