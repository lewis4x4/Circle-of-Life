import { z } from "zod";

import { commandError, employeeFileActor, employeeFileResponse } from "@/lib/staff/employee-file-server";
import { ONBOARDING_MANUAL_ATTESTATION, type OnboardingManualStatus } from "@/lib/staff/onboarding-manuals";

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sign = z.object({
  document_id: z.string().regex(UUID),
  signature_name: z.string().trim().min(3).max(200),
  method: z.enum(["self", "in_person"]),
});

/**
 * COL-740: the P&P manuals this employee must sign at onboarding. With
 * `?document=<id>` it also returns that manual's text so it can be read before
 * signing; only a manual this employee is required to sign is returned.
 */
export async function GET(request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  const client = access.actor.client;
  const { data, error } = await client.rpc("haven_onboarding_manual_status" as never, { p_staff_id: access.staff.id } as never);
  if (error) return employeeFileResponse({ error: "Onboarding manuals could not be loaded." }, 503);
  const manuals = (data ?? []) as OnboardingManualStatus[];

  const documentId = new URL(request.url).searchParams.get("document");
  if (!documentId) return employeeFileResponse({ manuals });
  if (!manuals.some((m) => m.document_id === documentId)) {
    return employeeFileResponse({ error: "This manual is not required for this employee." }, 404);
  }
  const doc = await client
    .from("documents" as never)
    .select("id, title, markdown_text, raw_text, updated_at")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (doc.error || !doc.data) return employeeFileResponse({ error: "The manual could not be loaded." }, 503);
  const row = doc.data as { id: string; title: string; markdown_text: string | null; raw_text: string | null; updated_at: string };
  return employeeFileResponse({
    manuals,
    document: { id: row.id, title: row.title, text: row.markdown_text ?? row.raw_text ?? "", updated_at: row.updated_at },
  });
}

export async function POST(request: Request, context: Context) {
  const access = await employeeFileActor((await context.params).id);
  if ("response" in access) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return employeeFileResponse({ error: "Invalid request." }, 400);
  }
  const parsed = sign.safeParse(body);
  if (!parsed.success) return employeeFileResponse({ error: "Type your full name to sign." }, 400);
  const { data, error } = await access.actor.client.rpc(
    "haven_sign_onboarding_manual" as never,
    {
      p_staff_id: access.staff.id,
      p_document_id: parsed.data.document_id,
      p_signature_name: parsed.data.signature_name,
      p_method: parsed.data.method,
      p_attestation: ONBOARDING_MANUAL_ATTESTATION,
    } as never,
  );
  return error ? commandError(error) : employeeFileResponse({ result: data });
}
