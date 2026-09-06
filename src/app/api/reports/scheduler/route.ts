import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { actorCanAccessFacility, type AdminApiActor } from "@/lib/admin/api-auth";
import { computeNextRunUtc, decodeScheduleRule } from "@/lib/reports/schedule-preview";
import { runTemplateAndPersist, finishReportRun, failReportRun, type ReportRunSnapshot } from "@/lib/reports/run-persistence";
import { executeReportTemplate } from "@/lib/reports/executors";

export const runtime="nodejs";
export async function POST(request:NextRequest) {
  const expected=process.env.REPORT_SCHEDULER_SECRET;
  const supplied=request.headers.get("x-cron-secret")??"";
  if(!expected || Buffer.byteLength(expected)!==Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected),Buffer.from(supplied))) return NextResponse.json({error:"Unauthorized"},{status:401});
  const admin=createServiceRoleClient();
  const {data:schedules,error}=await admin.from("report_schedules").select("*").eq("status","active").is("deleted_at",null).lte("next_run_at",new Date().toISOString()).order("next_run_at").limit(20);
  if(error) return NextResponse.json({error:"Could not read schedules"},{status:500});
  let processed=0,failed=0;
  for(const schedule of schedules??[]) {
    let runId:string|null=null;
    let outputCompleted=false;
    try {
      const rule=decodeScheduleRule(schedule.recurrence_rule);
      if(schedule.output_format!=="csv") throw new Error("Choose CSV with in-app output before resuming this schedule.");
      const {data:profile,error:profileError}=await admin.from("user_profiles").select("id,organization_id,app_role").eq("id",schedule.created_by).eq("organization_id",schedule.organization_id).eq("is_active",true).is("deleted_at",null).maybeSingle();
      if(profileError || !profile || !["owner","org_admin","facility_admin"].includes(profile.app_role)) throw new Error("Schedule owner no longer has report access.");
      const actor={...profile,organization_id:schedule.organization_id,admin} as AdminApiActor;
      if(schedule.facility_id ? !(await actorCanAccessFacility(actor,schedule.facility_id)) : !["owner","org_admin"].includes(profile.app_role)) throw new Error("Schedule facility scope is no longer authorized.");
      let scopeLabel="All facilities";
      if(schedule.facility_id) {
        const {data:facility}=await admin.from("facilities").select("name").eq("id",schedule.facility_id).eq("organization_id",schedule.organization_id).single();
        if(!facility) throw new Error("Facility unavailable");
        scopeLabel=facility.name;
      }
      // Recover an acknowledged occurrence after a crash between output persistence and advancing the calendar.
      const {data:existing,error:lookupError}=await admin.from("report_runs").select("id,status,started_at").eq("schedule_id",schedule.id).eq("scheduled_for",schedule.next_run_at!).maybeSingle();
      if(lookupError) throw new Error(lookupError.message);
      if(existing?.status==="running") {
        if(Date.now()-new Date(existing.started_at).getTime()<30*60*1000) continue;
        await failReportRun(admin,schedule.organization_id,existing.id,"Scheduled execution was interrupted. Review and resume the schedule.");
        throw new Error("Scheduled execution was interrupted. Review and resume the schedule.");
      }
      if(existing && existing.status!=="completed") throw new Error("Previous scheduled execution failed. Review and resume the schedule.");
      if(!existing && schedule.source_type==="template") {
        const {data:template}=await admin.from("report_templates").select("slug,name").eq("id",schedule.source_id).or(`organization_id.is.null,organization_id.eq.${schedule.organization_id}`).eq("status","active").is("deleted_at",null).single();
        if(!template) throw new Error("Scheduled template is unavailable");
        const result=await runTemplateAndPersist({supabase:admin,organizationId:schedule.organization_id,slug:template.slug,title:template.name,
          facilityId:schedule.facility_id,scopeLabel,userId:profile.id,scheduleId:schedule.id,scheduledFor:schedule.next_run_at!});
        runId=result.runId;
        outputCompleted=true;
      } else if(!existing && schedule.source_type==="pack") {
        const {data:pack}=await admin.from("report_packs").select("name").eq("id",schedule.source_id).eq("organization_id",schedule.organization_id).is("deleted_at",null).single();
        if(!pack) throw new Error("Scheduled pack is unavailable");
        const {data:items,error:itemsError}=await admin.from("report_pack_items").select("source_id,source_type").eq("pack_id",schedule.source_id).eq("organization_id",schedule.organization_id).is("deleted_at",null).order("display_order");
        if(itemsError || !items?.length || items.some(item=>item.source_type!=="template")) throw new Error("Pack must contain available templates");
        const {data:run,error:runError}=await admin.from("report_runs").insert({organization_id:schedule.organization_id,source_type:"pack",source_id:schedule.source_id,
          status:"running",schedule_id:schedule.id,scheduled_for:schedule.next_run_at,generated_by_user_id:profile.id,runtime_classification:"scheduled",run_scope_json:{facility_id:schedule.facility_id,scope_label:scopeLabel}}).select("id").single();
        if(runError?.code==="23505") continue;
        if(runError || !run) throw new Error("Could not claim scheduled pack");
        runId=run.id;
        const snapshot:ReportRunSnapshot={title:pack.name,scopeLabel,facilityId:schedule.facility_id,generatedAt:new Date().toISOString(),slices:[]};
        for(const item of items) {
          const {data:template}=await admin.from("report_templates").select("slug,name").eq("id",item.source_id).or(`organization_id.is.null,organization_id.eq.${schedule.organization_id}`).eq("status","active").is("deleted_at",null).single();
          if(!template) throw new Error("Pack template unavailable");
          snapshot.slices.push({slug:template.slug,name:template.name,result:await executeReportTemplate(template.slug,{supabase:admin,organizationId:schedule.organization_id,facilityId:schedule.facility_id})});
        }
        snapshot.generatedAt=new Date().toISOString();
        await finishReportRun(admin,schedule.organization_id,run.id,snapshot);
        outputCompleted=true;
      } else if(!existing) throw new Error("Unsupported scheduled source");
      const next=computeNextRunUtc({...rule,timezone:schedule.timezone}).toISOString();
      const {error:advanceError}=await admin.from("report_schedules").update({last_run_at:new Date().toISOString(),next_run_at:next,last_error:null}).eq("id",schedule.id).eq("next_run_at",schedule.next_run_at!);
      if(advanceError) throw new Error("Output saved; could not advance schedule");
      processed++;
    } catch(error) {
      const message=error instanceof Error?error.message:"Scheduled execution failed";
      if(message==="schedule_occurrence_already_claimed") continue;
      if(runId && !outputCompleted) { try { await failReportRun(admin,schedule.organization_id,runId,message); } catch { /* schedule error remains visible below */ } }
      const {error:stateError}=await admin.from("report_schedules").update({status:"failed",last_error:message}).eq("id",schedule.id);
      if(stateError) return NextResponse.json({error:"Could not save scheduled failure",processed,failed:failed+1},{status:500});
      failed++;
    }
  }
  return NextResponse.json({ok:failed===0,processed,failed},{status:failed?500:200});
}
