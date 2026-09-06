import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { executeReportTemplate, type ReportExecutionResult } from "./executors";
import { resolveReportTemplateIdBySlug } from "./resolve-template-id";

export type ReportRunSnapshot = {
  title: string; scopeLabel: string; facilityId: string | null; generatedAt: string;
  slices: Array<{ slug: string; name: string; result: ReportExecutionResult | null; error?: string }>;
};
export async function finishReportRun(supabase: SupabaseClient<Database>, organizationId: string, runId: string, snapshot: ReportRunSnapshot) {
  const failed = snapshot.slices.some((slice) => slice.error);
  const { data, error } = await supabase.from("report_runs").update({
    status: failed ? "failed" : "completed", completed_at: snapshot.generatedAt,
    result_snapshot_json: JSON.parse(JSON.stringify(snapshot)) as Json,
    error_json: failed ? { message: "One or more reports failed; inspect saved output." } : null,
  }).eq("id", runId).eq("organization_id", organizationId).eq("status", "running").select("id").single();
  if (error || !data) throw new Error(`Could not save report output: ${error?.message ?? "run was not updated"}`);
}
export async function failReportRun(supabase: SupabaseClient<Database>, organizationId: string, runId: string, message: string) {
  const { data, error } = await supabase.from("report_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_json: { message } }).eq("id", runId).eq("organization_id", organizationId).eq("status", "running").select("id").single();
  if (error || !data) throw new Error(`${message}. Run status could not be saved: ${error?.message ?? "run was not updated"}`);
}
export async function runTemplateAndPersist(params: {
  supabase: SupabaseClient<Database>; organizationId: string; slug: string; title: string;
  facilityId: string | null; scopeLabel: string; userId?: string; scheduleId?: string; scheduledFor?: string;
}) {
  const {supabase,organizationId,slug,facilityId,scopeLabel,title}=params;
  const resolved=await resolveReportTemplateIdBySlug(supabase,slug,organizationId);
  if ("error" in resolved) throw new Error(resolved.error);
  const {data:run,error}=await supabase.from("report_runs").insert({
    organization_id:organizationId,source_type:"template",source_id:resolved.id,template_id:resolved.id,status:"running",
    generated_by_user_id:params.userId,run_scope_json:{facility_id:facilityId,scope_label:scopeLabel},
    schedule_id:params.scheduleId,scheduled_for:params.scheduledFor,runtime_classification:params.scheduleId?"scheduled":"manual",
  }).select("id").single();
  if(error || !run) throw new Error(error?.code === "23505" ? "schedule_occurrence_already_claimed" : error?.message ?? "Could not create report run");
  try {
    const result=await executeReportTemplate(slug,{supabase,organizationId,facilityId});
    const snapshot:ReportRunSnapshot={title,scopeLabel,facilityId,generatedAt:new Date().toISOString(),slices:[{slug,name:title,result}]};
    await finishReportRun(supabase,organizationId,run.id,snapshot);
    return {runId:run.id,result,snapshot};
  } catch(error) {
    const message=error instanceof Error?error.message:"Report execution failed";
    await failReportRun(supabase,organizationId,run.id,message);
    throw error;
  }
}
