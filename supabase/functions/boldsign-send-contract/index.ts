import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { boldSignFetch, getTemplateId } from "../_shared/boldsign.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ROLES = new Set(["owner", "org_admin", "facility_admin", "manager", "nurse"]);

type ContractRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  resident_id: string;
  contract_type: string;
  title: string;
  provider: string;
  provider_template_id: string | null;
  provider_document_id: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type SignerRow = {
  id: string;
  signer_name: string;
  signer_email: string | null;
  signer_role: string;
  routing_order: number;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401, origin);

  const { data: profile } = await admin
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", user.id)
    .single();
  if (!profile || !ALLOWED_ROLES.has(String(profile.app_role))) {
    return jsonResponse({ error: "Forbidden" }, 403, origin);
  }

  let body: { contract_id?: string; template_id?: string; disable_emails?: boolean; get_embedded_links?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, origin);
  }
  if (!body.contract_id) return jsonResponse({ error: "contract_id required" }, 400, origin);

  const { data: contract, error: contractErr } = await admin
    .from("resident_contracts")
    .select("*")
    .eq("id", body.contract_id)
    .is("deleted_at", null)
    .single<ContractRow>();
  if (contractErr || !contract) return jsonResponse({ error: "Contract not found" }, 404, origin);
  if (contract.organization_id !== profile.organization_id) return jsonResponse({ error: "Forbidden" }, 403, origin);
  if (contract.provider !== "boldsign") return jsonResponse({ error: "Contract provider is not boldsign" }, 400, origin);
  if (!["draft", "ready_to_send"].includes(contract.status)) {
    return jsonResponse({ error: `Contract status must be draft/ready_to_send, got ${contract.status}` }, 409, origin);
  }

  const { data: signers, error: signersErr } = await admin
    .from("resident_contract_signers")
    .select("id, signer_name, signer_email, signer_role, routing_order")
    .eq("contract_id", contract.id)
    .is("deleted_at", null)
    .order("routing_order", { ascending: true });
  if (signersErr) return jsonResponse({ error: signersErr.message }, 500, origin);
  const signerRows = (signers ?? []) as SignerRow[];
  if (signerRows.length === 0) return jsonResponse({ error: "At least one signer is required" }, 400, origin);
  const missingEmail = signerRows.find((signer) => !signer.signer_email);
  if (missingEmail) return jsonResponse({ error: `Signer ${missingEmail.signer_name} is missing signer_email` }, 400, origin);

  let templateId: string;
  try {
    templateId = getTemplateId(contract.contract_type, body.template_id ?? contract.provider_template_id);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, origin);
  }

  const disableEmails = body.disable_emails ?? true;
  const enableSigningOrder = signerRows.length > 1;
  const payload = {
    title: contract.title,
    message: "Please review and sign this Circle of Life resident agreement.",
    roles: signerRows.map((signer, index) => ({
      roleIndex: index + 1,
      signerName: signer.signer_name,
      signerEmail: signer.signer_email,
      signerOrder: signer.routing_order,
      signerType: "Signer",
      signerRole: signer.signer_role,
      locale: "EN",
    })),
    enableSigningOrder,
    disableEmails,
  };

  const sendResponse = await boldSignFetch(`/v1/template/send?templateId=${encodeURIComponent(templateId)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const sendJson = await sendResponse.json().catch(() => ({}));
  if (!sendResponse.ok) {
    await admin.from("resident_contract_events").insert({
      organization_id: contract.organization_id,
      facility_id: contract.facility_id,
      contract_id: contract.id,
      resident_id: contract.resident_id,
      provider: "boldsign",
      event_type: "SendFailed",
      event_status: "failed",
      raw_payload: sendJson,
      metadata: { http_status: sendResponse.status },
    });
    return jsonResponse({ error: "BoldSign send failed", details: sendJson }, 502, origin);
  }

  const documentId = sendJson.documentId ?? sendJson.documentID ?? sendJson.id;
  if (!documentId || typeof documentId !== "string") {
    return jsonResponse({ error: "BoldSign response did not include documentId", details: sendJson }, 502, origin);
  }

  const now = new Date().toISOString();
  await admin.from("resident_contracts").update({
    provider_template_id: templateId,
    provider_document_id: documentId,
    status: "sent",
    sent_at: now,
    updated_by: user.id,
    metadata: { ...(contract.metadata ?? {}), boldsign_send_response: sendJson, disable_emails: disableEmails },
  }).eq("id", contract.id);

  await admin.from("resident_contract_signers").update({ status: "sent", sent_at: now, updated_by: user.id }).eq("contract_id", contract.id);

  await admin.from("resident_contract_events").insert({
    organization_id: contract.organization_id,
    facility_id: contract.facility_id,
    contract_id: contract.id,
    resident_id: contract.resident_id,
    provider: "boldsign",
    provider_document_id: documentId,
    event_type: "Sent",
    event_status: "sent",
    raw_payload: sendJson,
    metadata: { sent_by: user.id, template_id: templateId, disable_emails: disableEmails },
  });

  const links: Record<string, string> = {};
  if (body.get_embedded_links ?? disableEmails) {
    for (const signer of signerRows) {
      const linkResponse = await boldSignFetch(`/v1/document/getEmbeddedSignLink?documentId=${encodeURIComponent(documentId)}&signerEmail=${encodeURIComponent(signer.signer_email!)}`);
      if (linkResponse.ok) {
        const linkJson = await linkResponse.json().catch(() => ({}));
        if (typeof linkJson.signLink === "string") links[signer.id] = linkJson.signLink;
      }
    }
  }

  return jsonResponse({ success: true, contract_id: contract.id, document_id: documentId, embedded_links: links }, 200, origin);
});
