"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { ReportRunResult } from "@/components/reports/report-run-result";
import { Button } from "@/components/ui/button";
import { loadReportsRoleContext } from "@/lib/reports/auth";
import { detailRowsToCsv, summaryRowsToCsv } from "@/lib/reports/metric-presentation";
import { createClient } from "@/lib/supabase/client";

const cell=z.union([z.string(),z.number(),z.null()]);
const snapshotSchema=z.object({title:z.string(),scopeLabel:z.string(),facilityId:z.string().nullable(),generatedAt:z.string(),slices:z.array(z.object({
  slug:z.string(),name:z.string(),error:z.string().optional(),result:z.object({summary:z.array(z.object({metricKey:z.string(),value:cell})),rows:z.array(z.record(z.string(),cell)),footnotes:z.array(z.string()).optional()}).nullable(),
}))});
type Snapshot=z.infer<typeof snapshotSchema>;
export default function SavedReportPage() {
 const {id}=useParams<{id:string}>();
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [status,setStatus]=useState("loading");
 const [error,setError]=useState<string|null>(null);
 const [retryHref,setRetryHref]=useState<string|null>(null);
 useEffect(()=>{
  let alive=true;
  setSnapshot(null);setError(null);setRetryHref(null);setStatus("loading");
  void(async()=>{
    try {
      const supabase=createClient();const ctx=await loadReportsRoleContext(supabase);
      if(!ctx.ok) throw new Error(ctx.error);
      const {data:run,error:queryError}=await supabase.from("report_runs").select("source_type,source_id,status,result_snapshot_json,error_json,started_at").eq("id",id).eq("organization_id",ctx.ctx.organizationId).single();
      if(queryError || !run) throw new Error("Report run not found");
      const parsed=snapshotSchema.safeParse(run.result_snapshot_json);
      let href:string|null=null;
      if(run.source_type==="pack") href=`/admin/reports/run/pack/${run.source_id}`;
      if(run.source_type==="template") {
        const {data:template}=await supabase.from("report_templates").select("slug").eq("id",run.source_id).maybeSingle();
        if(template) href=`/admin/reports/run/template/${template.slug}`;
      }
      if(alive) {
        setStatus(run.status==="running" && Date.now()-new Date(run.started_at).getTime()>30*60*1000?"interrupted — rerun required":run.status);
        setRetryHref(href);
        if(parsed.success) setSnapshot(parsed.data);
        else if(run.status==="completed") setError("This older run has no preserved output. Run it again to create a saved result.");
        if(run.error_json && typeof run.error_json==="object" && "message" in run.error_json) setError(String(run.error_json.message));
      }
    } catch(e) {if(alive){setError(e instanceof Error?e.message:"Could not load report");setStatus("unavailable");}}
  })();return()=>{alive=false;};
 },[id]);
 function download() {
  if(!snapshot)return;
  const csv=snapshot.slices.map(slice=>`${summaryRowsToCsv([{metricKey:"Report",value:slice.name},{metricKey:"Scope",value:snapshot.scopeLabel},{metricKey:"Generated at",value:snapshot.generatedAt}])}\n${slice.result?`${summaryRowsToCsv(slice.result.summary)}\n\n${detailRowsToCsv(slice.result.rows)}`:slice.error??"No result"}`).join("\n\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=`report-${id}.csv`;anchor.click();URL.revokeObjectURL(url);
 }
 return <div className="space-y-6"><ReportsHubNav/><h1 className="text-2xl font-semibold">{snapshot?.title??"Saved report"}</h1>
  <p>Status: {status}</p>{error?<p role="alert" className="text-destructive">{error}</p>:null}
  <div className="flex gap-4"><Link href="/admin/reports/history">Back to history</Link>{retryHref?<Link href={retryHref}>Run again</Link>:null}{snapshot?<Button onClick={download}>Download saved CSV</Button>:null}</div>
  {snapshot?<><p>Scope: {snapshot.scopeLabel} · Generated {new Date(snapshot.generatedAt).toLocaleString()}</p>{snapshot.slices.map((slice,index)=><section key={`${slice.slug}-${index}`} className="space-y-3"><h2 className="text-lg font-medium">{slice.name}</h2>{slice.error?<p className="text-destructive">{slice.error}</p>:null}{slice.result?<><ReportRunResult summary={slice.result.summary} detailRows={slice.result.rows}/>{slice.result.footnotes?.map((note,i)=><p key={i} className="text-sm text-muted-foreground">{note}</p>)}</>:null}</section>)}</>:null}
 </div>;
}
