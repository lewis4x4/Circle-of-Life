import { NextRequest } from "next/server";

import { REQUIREMENT_FACILITY_ROLES } from "@/lib/operations/requirements";
import { runRequirementPublication } from "@/lib/operations/requirement-publication";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runRequirementPublication(request, id, { rpc: "publish_operation_facility_requirement_review", mode: "publish", allowedRoles: REQUIREMENT_FACILITY_ROLES, scope: "facility" });
}
