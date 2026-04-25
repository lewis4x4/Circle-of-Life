import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isV2FormId } from "@/lib/v2-forms";

/**
 * `POST /api/v2/forms/[id]` — V2 form submission stub.
 *
 * S10 ships the form skeletons (RHF + Zod validation, T5 layout). The live
 * wire-up to V1 create endpoints (or new V2 endpoints) lands in S10a; today
 * this handler validates the caller is authenticated and that the form id is
 * known, then returns a `deferred` envelope without persisting anything.
 *
 * The deferred envelope is intentional — it lets the V2 UI exercise its
 * full validation + submit path without accidentally writing data while the
 * V1 forms remain the canonical write path.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isV2FormId(id)) {
    return NextResponse.json({ error: "Unknown form id" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: true,
      deferred: true,
      formId: id,
      message:
        "V2 form skeleton — submit wires to V1 in S10a. The V1 form at /admin/<seg>/new remains the canonical write path.",
    },
    { status: 202 },
  );
}
