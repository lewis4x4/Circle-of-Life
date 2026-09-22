import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { boldSignFetch, getTemplateId } from "../_shared/boldsign.ts";
import {
  currentActorOrProviderErrorResponse,
  currentActorErrorResponse,
  requireCurrentActor,
  withCurrentActorRevalidation,
} from "../_shared/current-actor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ROLES = new Set(["owner", "org_admin", "facility_admin", "manager", "med_tech"]);

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

type LinkSigner = {
  id: string;
  email: string;
};

type SendClaimResult = {
  action: "send" | "replay" | "reconcile" | "rejected";
  state: string;
  generation: number;
  request_sha256: string;
  recovery_label: string;
  provider_payload: Record<string, unknown>;
  link_signers: LinkSigner[];
  provider_document_id: string | null;
};

export function boldSignProviderFailureResponse(
  error: unknown,
  origin: string | null,
  message = "BoldSign send failed",
): Response {
  return currentActorOrProviderErrorResponse(error, {
    status: 502,
    message,
    headers: getCorsHeaders(origin),
  });
}

export async function handleBoldSignSend(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  let actorAuth;
  try {
    actorAuth = await requireCurrentActor(req, {
      allowedRoles: [...ALLOWED_ROLES],
    });
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
  }
  const { actor } = actorAuth;
  const user = { id: actor.userId };
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: {
    contract_id?: string;
    template_id?: string;
    disable_emails?: boolean;
    get_embedded_links?: boolean;
    idempotency_key?: string;
  };
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
  if (
    contract.organization_id !== actor.organizationId ||
    !actor.accessibleFacilityIds.includes(contract.facility_id)
  ) return jsonResponse({ error: "Forbidden" }, 403, origin);
  if (contract.provider !== "boldsign") return jsonResponse({ error: "Contract provider is not boldsign" }, 400, origin);

  let templateId: string;
  try {
    templateId = getTemplateId(contract.contract_type, body.template_id ?? contract.provider_template_id);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, origin);
  }

  const disableEmails = body.disable_emails ?? true;
  const requestId = body.idempotency_key ?? contract.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    return jsonResponse({ error: "idempotency_key must be a UUID" }, 400, origin);
  }
  const providerEnvironment = (Deno.env.get("BOLDSIGN_ENVIRONMENT") ?? "live")
    .trim()
    .toLowerCase();

  try {
    await actorAuth.revalidate(contract.facility_id);
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
  }

  const { data: preparedData, error: prepareError } = await admin.rpc(
    "prepare_boldsign_contract_send",
    {
      p_contract_id: contract.id,
      p_request_id: requestId,
      p_actor_id: user.id,
      p_organization_id: contract.organization_id,
      p_facility_id: contract.facility_id,
      p_template_id: templateId,
      p_disable_emails: disableEmails,
      p_provider_environment: providerEnvironment,
    },
  );
  if (prepareError) {
    const status = prepareError.code === "P0409" || prepareError.code === "23505"
      ? 409
      : prepareError.code === "22023"
      ? 400
      : 500;
    return jsonResponse({ error: prepareError.message || "Unable to prepare BoldSign send" }, status, origin);
  }
  const prepared = preparedData as SendClaimResult;
  if (!prepared || !prepared.action || !prepared.request_sha256 || !prepared.generation) {
    return jsonResponse({ error: "Unable to prepare BoldSign send" }, 503, origin);
  }
  if (prepared.action === "reconcile") {
    return jsonResponse(
      { error: "BoldSign send outcome requires reconciliation" },
      409,
      origin,
    );
  }
  if (prepared.action === "rejected") {
    return jsonResponse(
      { error: "Previous BoldSign send was rejected; use a new idempotency_key to retry" },
      409,
      origin,
    );
  }

  let documentId = prepared.provider_document_id;
  let linkSigners = prepared.link_signers ?? [];

  if (prepared.action === "send") {
    let sendResponse: Response;
    try {
      sendResponse = await withCurrentActorRevalidation(
        actorAuth,
        () => boldSignFetch(`/v1/template/send?templateId=${encodeURIComponent(templateId)}`, {
          method: "POST",
          body: JSON.stringify(prepared.provider_payload),
        }),
        contract.facility_id,
      );
    } catch (error) {
      const { error: failureRecordError } = await admin.rpc("fail_boldsign_contract_send", {
        p_contract_id: contract.id,
        p_request_id: requestId,
        p_request_sha256: prepared.request_sha256,
        p_generation: prepared.generation,
        p_definite: false,
        p_failure_code: "provider_transport_unknown",
        p_provider_payload: {},
      });
      if (failureRecordError) {
        return jsonResponse({ error: "BoldSign outcome could not be recorded" }, 503, origin);
      }
      return boldSignProviderFailureResponse(error, origin);
    }
    const parsedSendJson: unknown = await sendResponse.json().catch(() => ({}));
    const sendJson = parsedSendJson && typeof parsedSendJson === "object" &&
        !Array.isArray(parsedSendJson)
      ? parsedSendJson as Record<string, unknown>
      : { malformed_provider_response: true };
    if (!sendResponse.ok) {
      const definite = [400, 401, 403, 404, 422].includes(sendResponse.status);
      const { error: failureRecordError } = await admin.rpc(
        "fail_boldsign_contract_send",
        {
          p_contract_id: contract.id,
          p_request_id: requestId,
          p_request_sha256: prepared.request_sha256,
          p_generation: prepared.generation,
          p_definite: definite,
          p_failure_code: `provider_http_${sendResponse.status}`,
          p_provider_payload: sendJson,
        },
      );
      if (failureRecordError) {
        return jsonResponse({ error: "BoldSign outcome could not be recorded" }, 503, origin);
      }
      return jsonResponse({ error: "BoldSign send failed" }, 502, origin);
    }

    const providerDocumentId = sendJson.documentId ?? sendJson.documentID ?? sendJson.id;
    if (!providerDocumentId || typeof providerDocumentId !== "string") {
      const { error: failureRecordError } = await admin.rpc("fail_boldsign_contract_send", {
        p_contract_id: contract.id,
        p_request_id: requestId,
        p_request_sha256: prepared.request_sha256,
        p_generation: prepared.generation,
        p_definite: false,
        p_failure_code: "provider_success_without_document_id",
        p_provider_payload: sendJson,
      });
      if (failureRecordError) {
        return jsonResponse({ error: "BoldSign outcome could not be recorded" }, 503, origin);
      }
      return jsonResponse({ error: "BoldSign send outcome requires reconciliation" }, 502, origin);
    }

    const { data: commitData, error: commitError } = await admin.rpc(
      "commit_boldsign_contract_send",
      {
        p_contract_id: contract.id,
        p_request_id: requestId,
        p_request_sha256: prepared.request_sha256,
        p_generation: prepared.generation,
        p_provider_document_id: providerDocumentId,
        p_provider_response: sendJson,
        p_provider_sent_at: new Date().toISOString(),
      },
    );
    if (commitError) {
      return jsonResponse(
        { error: "BoldSign send was accepted but local reconciliation is required" },
        503,
        origin,
      );
    }
    const committed = commitData as SendClaimResult;
    if (committed.action === "reconcile") {
      return jsonResponse(
        { error: "BoldSign send was accepted but local reconciliation is required" },
        503,
        origin,
      );
    }
    documentId = committed.provider_document_id;
    linkSigners = committed.link_signers ?? linkSigners;
  }

  if (!documentId) {
    return jsonResponse({ error: "BoldSign send outcome requires reconciliation" }, 409, origin);
  }

  // Persist provider truth before this disclosure check. Revocation can withhold
  // every identifier/link without orphaning an already-created provider document.
  try {
    await actorAuth.revalidate(contract.facility_id);
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
  }

  const links: Record<string, string> = {};
  if (body.get_embedded_links ?? disableEmails) {
    for (const signer of linkSigners) {
      let linkResponse: Response;
      try {
        linkResponse = await withCurrentActorRevalidation(
          actorAuth,
          () => boldSignFetch(`/v1/document/getEmbeddedSignLink?documentId=${encodeURIComponent(documentId)}&signerEmail=${encodeURIComponent(signer.email)}`),
          contract.facility_id,
        );
      } catch (error) {
        return boldSignProviderFailureResponse(
          error,
          origin,
          "BoldSign link request failed",
        );
      }
      const linkJson = linkResponse.ok
        ? await linkResponse.json().catch(() => ({}))
        : {};
      // Provider I/O (including reading the body) can outlive facility access.
      try {
        await actorAuth.revalidate(contract.facility_id);
      } catch (error) {
        return currentActorErrorResponse(error, getCorsHeaders(origin));
      }
      if (typeof linkJson.signLink === "string") links[signer.id] = linkJson.signLink;
    }
  }

  try {
    await actorAuth.revalidate(contract.facility_id);
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
  }
  return jsonResponse({ success: true, contract_id: contract.id, document_id: documentId, embedded_links: links }, 200, origin);
}

if (import.meta.main) Deno.serve(handleBoldSignSend);
