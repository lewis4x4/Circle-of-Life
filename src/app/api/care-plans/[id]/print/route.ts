import { NextResponse } from "next/server";
import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import {
  buildCarePlanPrintPacket,
  type CarePlanPrintAcknowledgementRow,
  type CarePlanPrintFacilityRow,
  type CarePlanPrintItemRow,
  type CarePlanPrintResidentRow,
} from "@/lib/care-plans/care-plan-print-packet";
import { logError } from "@/lib/observability/logger";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";

// Same roles that may author or approve a plan; a printout is the signed plan leaving the building.
const PRINT_ROLES = ["owner", "org_admin", "facility_admin", "nurse"] as const;

type QueryError = { message: string };
type SingleResult<T> = { data: T | null; error: QueryError | null };
type ListResult<T> = { data: T[] | null; error: QueryError | null };

type PlanRow = {
  id: string;
  resident_id: string;
  facility_id: string;
  organization_id: string;
  version: number | null;
  status: string;
  effective_date: string | null;
  review_due_date: string | null;
  notes: string | null;
  approved_at: string | null;
  approved_by: string | null;
  signature_data: string | null;
  source_form_1823_id: string | null;
};

type Form1823ProvenanceRow = { exam_date: string | null; physician_name: string | null; examiner_title: string | null };

/**
 * GET /api/care-plans/[id]/print — the print packet for one plan version.
 * Read-only. `audit_log.action` is constrained to INSERT/UPDATE/DELETE, so a
 * print is not recorded there; see COL-376 for the follow-on access log.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: carePlanId } = await params;

  const actorResult = await requireCurrentApiActor({
    allowedRoles: PRINT_ROLES,
    scope: "care-plans.print",
  });
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const admin = actor.admin;

  const planResult = (await admin
    .from("care_plans")
    .select(
      "id, resident_id, facility_id, organization_id, version, status, effective_date, review_due_date, notes, approved_at, approved_by, signature_data, source_form_1823_id",
    )
    .eq("id", carePlanId)
    .eq("organization_id", actor.organizationId)
    .is("deleted_at", null)
    .maybeSingle()) as unknown as SingleResult<PlanRow>;

  if (planResult.error || !planResult.data) {
    return NextResponse.json({ error: "Care plan not found" }, { status: 404 });
  }
  const plan = planResult.data;

  const hasAccess = await serviceRoleUserHasFacilityAccess(admin, {
    userId: actor.id,
    facilityId: plan.facility_id,
    organizationId: actor.organizationId,
  });
  if (!hasAccess) {
    return NextResponse.json({ error: "You do not have access to this care plan" }, { status: 403 });
  }

  const [residentResult, facilityResult, itemsResult, approverResult, successorResult, acknowledgementResult, form1823Result] = await Promise.all([
    admin
      .from("residents")
      .select("id, first_name, last_name, date_of_birth, beds!fk_beds_resident ( bed_label, rooms ( room_number ) )")
      .eq("id", plan.resident_id)
      .eq("organization_id", plan.organization_id)
      .is("deleted_at", null)
      .maybeSingle() as unknown as Promise<SingleResult<CarePlanPrintResidentRow>>,
    admin
      .from("facilities")
      .select("name, address_line_1, address_line_2, city, state, zip, phone, license_number, settings")
      .eq("id", plan.facility_id)
      .eq("organization_id", plan.organization_id)
      .maybeSingle() as unknown as Promise<SingleResult<CarePlanPrintFacilityRow>>,
    admin
      .from("care_plan_items")
      .select(
        "id, category, title, description, assistance_level, frequency, goal, interventions, special_instructions, sort_order",
      )
      .eq("care_plan_id", plan.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }) as unknown as Promise<ListResult<CarePlanPrintItemRow>>,
    plan.approved_by
      ? (admin
          .from("user_profiles")
          .select("full_name, email")
          .eq("id", plan.approved_by)
          .maybeSingle() as unknown as Promise<SingleResult<{ full_name: string | null; email: string | null }>>)
      : Promise.resolve<SingleResult<{ full_name: string | null; email: string | null }>>({ data: null, error: null }),
    plan.status === "archived"
      ? (admin
          .from("care_plans")
          .select("version")
          .eq("previous_version_id", plan.id)
          .is("deleted_at", null)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle() as unknown as Promise<SingleResult<{ version: number | null }>>)
      : Promise.resolve<SingleResult<{ version: number | null }>>({ data: null, error: null }),
    admin
      .from("care_plan_acknowledgements")
      .select("id, signer_role, signer_name, relationship_to_resident, method, signature_data, acknowledged_at")
      .eq("care_plan_id", plan.id)
      .is("deleted_at", null)
      .order("acknowledged_at", { ascending: false }) as unknown as Promise<ListResult<CarePlanPrintAcknowledgementRow>>,
    plan.source_form_1823_id
      ? // form_1823_records is not yet in the generated Database types (same staleness as COL-347).
        (admin
          .from("form_1823_records" as never)
          .select("exam_date, physician_name, examiner_title")
          .eq("id" as never, plan.source_form_1823_id as never)
          .eq("resident_id" as never, plan.resident_id as never)
          .maybeSingle() as unknown as Promise<SingleResult<Form1823ProvenanceRow>>)
      : Promise.resolve<SingleResult<Form1823ProvenanceRow>>({ data: null, error: null }),
  ]);

  const firstError =
    residentResult.error ??
    facilityResult.error ??
    itemsResult.error ??
    approverResult.error ??
    successorResult.error ??
    acknowledgementResult.error ??
    form1823Result.error;
  if (firstError) {
    logError("care-plans.print", firstError, { action: "load_packet", carePlanId });
    return NextResponse.json({ error: "Care plan could not be loaded for printing" }, { status: 500 });
  }
  if (!residentResult.data || !facilityResult.data) {
    return NextResponse.json({ error: "Care plan not found" }, { status: 404 });
  }

  const packet = buildCarePlanPrintPacket({
    plan,
    items: itemsResult.data ?? [],
    resident: residentResult.data,
    facility: facilityResult.data,
    approverName: plan.approved_by
      ? formatUploadedByProfile(approverResult.data ?? { full_name: null, email: null })
      : null,
    supersededByVersion: successorResult.data?.version ?? null,
    acknowledgements: acknowledgementResult.data ?? [],
    form1823: form1823Result.data,
    printedAt: new Date().toISOString(),
    printedBy: formatUploadedByProfile({
      full_name: actor.fullName,
      email: actor.sessionEmail ?? actor.email ?? undefined,
    }),
  });

  return NextResponse.json(packet, { headers: { "Cache-Control": "no-store" } });
}
