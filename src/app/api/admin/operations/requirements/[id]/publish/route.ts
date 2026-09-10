import { NextRequest } from "next/server";

import { REQUIREMENT_CENTRAL_ROLES } from "@/lib/operations/requirements";
import { runRequirementPublication } from "@/lib/operations/requirement-publication";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runRequirementPublication(request, id, { rpc: "publish_operation_requirement_review", mode: "publish", allowedRoles: REQUIREMENT_CENTRAL_ROLES, scope: "central" });
}
